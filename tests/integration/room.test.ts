import { runInDurableObject } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { beforeEach, describe, expect, it } from "vitest";
import { PLAYER_MAX_HEALTH } from "../../src/game/player";
import type { GameApi, RoomSnapshot } from "../../src/game/protocol.ts";
import type { GameRoom } from "../../src/game/room.ts";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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
      await room.runTick();
    });

    expect(received).toHaveLength(1);
    const [snap] = received;
    expect(snap?.self).toBeDefined();
    expect(snap?.self?.x).toBeCloseTo(0);
    expect(snap?.self?.y).toBeCloseTo(70);
    expect(snap?.self?.z).toBeCloseTo(20);
    expect(snap?.self?.health).toBe(PLAYER_MAX_HEALTH);
    expect(snap?.self?.inventory).toHaveLength(36);
    expect(snap?.inventoryUi?.craftingGrid).toHaveLength(4);
  });

  it("applies buffered input on the next tick and broadcasts to listeners", async () => {
    const stub = makeRoomStub(roomName);
    const aliceSnaps: RoomSnapshot[] = [];
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      await wait(50);
      room.sendPosition("alice", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    // Bob sees alice's movement; alice sees only acks (own state excluded).
    const bobLatest = bobSnaps[bobSnaps.length - 1];
    expect(bobLatest?.players.alice?.x).toBeGreaterThan(0);
    expect(bobLatest?.tick).toBeGreaterThanOrEqual(1);
    const aliceLatest = aliceSnaps[aliceSnaps.length - 1];
    expect(aliceLatest?.acks.alice).toBe(1);
    expect(aliceLatest?.players.alice).toBeUndefined();
  });

  it("broadcasts each player's input to every listener in the room", async () => {
    const stub = makeRoomStub(roomName);
    const aliceSnaps: RoomSnapshot[] = [];
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      await wait(50);
      room.sendPosition("alice", { sequence: 1, x: 0, y: 70, z: 19, yaw: 0, pitch: 0 });
      room.sendPosition("bob", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    const aliceLatest = aliceSnaps[aliceSnaps.length - 1];
    const bobLatest = bobSnaps[bobSnaps.length - 1];
    // Each player sees the other but not themselves.
    expect(aliceLatest?.players.alice).toBeUndefined();
    expect(aliceLatest?.players.bob?.x).toBeGreaterThan(0);
    expect(bobLatest?.players.bob).toBeUndefined();
    expect(bobLatest?.players.alice?.z).toBeLessThan(20);
  });

  it("keeps simulating movement across ticks from the latest input state", async () => {
    const stub = makeRoomStub(roomName);
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      await wait(50);
      room.sendPosition("alice", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
      const firstX = bobSnaps[bobSnaps.length - 1]?.players.alice?.x ?? 0;
      await room.runTick();
      const secondX = bobSnaps[bobSnaps.length - 1]?.players.alice?.x ?? 0;
      expect(secondX).toBeCloseTo(firstX);
    });
  });

  it("ignores stale input snapshots when a newer sequence has already arrived", async () => {
    const stub = makeRoomStub(roomName);
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      await wait(50);
      room.sendPosition("alice", { sequence: 2, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      room.sendPosition("alice", { sequence: 1, x: 0, y: 70, z: 19, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    const latest = bobSnaps[bobSnaps.length - 1];
    expect(latest?.players.alice?.x).toBeGreaterThan(0);
    expect(latest?.players.alice?.z).toBeCloseTo(20);
  });

  it("rejects implausible position jumps and sends authoritative self state back", async () => {
    const stub = makeRoomStub(roomName);
    const aliceSnaps: RoomSnapshot[] = [];
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      room.sendPosition("alice", { sequence: 1, x: 500, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    const aliceLatest = aliceSnaps[aliceSnaps.length - 1];
    const bobLatest = bobSnaps[bobSnaps.length - 1];
    expect(aliceLatest?.self?.x).toBeCloseTo(0);
    expect(bobLatest?.players.alice?.x).toBeCloseTo(0);
    expect(aliceLatest?.acks.alice).toBe(0);
  });

  it("stops delivering snapshots after a player leaves", async () => {
    const stub = makeRoomStub(roomName);
    const aliceSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.leave("alice");
      // Another player keeps the room ticking so broadcasts would fire
      room.join("bob", "Bob", () => {});
      await wait(50);
      room.sendPosition("bob", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
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
      await room.runTick();
    });

    const latest = bobSnaps[bobSnaps.length - 1];
    expect(latest?.players.alice).toBeUndefined();
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
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      await room.runTick(); // flush join snapshots

      disconnected = true;
      await wait(50);
      room.sendPosition("bob", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick(); // alice's callback fails → removed
      await room.runTick(); // bob sees state without alice
    });

    const latest = bobSnaps[bobSnaps.length - 1];
    expect(latest?.players.alice).toBeUndefined();
    expect(latest?.acks.bob).toBeDefined();
  });

  it("does not show a previously disconnected player to a later joiner", async () => {
    const stub = makeRoomStub(roomName);
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.leave("alice");
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      await room.runTick();
    });

    expect(bobSnaps.length).toBeGreaterThanOrEqual(1);
    const initialBobSnap = bobSnaps[0];
    expect(initialBobSnap?.players.alice).toBeUndefined();
    expect(initialBobSnap?.self).toBeDefined();
    expect(initialBobSnap?.acks.alice).toBeUndefined();
  });

  it("does not broadcast when a tick fires with no pending input", async () => {
    const stub = makeRoomStub(roomName);
    const received: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => received.push(snap));
      // First tick flushes any dirty state
      await room.runTick();
      const beforeCount = received.length;
      // Second tick: no input, no dirty, no broadcast
      await room.runTick();
      expect(received.length).toBe(beforeCount);
    });
  });

  it("keeps inventories private to each player's personalized snapshot", async () => {
    const stub = makeRoomStub(roomName);
    const aliceSnaps: RoomSnapshot[] = [];
    const bobSnaps: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => aliceSnaps.push(snap));
      room.join("bob", "Bob", (snap) => bobSnaps.push(snap));
      await room.runTick();
    });

    const aliceLatest = aliceSnaps[aliceSnaps.length - 1];
    const bobLatest = bobSnaps[bobSnaps.length - 1];

    expect(aliceLatest?.self?.inventory).toHaveLength(36);
    expect(aliceLatest?.self?.health).toBe(PLAYER_MAX_HEALTH);
    expect("inventory" in (bobLatest?.players.alice ?? {})).toBe(false);
    expect("inventory" in (aliceLatest?.players.bob ?? {})).toBe(false);
    expect("health" in (bobLatest?.players.alice ?? {})).toBe(false);
    expect("health" in (aliceLatest?.players.bob ?? {})).toBe(false);
  });

  it("crafts through the personal 2x2 grid and returns temporary items on close", async () => {
    const stub = makeRoomStub(roomName);
    const received: RoomSnapshot[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (snap) => received.push(snap));
      await room.runTick();

      room.clickInventory("alice", { container: "inventory", index: 27 });
      room.clickInventory("alice", { container: "crafting", index: 0 });
      await room.runTick();

      room.clickInventory("alice", { container: "result" });
      await room.runTick();

      room.closeInventory("alice");
      await room.runTick();
    });

    const craftingSnap = received.findLast((snap) => snap.inventoryUi?.result?.itemId === "wood_plank");
    const latest = received[received.length - 1];

    expect(craftingSnap?.inventoryUi?.result).toEqual({ itemId: "wood_plank", quantity: 4 });
    expect(latest?.inventoryUi?.craftingGrid.every((slot) => slot === null)).toBe(true);
    expect(latest?.inventoryUi?.cursor).toBeNull();
    expect(latest?.self?.inventory[0]).toEqual({ itemId: "wood", quantity: 19 });
    expect(latest?.self?.inventory[27]).toBeNull();
    expect(latest?.self?.inventory[28]).toEqual({ itemId: "wood_plank", quantity: 20 });
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
    // First snapshot arrives on the next server tick (tick-aligned).
    await waitFor(() => received.length >= 1);
    expect(received[0]?.self?.y).toBeCloseTo(70);
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
        return names.includes("alice");
      });
    }

    await waitFor(() => {
      const latest = bobSnaps[bobSnaps.length - 1];
      if (!latest) return false;
      const names = Object.values(latest.players).map((p) => p.name);
      return !names.includes("alice");
    }, 2000);
  }, 4000);
});
