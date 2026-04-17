import { DurableObject } from "cloudflare:workers";
import { Alarms } from "@cloudflare/actors/alarms";
import { RpcTarget } from "capnweb";
import { eq } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import type { ChunkGen } from "../server/chunk-gen";
import * as schema from "../server/schema";
import { BlockSystem, type BlockSystemOptions } from "./block-system";
import { ChunkStorage } from "./chunk-storage";
import type { InventoryClickTarget } from "./crafting";
import { FluidSystem } from "./fluid-system";
import type { GameSystem } from "./game-system";
import type { PlayerAttackPacket, PlayerPositionPacket } from "./player";
import { PlayerSystem } from "./player-system";
import type {
  AuthenticatedApi,
  GameApi,
  PlayerCredentials,
  RoomSessionApi,
  ServerPacket,
  ServerTick,
} from "./protocol";
import { DAY_LENGTH_S } from "./time";

export type {
  AuthenticatedApi,
  GameApi,
  PlayerCredentials,
  RoomSessionApi,
  ServerPacket,
  ServerTick,
} from "./protocol";

const TICK_MS = 50;
const PERSIST_EVERY_N_TICKS = 50;
const MAX_NAME_LENGTH = 32;
const NAME_PATTERN = /^[\w\s-]+$/;
const MIN_INPUT_INTERVAL_MS = 25;
/** Kick a player whose tick RPC hasn't been acked in this long. */
const UNRESPONSIVE_TIMEOUT_MS = 30_000;
/**
 * Marker error thrown by per-player DO RPCs when the caller's player has no
 * listener registered. Indicates the DO was evicted from memory (losing the
 * in-memory listener map) while the worker still holds a valid `RoomSession`.
 * The worker catches this and re-invokes `join` to restore server state.
 */
const SESSION_NOT_JOINED = "SESSION_NOT_JOINED";
type TickListener = ((tick: ServerTick) => unknown) & {
  dup?(): TickListener;
  onRpcBroken?(callback: () => void): void;
  [Symbol.dispose]?(): void;
};

/**
 * Fires a tick listener. Returns a promise that resolves when the client
 * acknowledges, or `null` if the call threw synchronously (dead stub). The
 * caller uses the resolved promise to update per-player liveness timestamps;
 * broadcasts themselves don't await it, so a slow client doesn't stall ticks.
 */
function notify(cb: TickListener, tick: ServerTick): Promise<unknown> | null {
  try {
    const result = cb(tick);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return result as Promise<unknown>;
    }
    return Promise.resolve();
  } catch {
    return null;
  }
}

/**
 * Durable Object for a single game room. Holds authoritative game state, runs
 * the tick loop, broadcasts packets to connected clients, and periodically
 * flushes state to Drizzle SQLite.
 */
export class GameRoom extends DurableObject<Env> {
  alarms: Alarms<this>;
  private playerSystem = new PlayerSystem();
  private blockSystem!: BlockSystem;
  private chunkStorage!: ChunkStorage;
  private systems!: GameSystem[];
  private listeners = new Map<string, TickListener>();
  private lastInputTime = new Map<string, number>();
  /** Most recent tick RPC-ack timestamp per player. Drives unresponsive-kick. */
  private lastAckTimeMs = new Map<string, number>();
  /**
   * Per-player session token. Each `join()` assigns a fresh token; `leave()`
   * and `onListenerLost()` only tear down if the calling session's token still
   * matches. Prevents a slow-disposing old `RoomSession` from evicting the
   * listener owned by the client's new session after a page reload with the
   * same playerId.
   */
  private sessionTokens = new Map<string, number>();
  private nextSessionToken = 1;
  private needsBroadcast = false;
  private tickRunning = false;
  private gameTick = 0;
  private timeOffsetS = 0;
  private lastTickTimeMs = 0;
  private lastTickTime = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private db: DrizzleSqliteDODatabase<typeof schema>;
  private initialized = false;
  private blockSystemOptions?: BlockSystemOptions;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    this.alarms = new Alarms(ctx, this);
  }

  /**
   * Lazy one-time setup: runs DB migrations, hydrates chunk storage, and
   * hydrates all systems from SQLite.
   */
  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    migrate(this.db, migrations);
    const seed = this.getOrCreateSeed();

    this.chunkStorage = new ChunkStorage(this.db, this.env.ChunkGen as Service<typeof ChunkGen> | undefined);
    this.chunkStorage.hydrate(seed);

    this.blockSystem = new BlockSystem(this.chunkStorage, this.playerSystem, this.blockSystemOptions);
    const fluidSystem = new FluidSystem(this.chunkStorage);
    this.systems = [this.playerSystem, this.blockSystem, fluidSystem];

    for (const system of this.systems) {
      system.hydrate(this.db);
    }
    console.log("GameRoom initialized");
  }

  private getOrCreateSeed(): number {
    const row = this.db.select().from(schema.roomConfig).where(eq(schema.roomConfig.key, "seed")).get();
    if (row) return Number(row.value);

    const seed = Math.floor(Math.random() * 2147483647);
    this.db
      .insert(schema.roomConfig)
      .values({ key: "seed", value: String(seed) })
      .run();
    return seed;
  }

  /**
   * Registers a new player and queues a broadcast for the next tick.
   * The joining player's own state is included in their first tick.
   */
  join(playerId: string, name: string, onTick: TickListener): number {
    this.ensureInitialized();
    this.playerSystem.join(playerId, name);
    this.removeListener(playerId);
    this.lastInputTime.delete(playerId);
    const token = this.nextSessionToken++;
    const listener = onTick.dup?.() ?? onTick;
    listener.onRpcBroken?.(() => {
      this.onListenerLost(playerId, token);
    });
    this.listeners.set(playerId, listener);
    this.sessionTokens.set(playerId, token);
    this.lastAckTimeMs.set(playerId, Date.now());
    this.blockSystem.onPlayerJoin(playerId);
    this.needsBroadcast = true;
    this.startTickLoop();
    console.log(`[GameRoom] ${playerId} joined the room (session ${token})`);
    return token;
  }

  /**
   * Throws if `playerId` has no active listener. Indicates the DO was evicted
   * and the in-memory session state was lost; the worker catches this error
   * and transparently re-joins.
   */
  private ensureJoined(playerId: string) {
    if (!this.listeners.has(playerId)) {
      throw new Error(SESSION_NOT_JOINED);
    }
  }

  /**
   * Enqueues player inputs, rate-limited to prevent flooding.
   * Batches arriving faster than `MIN_INPUT_INTERVAL_MS` are silently dropped.
   */
  sendPosition(playerId: string, packet: PlayerPositionPacket) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    const now = Date.now();
    const last = this.lastInputTime.get(playerId) ?? 0;
    if (now - last < MIN_INPUT_INTERVAL_MS) return;
    this.lastInputTime.set(playerId, now);
    const acceptedPosition = this.playerSystem.queuePosition(playerId, packet);
    if (acceptedPosition) {
      this.blockSystem.onPlayerPosition(playerId, acceptedPosition.x, acceptedPosition.z);
    }
    this.needsBroadcast = true;
  }

  sendBlockAction(playerId: string, action: import("./protocol").BlockActionPacket) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    void this.blockSystem.queueAction(playerId, action).then(() => {
      this.needsBroadcast = true;
    });
  }

  /** Queues the player's own state for the next tick. */
  requestState(playerId: string) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    this.playerSystem.requestState(playerId);
    this.needsBroadcast = true;
  }

  /** Applies an inventory or crafting click for the player. */
  clickInventory(playerId: string, target: InventoryClickTarget) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    if (this.playerSystem.interactInventory(playerId, target)) {
      this.needsBroadcast = true;
    }
  }

  /** Returns crafting-grid items and the cursor back into the player's inventory. */
  closeInventory(playerId: string) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    if (this.playerSystem.closeInventory(playerId)) {
      this.needsBroadcast = true;
    }
  }

  /** Updates the active hotbar slot. */
  selectHotbarSlot(playerId: string, slotIndex: number) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    if (this.playerSystem.setSelectedHotbarSlot(playerId, slotIndex)) {
      this.needsBroadcast = true;
    }
  }

  /** Attempts a melee attack from a client-authoritative snapshot. */
  attack(playerId: string, packet: PlayerAttackPacket) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    if (this.playerSystem.attack(playerId, packet, new Set(this.listeners.keys()))) {
      this.needsBroadcast = true;
    }
  }

  setTimeOfDay(timeS: number) {
    if (!Number.isFinite(timeS)) return;
    const normalizedTimeS = ((timeS % DAY_LENGTH_S) + DAY_LENGTH_S) % DAY_LENGTH_S;
    this.timeOffsetS = normalizedTimeS - ((Date.now() / 1000) % DAY_LENGTH_S);
    this.needsBroadcast = true;
  }

  /** Teleports a player to the given coordinates. */
  teleportTo(playerId: string, x: number, y: number, z: number) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    if (this.playerSystem.teleportTo(playerId, x, y, z)) {
      this.needsBroadcast = true;
    }
  }

  /** Respawns a player at the world spawn with starter state. */
  respawn(playerId: string) {
    this.ensureInitialized();
    this.ensureJoined(playerId);
    if (this.playerSystem.respawn(playerId)) {
      this.needsBroadcast = true;
    }
  }

  /**
   * Removes the player from the room; survivors see the change next tick.
   * `sessionToken` is the token handed out by `join()` — stale calls from a
   * previous session (after a page reload with the same playerId) are ignored.
   */
  leave(playerId: string, sessionToken?: number) {
    if (sessionToken !== undefined && this.sessionTokens.get(playerId) !== sessionToken) {
      console.log(`[GameRoom] ignoring stale leave(${playerId}, session ${sessionToken})`);
      return;
    }
    console.log(`[GameRoom] ${playerId} left the room`);
    this.removeListener(playerId);
    this.lastInputTime.delete(playerId);
    this.lastAckTimeMs.delete(playerId);
    this.sessionTokens.delete(playerId);
    this.blockSystem?.onPlayerLeave(playerId);
    this.playerSystem.leave(playerId);
    this.needsBroadcast = true;
  }

  override async alarm(info?: AlarmInvocationInfo) {
    await this.alarms.alarm(info);
  }

  /** Configures block system options. Must be called before the first join. */
  configureBlockSystem(opts: BlockSystemOptions) {
    this.blockSystemOptions = opts;
  }

  /** Runs a single tick; exposed publicly for external callers (e.g. tests). */
  async runTick() {
    return this.tick();
  }

  /**
   * Core game loop body. Advances all systems, flushes all pending
   * notifications to connected clients, and persists dirty state.
   */
  private async tick() {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      this.ensureInitialized();

      const tickStart = performance.now();
      this.gameTick++;

      if (this.lastTickTime > 0 && tickStart - this.lastTickTime > TICK_MS * 2) {
        console.warn(`Tick ${this.gameTick} scheduled ${tickStart - this.lastTickTime - TICK_MS}ms late`);
      }

      for (const system of this.systems) {
        const tickStart = performance.now();
        const changed = await system.tick();
        const tickMs = performance.now() - tickStart;
        if (tickMs > 20) {
          console.warn(`System ${system.constructor.name} tick took ${tickMs.toFixed(1)}ms`);
        }

        if (changed) this.needsBroadcast = true;
      }
      this.lastTickTimeMs = performance.now() - tickStart;
      const flushTickStart = performance.now();

      if (this.needsBroadcast && this.listeners.size > 0) {
        this.needsBroadcast = false;
        this.broadcast();
      }
      if (this.gameTick % PERSIST_EVERY_N_TICKS === 0 && this.hasDirty()) {
        this.flushAll();
      }
      if (this.listeners.size === 0) {
        this.stopTickLoop();
        if (this.hasDirty()) this.flushAll();
      }

      if (this.lastTickTimeMs > TICK_MS) {
        console.warn(`Tick ${this.gameTick} took ${this.lastTickTimeMs.toFixed(1)}ms`);
      }

      if (performance.now() - flushTickStart > 10) {
        console.warn(`Tick ${this.gameTick} flush took ${(performance.now() - flushTickStart).toFixed(1)}ms`);
      }
    } finally {
      this.tickRunning = false;
      this.lastTickTime = performance.now();
    }
  }

  /**
   * Sends a per-client `ServerTick` to all registered listeners. Each listener
   * receives the packets produced by every system for that specific player,
   * plus a room-level `WorldStatePacket`. Fires notifications without awaiting
   * client acks so a slow client doesn't stall ticks — but tracks the promise
   * per player; anyone whose last ack is older than `UNRESPONSIVE_TIMEOUT_MS`
   * is treated as disconnected. Complements `onRpcBroken`, which only fires
   * when capnweb itself observes the socket close.
   */
  private broadcast(): void {
    const entries = [...this.listeners.entries()];
    const onlinePlayerIds = new Set(this.listeners.keys());
    const ctx = { onlinePlayerIds };
    const now = Date.now();
    const worldPacket: ServerPacket = {
      type: "world",
      tickTimeMs: this.lastTickTimeMs,
      timeOfDayS: (((now / 1000 + this.timeOffsetS) % DAY_LENGTH_S) + DAY_LENGTH_S) % DAY_LENGTH_S,
    };
    const broken: string[] = [];
    for (const [id, cb] of entries) {
      const packets: ServerPacket[] = [];
      for (const system of this.systems) {
        packets.push(...system.packetsFor(id, ctx));
      }
      packets.push(worldPacket);
      const result = notify(cb, { tick: this.gameTick, packets });
      if (!result) {
        broken.push(id);
        continue;
      }
      result.then(
        () => {
          this.lastAckTimeMs.set(id, Date.now());
        },
        () => {
          /* onRpcBroken handles disconnect; no need to kick here. */
        },
      );
    }
    for (const system of this.systems) {
      system.clearPending();
    }
    for (const [id, lastAck] of this.lastAckTimeMs) {
      if (!this.listeners.has(id)) {
        this.lastAckTimeMs.delete(id);
        continue;
      }
      if (now - lastAck > UNRESPONSIVE_TIMEOUT_MS && !broken.includes(id)) {
        console.warn(`[GameRoom] kicking ${id}: no tick ack in ${now - lastAck}ms`);
        broken.push(id);
      }
    }
    for (const id of broken) {
      this.onListenerLost(id);
    }
    if (broken.length > 0) {
      this.needsBroadcast = true;
    }
  }

  /**
   * Handles a transport-level disconnect. Tears down the listener and delegates
   * to `PlayerSystem.leave` so crafting-grid/cursor items are returned to the
   * player's inventory and per-player UI state does not leak across sessions.
   * Also forces a re-broadcast so remaining clients observe the disconnect
   * even if the room is otherwise idle.
   */
  private onListenerLost(playerId: string, sessionToken?: number) {
    if (sessionToken !== undefined && this.sessionTokens.get(playerId) !== sessionToken) {
      return;
    }
    this.removeListener(playerId);
    this.lastInputTime.delete(playerId);
    this.lastAckTimeMs.delete(playerId);
    this.sessionTokens.delete(playerId);
    this.blockSystem?.onPlayerLeave(playerId);
    this.playerSystem.leave(playerId);
    this.needsBroadcast = true;
  }

  /** Returns `true` if any system has unsaved dirty state. */
  private hasDirty(): boolean {
    return this.systems.some((system) => system.hasDirty());
  }

  /** Flushes all dirty systems to SQLite. */
  private flushAll() {
    for (const system of this.systems) {
      system.flush(this.db);
    }
  }

  /** Disposes a player's dup'd tick callback and removes it from the listener map. */
  private removeListener(playerId: string) {
    this.listeners.get(playerId)?.[Symbol.dispose]?.();
    this.listeners.delete(playerId);
  }

  /** Starts the `setInterval` tick loop if not already running. */
  private startTickLoop() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
  }

  /** Clears the `setInterval` tick loop. */
  private stopTickLoop() {
    if (!this.tickInterval) return;
    clearInterval(this.tickInterval);
    this.tickInterval = null;
  }
}

type GameRoomStub = DurableObjectStub<GameRoom>;

/**
 * Scoped capability returned from `AuthSession.join()`. Clients use this to
 * send inputs and leave the room. The session is invalidated after `leave()`.
 *
 * Every per-player RPC is routed through `#call`, which transparently re-joins
 * the DO if it was evicted (losing its in-memory listener map) between calls.
 * The worker still holds the original `onTick` capnweb stub, so re-joining
 * reuses the client's existing callback — no client-side reconnect is needed.
 */
export class RoomSession extends RpcTarget implements RoomSessionApi {
  #getRoom: () => GameRoomStub;
  #playerId: string;
  #name: string;
  #onTick: TickListener;
  #sessionToken: number;
  #left = false;
  #rejoinPromise: Promise<void> | null = null;

  constructor(getRoom: () => GameRoomStub, playerId: string, name: string, onTick: TickListener, sessionToken: number) {
    super();
    this.#getRoom = getRoom;
    this.#playerId = playerId;
    this.#name = name;
    this.#onTick = onTick;
    this.#sessionToken = sessionToken;
  }

  /**
   * Wraps a DO RPC with one-shot auto-rejoin: if the DO signals `SESSION_NOT_JOINED`
   * (its in-memory state was lost), `join` is re-invoked and the call retried once.
   * Concurrent failures share a single rejoin promise to avoid duplicate joins.
   */
  async #call<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (this.#left || !isSessionNotJoined(err)) throw err;
      await this.#rejoin();
      return op();
    }
  }

  async #rejoin(): Promise<void> {
    if (!this.#rejoinPromise) {
      this.#rejoinPromise = (async () => {
        console.warn(`[RoomSession] ${this.#playerId} re-joining after DO eviction`);
        this.#sessionToken = await this.#getRoom().join(this.#playerId, this.#name, this.#onTick);
      })().finally(() => {
        this.#rejoinPromise = null;
      });
    }
    return this.#rejoinPromise;
  }

  /** Forwards client position packets to the authoritative `GameRoom`. */
  sendPosition(packet: PlayerPositionPacket) {
    return this.#call(() => this.#getRoom().sendPosition(this.#playerId, packet));
  }

  sendBlockAction(action: import("./protocol").BlockActionPacket) {
    return this.#call(() => this.#getRoom().sendBlockAction(this.#playerId, action));
  }

  /** Asks the server to include own state in the next tick. */
  requestState() {
    return this.#call(() => this.#getRoom().requestState(this.#playerId));
  }

  /** Teleports this player to the given coordinates. */
  teleportTo(x: number, y: number, z: number) {
    return this.#call(() => this.#getRoom().teleportTo(this.#playerId, x, y, z));
  }

  /** Respawns this player at the world spawn with starter state. */
  respawn() {
    return this.#call(() => this.#getRoom().respawn(this.#playerId));
  }

  /** Applies an inventory or crafting interaction. */
  clickInventory(target: InventoryClickTarget) {
    return this.#call(() => this.#getRoom().clickInventory(this.#playerId, target));
  }

  /** Returns crafting-grid items and the cursor to the player's inventory. */
  closeInventory() {
    return this.#call(() => this.#getRoom().closeInventory(this.#playerId));
  }

  /** Changes the selected hotbar slot. */
  selectHotbarSlot(slotIndex: number) {
    return this.#call(() => this.#getRoom().selectHotbarSlot(this.#playerId, slotIndex));
  }

  /** Attempts a melee attack from the local client snapshot. */
  attack(packet: PlayerAttackPacket) {
    return this.#call(() => this.#getRoom().attack(this.#playerId, packet));
  }

  /** Sets the server-authoritative time of day. */
  setTimeOfDay(timeS: number) {
    return this.#getRoom().setTimeOfDay(timeS);
  }

  /** Leaves the room (idempotent; subsequent calls are no-ops). */
  async leave() {
    if (this.#left) return;
    this.#left = true;
    console.log(`[RoomSession] ${this.#playerId} left the room (session ${this.#sessionToken})`);
    await this.#getRoom().leave(this.#playerId, this.#sessionToken);
    console.log(`[RoomSession] ${this.#playerId} left the room - finalized`);
  }

  /** Called automatically when the RPC session is disposed. */
  [Symbol.dispose]() {
    Promise.resolve(this.leave()).catch(() => {});
  }
}

function isSessionNotJoined(err: unknown): boolean {
  return err instanceof Error && err.message === SESSION_NOT_JOINED;
}

/**
 * Capability returned after successful authentication. Exposes player
 * credentials and the ability to join a named room.
 */
export class AuthSession extends RpcTarget implements AuthenticatedApi {
  #env: Env;
  #playerId: string;
  #name: string;

  constructor(env: Env, playerId: string, name: string) {
    super();
    this.#env = env;
    this.#playerId = playerId;
    this.#name = name;
  }

  /** The authenticated player's ID and display name. */
  get credentials(): PlayerCredentials {
    return { playerId: this.#playerId, name: this.#name };
  }

  /**
   * Looks up (or creates) the named Durable Object room, registers the
   * player, and returns a `RoomSession` capability.
   */
  async join(roomId: string, onTick: TickListener) {
    const id = this.#env.GameRoom.idFromName(roomId);
    const getRoom = () => this.#env.GameRoom.get(id);
    const sessionToken = await getRoom().join(this.#playerId, this.#name, onTick);
    return new RoomSession(getRoom, this.#playerId, this.#name, onTick, sessionToken);
  }
}

/**
 * Derives a deterministic player ID by SHA-256-hashing the player's name.
 * The first 16 bytes are hex-encoded to form a 32-character ID.
 */
async function derivePlayerId(name: string): Promise<string> {
  const data = new TextEncoder().encode(name);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash.slice(0, 16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** RPC entry point. Validates the player name and returns an `AuthSession`. */
export class GameServer extends RpcTarget implements GameApi {
  #env: Env;

  constructor(env: Env) {
    super();
    this.#env = env;
  }

  /**
   * Validates and trims the name, then returns an `AuthSession` for the derived
   * player ID.
   * @throws If the name is empty, too long, or contains invalid characters.
   */
  async authenticate(name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(trimmed)) {
      throw new Error("Invalid player name");
    }
    const playerId = await derivePlayerId(trimmed);
    return new AuthSession(this.#env, playerId, trimmed);
  }
}
