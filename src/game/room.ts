import { DurableObject } from "cloudflare:workers";
import { Alarms } from "@cloudflare/actors/alarms";
import { RpcTarget } from "capnweb";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import * as schema from "../server/schema";
import type { InventoryClickTarget } from "./crafting";
import type { GameSystem } from "./game-system";
import type { PlayerPositionPacket } from "./player";
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
type TickListener = ((tick: ServerTick) => unknown) & {
  dup?(): TickListener;
  onRpcBroken?(callback: () => void): void;
  [Symbol.dispose]?(): void;
};

/**
 * Calls a tick listener, catching synchronous throws and rejected promises.
 * Returns `false` if the call failed, signalling a broken connection.
 */
function notify(cb: TickListener, tick: ServerTick): Promise<boolean> {
  try {
    const result = cb(tick);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(
        () => true,
        () => false,
      );
    }
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
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
  private systems: GameSystem[] = [this.playerSystem];
  private listeners = new Map<string, TickListener>();
  private lastInputTime = new Map<string, number>();
  private needsBroadcast = false;
  private gameTick = 0;
  private timeOffsetS = 0;
  private lastTickTimeMs = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private db: DrizzleSqliteDODatabase<typeof schema>;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    this.alarms = new Alarms(ctx, this);
  }

  /**
   * Lazy one-time setup: runs DB migrations and hydrates all systems from
   * SQLite. Called before any operation that needs entity state.
   */
  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    migrate(this.db, migrations);
    for (const system of this.systems) {
      system.hydrate(this.db);
    }
  }

  /**
   * Registers a new player and queues a broadcast for the next tick.
   * The joining player's own state is included in their first tick.
   */
  join(playerId: string, name: string, onTick: TickListener) {
    this.ensureInitialized();
    this.playerSystem.join(playerId, name);
    this.removeListener(playerId);
    this.lastInputTime.delete(playerId);
    const listener = onTick.dup?.() ?? onTick;
    listener.onRpcBroken?.(() => {
      this.onListenerLost(playerId);
    });
    this.listeners.set(playerId, listener);
    this.needsBroadcast = true;
    this.startTickLoop();
  }

  /**
   * Enqueues player inputs, rate-limited to prevent flooding.
   * Batches arriving faster than `MIN_INPUT_INTERVAL_MS` are silently dropped.
   */
  sendPosition(playerId: string, packet: PlayerPositionPacket) {
    this.ensureInitialized();
    const now = Date.now();
    const last = this.lastInputTime.get(playerId) ?? 0;
    if (now - last < MIN_INPUT_INTERVAL_MS) return;
    this.lastInputTime.set(playerId, now);
    this.playerSystem.queuePosition(playerId, packet);
    this.needsBroadcast = true;
  }

  /** Queues the player's own state for the next tick. */
  requestState(playerId: string) {
    this.ensureInitialized();
    this.playerSystem.requestState(playerId);
    this.needsBroadcast = true;
  }

  /** Applies an inventory or crafting click for the player. */
  clickInventory(playerId: string, target: InventoryClickTarget) {
    this.ensureInitialized();
    if (this.playerSystem.interactInventory(playerId, target)) {
      this.needsBroadcast = true;
    }
  }

  /** Returns crafting-grid items and the cursor back into the player's inventory. */
  closeInventory(playerId: string) {
    this.ensureInitialized();
    if (this.playerSystem.closeInventory(playerId)) {
      this.needsBroadcast = true;
    }
  }

  /** Updates the active hotbar slot. */
  selectHotbarSlot(playerId: string, slotIndex: number) {
    this.ensureInitialized();
    if (this.playerSystem.setSelectedHotbarSlot(playerId, slotIndex)) {
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
    if (this.playerSystem.teleportTo(playerId, x, y, z)) {
      this.needsBroadcast = true;
    }
  }

  /** Removes the player from the room; survivors see the change next tick. */
  leave(playerId: string) {
    this.removeListener(playerId);
    this.lastInputTime.delete(playerId);
    this.playerSystem.leave(playerId);
    this.needsBroadcast = true;
  }

  override async alarm(info?: AlarmInvocationInfo) {
    await this.alarms.alarm(info);
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
    this.ensureInitialized();

    const tickStart = performance.now();
    this.gameTick++;
    for (const system of this.systems) {
      if (system.tick()) this.needsBroadcast = true;
    }
    this.lastTickTimeMs = performance.now() - tickStart;

    if (this.needsBroadcast && this.listeners.size > 0) {
      this.needsBroadcast = false;
      await this.broadcast();
    }
    if (this.gameTick % PERSIST_EVERY_N_TICKS === 0 && this.hasDirty()) {
      this.flushAll();
    }
    if (this.listeners.size === 0) {
      this.stopTickLoop();
      if (this.hasDirty()) this.flushAll();
    }
  }

  /**
   * Sends a per-client `ServerTick` to all registered listeners. Each listener
   * receives the packets produced by every system for that specific player,
   * plus a room-level `WorldStatePacket`. Broken listeners are removed and a
   * re-broadcast is queued for the next tick.
   */
  private async broadcast(): Promise<void> {
    const entries = [...this.listeners.entries()];
    const onlinePlayerIds = new Set(this.listeners.keys());
    const ctx = { onlinePlayerIds };
    const worldPacket: ServerPacket = {
      type: "world",
      tickTimeMs: this.lastTickTimeMs,
      timeOfDayS: (((Date.now() / 1000 + this.timeOffsetS) % DAY_LENGTH_S) + DAY_LENGTH_S) % DAY_LENGTH_S,
    };
    const results = await Promise.all(
      entries.map(([id, cb]) => {
        const packets: ServerPacket[] = [];
        for (const system of this.systems) {
          packets.push(...system.packetsFor(id, ctx));
        }
        packets.push(worldPacket);
        return notify(cb, { tick: this.gameTick, packets });
      }),
    );
    for (const system of this.systems) {
      system.clearPending();
    }
    const broken = entries.filter((_, i) => !results[i]).map(([id]) => id);
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
  private onListenerLost(playerId: string) {
    this.removeListener(playerId);
    this.lastInputTime.delete(playerId);
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
 */
export class RoomSession extends RpcTarget implements RoomSessionApi {
  #room: GameRoomStub;
  #playerId: string;
  #left = false;

  constructor(room: GameRoomStub, playerId: string) {
    super();
    this.#room = room;
    this.#playerId = playerId;
  }

  /** Forwards client position packets to the authoritative `GameRoom`. */
  sendPosition(packet: PlayerPositionPacket) {
    return this.#room.sendPosition(this.#playerId, packet);
  }

  /** Asks the server to include own state in the next tick. */
  requestState() {
    return this.#room.requestState(this.#playerId);
  }

  /** Teleports this player to the given coordinates. */
  teleportTo(x: number, y: number, z: number) {
    return this.#room.teleportTo(this.#playerId, x, y, z);
  }

  /** Applies an inventory or crafting interaction. */
  clickInventory(target: InventoryClickTarget) {
    return this.#room.clickInventory(this.#playerId, target);
  }

  /** Returns crafting-grid items and the cursor to the player's inventory. */
  closeInventory() {
    return this.#room.closeInventory(this.#playerId);
  }

  /** Changes the selected hotbar slot. */
  selectHotbarSlot(slotIndex: number) {
    return this.#room.selectHotbarSlot(this.#playerId, slotIndex);
  }

  /** Sets the server-authoritative time of day. */
  setTimeOfDay(timeS: number) {
    return this.#room.setTimeOfDay(timeS);
  }

  /** Leaves the room (idempotent; subsequent calls are no-ops). */
  leave() {
    if (this.#left) return;
    this.#left = true;
    return this.#room.leave(this.#playerId);
  }

  /** Called automatically when the RPC session is disposed. */
  [Symbol.dispose]() {
    Promise.resolve(this.leave()).catch(() => {});
  }
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
    const stub = this.#env.GameRoom.get(id);
    await stub.join(this.#playerId, this.#name, onTick);
    return new RoomSession(stub, this.#playerId);
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
