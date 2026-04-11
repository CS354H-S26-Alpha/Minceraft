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
import type {
  AuthenticatedApi,
  GameApi,
  PlayerCredentials,
  RoomSessionApi,
  RoomSnapshot,
} from "./protocol";

export type {
  AuthenticatedApi,
  GameApi,
  PlayerCredentials,
  RoomSessionApi,
  RoomSnapshot,
} from "./protocol";

const TICK_MS = 50;
const PERSIST_EVERY_N_TICKS = 50;

type SnapshotListener = ((snap: RoomSnapshot) => unknown) & {
  dup?(): SnapshotListener;
  onRpcBroken?(callback: () => void): void;
  [Symbol.dispose]?(): void;
};

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

export class GameRoom extends DurableObject<Env> {
  alarms: Alarms<this>;
  private playerCollection = new PlayerCollection();
  private collections: EntityCollection[] = [this.playerCollection];
  private listeners = new Map<string, SnapshotListener>();
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

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    migrate(this.db, migrations);
    for (const col of this.collections) {
      col.hydrate(this.db);
    }
  }

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

  sendInputs(playerId: string, inputs: PlayerInput[]) {
    this.playerCollection.queueInputs(playerId, inputs);
  }

  leave(playerId: string) {
    this.removeListener(playerId);
    this.playerCollection.leave(playerId);
    if (this.listeners.size > 0) {
      void this.broadcast(this.snapshot());
    }
  }

  override async alarm(info?: AlarmInvocationInfo) {
    await this.alarms.alarm(info);
  }

  async runTick() {
    return this.tick();
  }

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

  private async broadcast(snap: RoomSnapshot): Promise<void> {
    const entries = [...this.listeners.entries()];
    const results = await Promise.all(entries.map(([, cb]) => notify(cb, snap)));
    const broken = entries.filter((_, i) => !results[i]).map(([id]) => id);
    for (const id of broken) {
      this.removeListener(id);
    }
    if (broken.length > 0 && this.listeners.size > 0) {
      await this.broadcast(this.snapshot());
    }
  }

  private snapshot(): RoomSnapshot {
    const onlinePlayerIds = new Set(this.listeners.keys());
    return {
      tick: this.gameTick,
      players: this.playerCollection.snapshot(onlinePlayerIds),
      acks: this.playerCollection.getAcks(onlinePlayerIds),
      tickTimeMs: this.lastTickTimeMs,
    };
  }

  private hasDirty(): boolean {
    return this.collections.some((col) => col.hasDirty());
  }

  private flushAll() {
    for (const col of this.collections) {
      col.flush(this.db);
    }
  }

  private removeListener(playerId: string) {
    this.listeners.get(playerId)?.[Symbol.dispose]?.();
    this.listeners.delete(playerId);
  }

  private startTickLoop() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTickLoop() {
    if (!this.tickInterval) return;
    clearInterval(this.tickInterval);
    this.tickInterval = null;
  }
}

type GameRoomStub = DurableObjectStub<GameRoom>;

export class RoomSession extends RpcTarget implements RoomSessionApi {
  #room: GameRoomStub;
  #playerId: string;
  #left = false;

  constructor(room: GameRoomStub, playerId: string) {
    super();
    this.#room = room;
    this.#playerId = playerId;
  }

  sendInputs(inputs: PlayerInput[]) {
    return this.#room.sendInputs(this.#playerId, inputs);
  }

  leave() {
    if (this.#left) return;
    this.#left = true;
    return this.#room.leave(this.#playerId);
  }

  [Symbol.dispose]() {
    Promise.resolve(this.leave()).catch(() => {});
  }
}

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

  get credentials(): PlayerCredentials {
    return { playerId: this.#playerId, name: this.#name };
  }

  async join(roomId: string, onSnapshot: SnapshotListener) {
    const id = this.#env.GameRoom.idFromName(roomId);
    const stub = this.#env.GameRoom.get(id);
    await stub.join(this.#playerId, this.#name, onSnapshot);
    return new RoomSession(stub, this.#playerId);
  }
}

async function derivePlayerId(name: string): Promise<string> {
  const data = new TextEncoder().encode(name);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash.slice(0, 16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class GameServer extends RpcTarget implements GameApi {
  #env: Env;

  constructor(env: Env) {
    super();
    this.#env = env;
  }

  async authenticate(name: string) {
    const playerId = await derivePlayerId(name);
    return new AuthSession(this.#env, playerId, name);
  }
}
