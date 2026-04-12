import { DurableObject } from "cloudflare:workers";
import { Alarms } from "@cloudflare/actors/alarms";
import { RpcTarget } from "capnweb";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import * as schema from "../server/schema";
import type { EntityCollection } from "./entity-collection";
import type { PlayerInput } from "./player";
import { PlayerCollection } from "./player-collection";
import type { AuthenticatedApi, GameApi, PlayerCredentials, RoomSessionApi, RoomSnapshot } from "./protocol";

export type {
  AuthenticatedApi,
  GameApi,
  PlayerCredentials,
  RoomSessionApi,
  RoomSnapshot,
} from "./protocol";

const TICK_MS = 50;
const PERSIST_EVERY_N_TICKS = 50;
const MAX_NAME_LENGTH = 32;
const NAME_PATTERN = /^[\w\s-]+$/;
const MIN_INPUT_INTERVAL_MS = 25;
type SnapshotListener = ((snap: RoomSnapshot) => unknown) & {
  dup?(): SnapshotListener;
  onRpcBroken?(callback: () => void): void;
  [Symbol.dispose]?(): void;
};

/**
 * Calls a snapshot listener, catching synchronous throws and rejected promises.
 * Returns `false` if the call failed, signalling a broken connection.
 */
function notify(cb: SnapshotListener, snap: RoomSnapshot): Promise<boolean> {
  try {
    const result = cb(snap);
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
 * the tick loop, broadcasts snapshots to connected clients, and periodically
 * flushes state to Drizzle SQLite.
 */
export class GameRoom extends DurableObject<Env> {
  alarms: Alarms<this>;
  private playerCollection = new PlayerCollection();
  private collections: EntityCollection[] = [this.playerCollection];
  private listeners = new Map<string, SnapshotListener>();
  private lastInputTime = new Map<string, number>();
  private gameTick = 0;
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
   * Lazy one-time setup: runs DB migrations and hydrates all collections from
   * SQLite. Called before any operation that needs entity state.
   */
  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    migrate(this.db, migrations);
    for (const col of this.collections) {
      col.hydrate(this.db);
    }
  }

  /**
   * Registers a new player and sends the current snapshot to all listeners.
   * Starts the tick loop if it wasn't already running.
   */
  async join(playerId: string, name: string, onSnapshot: SnapshotListener) {
    this.ensureInitialized();
    this.playerCollection.join(playerId, name);
    this.removeListener(playerId);
    const listener = onSnapshot.dup?.() ?? onSnapshot;
    listener.onRpcBroken?.(() => {
      this.removeListener(playerId);
      if (this.listeners.size > 0) {
        void this.broadcast(this.snapshot());
      }
    });
    this.listeners.set(playerId, listener);
    await this.broadcast(this.snapshot());
    this.startTickLoop();
  }

  /**
   * Enqueues player inputs, rate-limited to prevent flooding.
   * Batches arriving faster than `MIN_INPUT_INTERVAL_MS` are silently dropped.
   */
  sendInputs(playerId: string, inputs: PlayerInput[]) {
    const now = Date.now();
    const last = this.lastInputTime.get(playerId) ?? 0;
    if (now - last < MIN_INPUT_INTERVAL_MS) return;
    this.lastInputTime.set(playerId, now);
    this.playerCollection.queueInputs(playerId, inputs);
  }

  /** Removes the player from the room and broadcasts the updated snapshot. */
  leave(playerId: string) {
    this.removeListener(playerId);
    this.lastInputTime.delete(playerId);
    this.playerCollection.leave(playerId);
    if (this.listeners.size > 0) {
      void this.broadcast(this.snapshot());
    }
  }

  override async alarm(info?: AlarmInvocationInfo) {
    await this.alarms.alarm(info);
  }

  /** Runs a single tick; exposed publicly for external callers (e.g. tests). */
  async runTick() {
    return this.tick();
  }

  /**
   * Core game loop body: advances all collections, broadcasts if anything
   * changed, and flushes dirty state every N ticks. Stops the loop when no
   * listeners remain.
   */
  private async tick() {
    this.ensureInitialized();

    const tickStart = performance.now();
    this.gameTick++;
    let changed = false;
    for (const col of this.collections) {
      if (col.tick()) changed = true;
    }
    this.lastTickTimeMs = performance.now() - tickStart;

    if (changed && this.listeners.size > 0) {
      await this.broadcast(this.snapshot());
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
   * Sends the snapshot to all registered listeners in parallel. Removes any
   * listeners whose calls fail, then re-broadcasts to the survivors so they
   * see the updated online player list.
   */
  private async broadcast(snap: RoomSnapshot): Promise<void> {
    const entries = [...this.listeners.entries()];
    const results = await Promise.all(entries.map(([, cb]) => notify(cb, snap)));
    const broken = entries.filter((_, i) => !results[i]).map(([id]) => id);
    for (const id of broken) {
      this.removeListener(id);
    }
    if (broken.length > 0 && this.listeners.size > 0) {
      const updated = this.snapshot();
      await Promise.all([...this.listeners.values()].map((cb) => notify(cb, updated)));
    }
  }

  /** Builds a room snapshot from current state, filtered to online players. */
  private snapshot(): RoomSnapshot {
    const onlinePlayerIds = new Set(this.listeners.keys());
    return {
      tick: this.gameTick,
      players: this.playerCollection.snapshot(onlinePlayerIds),
      acks: this.playerCollection.getAcks(onlinePlayerIds),
      tickTimeMs: this.lastTickTimeMs,
    };
  }

  /** Returns `true` if any collection has unsaved dirty entities. */
  private hasDirty(): boolean {
    return this.collections.some((col) => col.hasDirty());
  }

  /** Flushes all dirty collections to SQLite. */
  private flushAll() {
    for (const col of this.collections) {
      col.flush(this.db);
    }
  }

  /** Disposes a player's dup'd snapshot callback and removes it from the listener map. */
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

  /** Forwards inputs to the authoritative `GameRoom`. */
  sendInputs(inputs: PlayerInput[]) {
    return this.#room.sendInputs(this.#playerId, inputs);
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
  async join(roomId: string, onSnapshot: SnapshotListener) {
    const id = this.#env.GameRoom.idFromName(roomId);
    const stub = this.#env.GameRoom.get(id);
    await stub.join(this.#playerId, this.#name, onSnapshot);
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
