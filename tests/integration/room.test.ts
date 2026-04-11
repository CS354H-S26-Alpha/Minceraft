import { runInDurableObject } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { beforeEach, describe, expect, it } from "vitest";
import type { GameApi, RoomSnapshot } from "../../src/game/protocol.ts";
import type { GameRoom } from "../../src/game/room.ts";

// ---- capnweb WebSocket RPC session via in-process Worker ----

async function openWebSocketGameApi(): Promise<RpcStub<GameApi>> {
  const response = await workerExports.default.fetch(
    new Request("http://test.local/api", {
      headers: { Upgrade: "websocket" },
    }),
  );
  if (response.status !== 101 || !response.webSocket) {
    throw new Error(`Expected websocket upgrade, got ${response.status}`);
  }
  response.webSocket.accept();
  return newWebSocketRpcSession<GameApi>(response.webSocket);
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
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
      await room.join("alice", "Alice", (snap) => received.push(snap));
      room.sendInputs("alice", [{ dx: 1, dy: 0, dz: 0, dtSeconds: 1, yaw: 0, pitch: 0 }]);
      await room.runTick();
    });

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
      await room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      await room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      room.sendInputs("alice", [{ dx: 0, dy: 0, dz: -1, dtSeconds: 1, yaw: 0, pitch: 0 }]);
      room.sendInputs("bob", [{ dx: 1, dy: 0, dz: 0, dtSeconds: 1, yaw: 0, pitch: 0 }]);
      await room.runTick();
    });

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
      await room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.leave("alice");
      // Another player keeps the room ticking so broadcasts would fire
      await room.join("bob", "Bob", () => {});
      room.sendInputs("bob", [{ dx: 1, dy: 0, dz: 0, dtSeconds: 1, yaw: 0, pitch: 0 }]);
      const initialCount = aliceSnaps.length;
      await room.runTick();
      expect(aliceSnaps.length).toBe(initialCount);
    });
  });

  it("removes offline players from snapshots", async () => {
    const stub = makeRoomStub(roomName);
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      room.leave("alice");
    });

    const latest = bobSnaps[bobSnaps.length - 1];
    expect(latest?.players.alice).toBeUndefined();
    expect(latest?.players.bob).toBeDefined();
    expect(latest?.acks.alice).toBeUndefined();
    expect(latest?.acks.bob).toBeDefined();
  });

  it("removes players when their snapshot delivery fails", async () => {
    const stub = makeRoomStub(roomName);
    const bobSnaps: RoomSnapshot[] = [];
    let disconnected = false;

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {
        if (disconnected) throw new Error("connection lost");
      });
      await room.join("alice", "Alice", aliceListener);
      await room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
    });

    onBroken?.();

    const latest = bobSnaps[bobSnaps.length - 1];
    expect(latest?.players.alice).toBeUndefined();
    expect(latest?.players.bob).toBeDefined();
  });

  it("does not show a previously disconnected player to a later joiner", async () => {
    const stub = makeRoomStub(roomName);
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      await room.join("alice", "Alice", () => {});
      room.leave("alice");
      await room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
    });

    expect(bobSnaps.length).toBeGreaterThanOrEqual(1);
    const initialBobSnap = bobSnaps[0];
    expect(initialBobSnap?.players.alice).toBeUndefined();
    expect(initialBobSnap?.players.bob).toBeDefined();
    expect(initialBobSnap?.acks.alice).toBeUndefined();
  });

  it("does not broadcast when a tick fires with no pending input", async () => {
    const stub = makeRoomStub(roomName);
    const received: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      await room.join("alice", "Alice", (snap) => received.push(snap));
      // First tick flushes any dirty state
      await room.runTick();
      const beforeCount = received.length;
      // Second tick: no input, no dirty, no broadcast
      await room.runTick();
      expect(received.length).toBe(beforeCount);
    });
  });
});

describe("GameServer capnweb RPC", () => {
  it("authenticates and joins a room via the capability chain", async () => {
    const api = await openWebSocketGameApi();
    const received: RoomSnapshot[] = [];

    const auth = api.authenticate("alice");
    using roomSession = await auth.join("rpc-room", (snap: RoomSnapshot) => {
      received.push(snap);
    });

    expect(roomSession).toBeDefined();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const players = Object.values(received[0]?.players ?? {});
    expect(players).toHaveLength(1);
    expect(players[0]?.y).toBeCloseTo(70);
  });

  it("removes a player from other clients when they leave the room", async () => {
    const bobApi = await openWebSocketGameApi();
    const bobSnaps: RoomSnapshot[] = [];

    const bobAuth = bobApi.authenticate("bob");
    using _bobSession = await bobAuth.join("ws-room", (snap: RoomSnapshot) => {
      bobSnaps.push(snap);
    });

    {
      const aliceApi = await openWebSocketGameApi();
      const aliceAuth = aliceApi.authenticate("alice");
      using _aliceSession = await aliceAuth.join("ws-room", () => {});

      await waitFor(() => {
        const latest = bobSnaps[bobSnaps.length - 1];
        if (!latest) return false;
        const names = Object.values(latest.players).map((p) => p.name);
        return names.includes("alice") && names.includes("bob");
      });
    }

    await waitFor(() => {
      const latest = bobSnaps[bobSnaps.length - 1];
      if (!latest) return false;
      const names = Object.values(latest.players).map((p) => p.name);
      return !names.includes("alice") && names.includes("bob");
    }, 2000);
  }, 4000);
});
