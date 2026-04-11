import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { RpcSession, type RpcTransport } from "capnweb";
import { beforeEach, describe, expect, it } from "vitest";
import type { GameApi, RoomSnapshot } from "../../src/game/protocol.ts";
import type { GameRoom } from "../../src/game/room.ts";

// ---- capnweb HTTP batch transport routed through the in-process Worker ----

class WorkersBatchTransport implements RpcTransport {
  #toSend: string[] | null = [];
  #toReceive: string[] | null = null;
  #promise: Promise<void>;

  constructor(path: string) {
    this.#promise = (async () => {
      await new Promise((r) => setTimeout(r, 0));
      const batch = this.#toSend;
      this.#toSend = null;
      const res = await workerExports.default.fetch(
        new Request(`http://test.local${path}`, {
          method: "POST",
          body: (batch ?? []).join("\n"),
        }),
      );
      if (!res.ok) {
        res.body?.cancel();
        throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
      }
      const body = await res.text();
      this.#toReceive = body === "" ? [] : body.split("\n");
    })();
  }

  async send(message: string): Promise<void> {
    if (this.#toSend) this.#toSend.push(message);
  }

  async receive(): Promise<string> {
    if (!this.#toReceive) await this.#promise;
    const msg = this.#toReceive?.shift();
    if (msg === undefined) throw new Error("Batch RPC request ended.");
    return msg;
  }
}

function openGameApi(): { api: GameApi; session: RpcSession<GameApi> } {
  const transport = new WorkersBatchTransport("/api");
  const session = new RpcSession<GameApi>(transport);
  return { api: session.getRemoteMain() as unknown as GameApi, session };
}

// ---- Durable Object helpers ----

function makeRoomStub(name: string) {
  const id = env.GameRoom.idFromName(name);
  return env.GameRoom.get(id);
}

describe("GameRoom Durable Object", () => {
  let roomName: string;

  beforeEach(() => {
    // Fresh DO instance per test (Miniflare gives isolated storage per test).
    roomName = `room-${crypto.randomUUID()}`;
  });

  it("creates a player on join and reports it in the snapshot", async () => {
    const stub = makeRoomStub(roomName);
    const received: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => received.push(snap));
    });

    expect(received).toHaveLength(1);
    const [snap] = received;
    expect(snap?.players.alice).toBeDefined();
    expect(snap?.players.alice?.x).toBeCloseTo(0);
    expect(snap?.players.alice?.y).toBeCloseTo(70);
    expect(snap?.players.alice?.z).toBeCloseTo(20);
  });

  it("applies buffered input on the next tick and broadcasts to listeners", async () => {
    const stub = makeRoomStub(roomName);
    const received: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => received.push(snap));
      room.sendInputs("alice", [{ dx: 1, dy: 0, dz: 0, yaw: 0, pitch: 0 }]);
    });

    const alarmRan = await runDurableObjectAlarm(stub);
    expect(alarmRan).toBe(true);

    // Initial join snapshot + tick-driven broadcast
    expect(received.length).toBeGreaterThanOrEqual(2);
    const latest = received[received.length - 1];
    expect(latest?.players.alice?.x).toBeGreaterThan(0);
    expect(latest?.tick).toBe(1);
    expect(latest?.acks.alice).toBe(1);
  });

  it("broadcasts each player's input to every listener in the room", async () => {
    const stub = makeRoomStub(roomName);
    const aliceSnaps: RoomSnapshot[] = [];
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      room.sendInputs("alice", [{ dx: 0, dy: 0, dz: -1, yaw: 0, pitch: 0 }]);
      room.sendInputs("bob", [{ dx: 1, dy: 0, dz: 0, yaw: 0, pitch: 0 }]);
    });

    await runDurableObjectAlarm(stub);

    const aliceLatest = aliceSnaps[aliceSnaps.length - 1];
    const bobLatest = bobSnaps[bobSnaps.length - 1];
    expect(aliceLatest?.players.alice?.z).toBeLessThan(20);
    expect(aliceLatest?.players.bob?.x).toBeGreaterThan(0);
    expect(bobLatest?.players.alice?.z).toBeLessThan(20);
    expect(bobLatest?.players.bob?.x).toBeGreaterThan(0);
  });

  it("stops delivering snapshots after a player leaves", async () => {
    const stub = makeRoomStub(roomName);
    const aliceSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.leave("alice");
      // Another player keeps the room ticking so broadcasts would fire
      room.join("bob", "Bob", () => {});
      room.sendInputs("bob", [{ dx: 1, dy: 0, dz: 0, yaw: 0, pitch: 0 }]);
    });

    const initialCount = aliceSnaps.length;
    await runDurableObjectAlarm(stub);
    expect(aliceSnaps.length).toBe(initialCount);
  });

  it("does not broadcast when a tick fires with no pending input", async () => {
    const stub = makeRoomStub(roomName);
    const received: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => received.push(snap));
    });
    // First alarm flushes the dirty-from-join broadcast.
    await runDurableObjectAlarm(stub);
    const beforeCount = received.length;
    // Second alarm: no input, no dirty, no broadcast.
    await runDurableObjectAlarm(stub);
    expect(received.length).toBe(beforeCount);
  });
});

describe("GameServer capnweb RPC", () => {
  it("authenticates and joins a room via the capability chain", async () => {
    const { api } = openGameApi();
    const received: RoomSnapshot[] = [];

    const auth = api.authenticate("alice");
    const session = await auth.join("rpc-room", (snap: RoomSnapshot) => {
      received.push(snap);
    });

    expect(session).toBeDefined();
    // Initial snapshot should have flowed back through the batch response.
    expect(received.length).toBeGreaterThanOrEqual(1);
    // Player ID is a deterministic hash of "alice", check any player exists
    const players = Object.values(received[0]?.players ?? {});
    expect(players).toHaveLength(1);
    expect(players[0]?.y).toBeCloseTo(70);
  });
});
