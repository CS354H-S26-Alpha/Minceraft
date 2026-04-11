import { Actor } from "@cloudflare/actors";
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

type SnapshotListener = (snap: RoomSnapshot) => unknown;

function notify(cb: SnapshotListener, snap: RoomSnapshot) {
  try {
    const result = cb(snap);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    // capnweb surfaces broken stubs via onRpcBroken elsewhere
  }
}

export class GameRoom extends Actor<Env> {
  private playerCollection = new PlayerCollection();
  private collections: EntityCollection[] = [this.playerCollection];
  private listeners = new Map<string, SnapshotListener>();
  private tick = 0;
  private db!: DrizzleSqliteDODatabase<typeof schema>;

  override async onInit() {
    this.db = drizzle(this.ctx.storage, { schema });
    migrate(this.db, migrations);
    for (const col of this.collections) {
      col.hydrate(this.db);
    }
  }

  join(playerId: string, name: string, onSnapshot: SnapshotListener) {
    this.playerCollection.join(playerId, name);
    this.listeners.set(playerId, onSnapshot);
    notify(onSnapshot, this.snapshot());
    this.ensureAlarm();
  }

  sendInputs(playerId: string, inputs: PlayerInput[]) {
    this.playerCollection.queueInputs(playerId, inputs);
  }

  leave(playerId: string) {
    this.listeners.delete(playerId);
    this.playerCollection.leave(playerId);
  }

  override async onAlarm(): Promise<void> {
    this.tick++;

    let changed = false;
    for (const col of this.collections) {
      if (col.tick()) changed = true;
    }

    if (changed && this.listeners.size > 0) {
      const snap = this.snapshot();
      for (const cb of this.listeners.values()) {
        notify(cb, snap);
      }
    }

    if (this.tick % PERSIST_EVERY_N_TICKS === 0 && this.hasDirty()) {
      this.flushAll();
    }

    if (this.listeners.size > 0) {
      this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    } else if (this.hasDirty()) {
      this.flushAll();
    }
  }

  private snapshot(): RoomSnapshot {
    return {
      tick: this.tick,
      players: this.playerCollection.snapshot(),
      acks: this.playerCollection.getAcks(),
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

  private ensureAlarm() {
    this.ctx.storage.setAlarm(Date.now() + TICK_MS);
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
    this.leave();
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
