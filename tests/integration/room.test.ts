import { runInDurableObject } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import { beforeEach, describe, expect, it } from "vitest";
import { PLAYER_MAX_HEALTH } from "../../src/game/player";
import type { GameApi, ServerPacket, ServerTick } from "../../src/game/protocol.ts";
import type { GameRoom } from "../../src/game/room.ts";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the first packet matching `type` inside a `ServerTick`, or
 * `undefined` if none exists. Typed via the `ServerPacket` discriminated
 * union so the returned packet has the correct shape.
 */
function findPacket<T extends ServerPacket["type"]>(
  tick: ServerTick | undefined,
  type: T,
): Extract<ServerPacket, { type: T }> | undefined {
  if (!tick) return undefined;
  return tick.packets.find((p): p is Extract<ServerPacket, { type: T }> => p.type === type);
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

  it("creates a player on join and reports it in the tick", async () => {
    const stub = makeRoomStub(roomName);
    const received: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => received.push(tick));
      await room.runTick();
    });

    expect(received).toHaveLength(1);
    const [tick] = received;
    const reconcile = findPacket(tick, "reconcile");
    expect(reconcile?.state).toBeDefined();
    expect(reconcile?.state.x).toBeCloseTo(0);
    expect(reconcile?.state.y).toBeCloseTo(70);
    expect(reconcile?.state.z).toBeCloseTo(20);
    expect(reconcile?.state.health).toBe(PLAYER_MAX_HEALTH);
    expect(reconcile?.state.inventory).toHaveLength(36);
    expect(findPacket(tick, "inventoryUi")?.ui.craftingGrid).toHaveLength(4);
  });

  it("applies buffered input on the next tick and broadcasts to listeners", async () => {
    const stub = makeRoomStub(roomName);
    const aliceTicks: ServerTick[] = [];
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => aliceTicks.push(tick));
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      await wait(50);
      room.sendPosition("alice", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    // Bob sees alice's movement; alice's own state is not in her `players` packet.
    const bobLatest = bobTicks[bobTicks.length - 1];
    expect(findPacket(bobLatest, "players")?.players.alice?.x).toBeGreaterThan(0);
    expect(bobLatest?.tick).toBeGreaterThanOrEqual(1);
    const aliceLatest = aliceTicks[aliceTicks.length - 1];
    expect(findPacket(aliceLatest, "players")?.players.alice).toBeUndefined();
  });

  it("broadcasts each player's input to every listener in the room", async () => {
    const stub = makeRoomStub(roomName);
    const aliceTicks: ServerTick[] = [];
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => aliceTicks.push(tick));
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      await wait(50);
      room.sendPosition("alice", { sequence: 1, x: 0, y: 70, z: 19, yaw: 0, pitch: 0 });
      room.sendPosition("bob", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    const aliceLatest = aliceTicks[aliceTicks.length - 1];
    const bobLatest = bobTicks[bobTicks.length - 1];
    // Each player sees the other but not themselves.
    expect(findPacket(aliceLatest, "players")?.players.alice).toBeUndefined();
    expect(findPacket(aliceLatest, "players")?.players.bob?.x).toBeGreaterThan(0);
    expect(findPacket(bobLatest, "players")?.players.bob).toBeUndefined();
    expect(findPacket(bobLatest, "players")?.players.alice?.z).toBeLessThan(20);
  });

  it("keeps simulating movement across ticks from the latest input state", async () => {
    const stub = makeRoomStub(roomName);
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      await wait(50);
      room.sendPosition("alice", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
      const firstX = findPacket(bobTicks[bobTicks.length - 1], "players")?.players.alice?.x ?? 0;
      await room.runTick();
      const secondX = findPacket(bobTicks[bobTicks.length - 1], "players")?.players.alice?.x ?? 0;
      expect(secondX).toBeCloseTo(firstX);
    });
  });

  it("ignores stale input snapshots when a newer sequence has already arrived", async () => {
    const stub = makeRoomStub(roomName);
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      await wait(50);
      room.sendPosition("alice", { sequence: 2, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      room.sendPosition("alice", { sequence: 1, x: 0, y: 70, z: 19, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    const latest = bobTicks[bobTicks.length - 1];
    const players = findPacket(latest, "players")?.players;
    expect(players?.alice?.x).toBeGreaterThan(0);
    expect(players?.alice?.z).toBeCloseTo(20);
  });

  it("rejects implausible position jumps and sends authoritative self state back", async () => {
    const stub = makeRoomStub(roomName);
    const aliceTicks: ServerTick[] = [];
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => aliceTicks.push(tick));
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      room.sendPosition("alice", { sequence: 1, x: 500, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    const aliceLatest = aliceTicks[aliceTicks.length - 1];
    const bobLatest = bobTicks[bobTicks.length - 1];
    expect(findPacket(aliceLatest, "reconcile")?.state.x).toBeCloseTo(0);
    expect(findPacket(bobLatest, "players")?.players.alice?.x).toBeCloseTo(0);
    expect(findPacket(aliceLatest, "ack")?.sequence).toBe(0);
  });

  it("stops delivering ticks after a player leaves", async () => {
    const stub = makeRoomStub(roomName);
    const aliceTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => aliceTicks.push(tick));
      room.leave("alice");
      // Another player keeps the room ticking so broadcasts would fire
      room.join("bob", "Bob", () => {});
      await wait(50);
      room.sendPosition("bob", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      const initialCount = aliceTicks.length;
      await room.runTick();
      expect(aliceTicks.length).toBe(initialCount);
    });
  });

  it("removes offline players from ticks", async () => {
    const stub = makeRoomStub(roomName);
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      room.leave("alice");
      await room.runTick();
    });

    const latest = bobTicks[bobTicks.length - 1];
    expect(findPacket(latest, "players")?.players.alice).toBeUndefined();
    expect(findPacket(latest, "ack")?.sequence).toBe(0);
  });

  it("accepts a fresh sequence counter from a reconnected player", async () => {
    const stub = makeRoomStub(roomName);
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      let aliceBroken = false;
      room.join("alice", "Alice", () => {
        if (aliceBroken) throw new Error("connection lost");
      });
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));

      // Alice's first session advances the server-side ack counter to 1.
      room.sendPosition("alice", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();

      // Simulate a dropped connection: the listener throws during the next
      // broadcast, so the room removes her via the broken-listener path. The
      // client-facing leave() is never called — mirrors a WebSocket drop.
      aliceBroken = true;
      await room.runTick();

      // Alice reconnects with a fresh sequence counter starting at 1. Before
      // the fix the server still had acks["alice"] = 1 and silently dropped
      // this packet as "stale" — leaving her position frozen for Bob.
      room.join("alice", "Alice", () => {});
      room.sendPosition("alice", { sequence: 1, x: 1.5, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick();
    });

    const bobLatest = bobTicks[bobTicks.length - 1];
    expect(findPacket(bobLatest, "players")?.players.alice?.x).toBeCloseTo(1.5);
  });

  it("removes players when their tick delivery fails", async () => {
    const stub = makeRoomStub(roomName);
    const bobTicks: ServerTick[] = [];
    let disconnected = false;

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {
        if (disconnected) throw new Error("connection lost");
      });
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      await room.runTick(); // flush join ticks

      disconnected = true;
      await wait(50);
      room.sendPosition("bob", { sequence: 1, x: 1, y: 70, z: 20, yaw: 0, pitch: 0 });
      await room.runTick(); // alice's callback fails → removed
      await room.runTick(); // bob sees state without alice
    });

    const latest = bobTicks[bobTicks.length - 1];
    expect(findPacket(latest, "players")?.players.alice).toBeUndefined();
  });

  it("does not show a previously disconnected player to a later joiner", async () => {
    const stub = makeRoomStub(roomName);
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", () => {});
      room.leave("alice");
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      await room.runTick();
    });

    expect(bobTicks.length).toBeGreaterThanOrEqual(1);
    const initialBobTick = bobTicks[0];
    expect(findPacket(initialBobTick, "players")?.players.alice).toBeUndefined();
    expect(findPacket(initialBobTick, "reconcile")?.state).toBeDefined();
  });

  it("does not broadcast when a tick fires with no pending input", async () => {
    const stub = makeRoomStub(roomName);
    const received: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => received.push(tick));
      // First tick flushes any dirty state
      await room.runTick();
      const beforeCount = received.length;
      // Second tick: no input, no dirty, no broadcast
      await room.runTick();
      expect(received.length).toBe(beforeCount);
    });
  });

  it("keeps inventories private to each player's personalized packets", async () => {
    const stub = makeRoomStub(roomName);
    const aliceTicks: ServerTick[] = [];
    const bobTicks: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => aliceTicks.push(tick));
      room.join("bob", "Bob", (tick) => bobTicks.push(tick));
      await room.runTick();
    });

    const aliceLatest = aliceTicks[aliceTicks.length - 1];
    const bobLatest = bobTicks[bobTicks.length - 1];

    const aliceReconcile = findPacket(aliceLatest, "reconcile");
    expect(aliceReconcile?.state.inventory).toHaveLength(36);
    expect(aliceReconcile?.state.health).toBe(PLAYER_MAX_HEALTH);

    const bobPlayers = findPacket(bobLatest, "players")?.players;
    const alicePlayers = findPacket(aliceLatest, "players")?.players;
    expect("inventory" in (bobPlayers?.alice ?? {})).toBe(false);
    expect("inventory" in (alicePlayers?.bob ?? {})).toBe(false);
    expect("health" in (bobPlayers?.alice ?? {})).toBe(false);
    expect("health" in (alicePlayers?.bob ?? {})).toBe(false);
  });

  it("crafts through the personal 2x2 grid and returns temporary items on close", async () => {
    const stub = makeRoomStub(roomName);
    const received: ServerTick[] = [];

    await runInDurableObject(stub, async (room: GameRoom) => {
      room.join("alice", "Alice", (tick) => received.push(tick));
      await room.runTick();

      room.clickInventory("alice", { container: "inventory", index: 27 });
      room.clickInventory("alice", { container: "crafting", index: 0 });
      await room.runTick();

      room.clickInventory("alice", { container: "result" });
      await room.runTick();

      room.closeInventory("alice");
      await room.runTick();
    });

    const craftingTick = received.findLast(
      (tick) => findPacket(tick, "inventoryUi")?.ui.result?.itemId === "wood_plank",
    );
    const latest = received[received.length - 1];
    const latestUi = findPacket(latest, "inventoryUi")?.ui;
    const latestSelf = findPacket(latest, "self")?.state ?? findPacket(latest, "reconcile")?.state;

    expect(findPacket(craftingTick, "inventoryUi")?.ui.result).toEqual({ itemId: "wood_plank", quantity: 4 });
    expect(latestUi?.craftingGrid.every((slot) => slot === null)).toBe(true);
    expect(latestUi?.cursor).toBeNull();
    expect(latestSelf?.inventory[0]).toEqual({ itemId: "wood", quantity: 19 });
    expect(latestSelf?.inventory[27]).toBeNull();
    expect(latestSelf?.inventory[28]).toEqual({ itemId: "wood_plank", quantity: 20 });
  });
});

describe("GameServer capnweb RPC", () => {
  it("authenticates and joins a room via the capability chain", async () => {
    const api = await openWebSocketGameApi();
    const received: ServerTick[] = [];

    const auth = api.authenticate("alice");
    using roomSession = await auth.join("rpc-room", (tick: ServerTick) => {
      received.push(tick);
    });

    expect(roomSession).toBeDefined();
    // First tick arrives on the next server tick (tick-aligned).
    await waitFor(() => received.length >= 1);
    expect(findPacket(received[0], "reconcile")?.state.y).toBeCloseTo(70);
  });

  it("removes a player from other clients when they leave the room", async () => {
    const bobApi = await openWebSocketGameApi();
    const bobTicks: ServerTick[] = [];

    const bobAuth = bobApi.authenticate("bob");
    using _bobSession = await bobAuth.join("ws-room", (tick: ServerTick) => {
      bobTicks.push(tick);
    });

    {
      const aliceApi = await openWebSocketGameApi();
      const aliceAuth = aliceApi.authenticate("alice");
      using _aliceSession = await aliceAuth.join("ws-room", () => {});

      await waitFor(() => {
        const latest = bobTicks[bobTicks.length - 1];
        const players = findPacket(latest, "players")?.players;
        if (!players) return false;
        const names = Object.values(players).map((p) => p.name);
        return names.includes("alice");
      });
    }

    await waitFor(() => {
      const latest = bobTicks[bobTicks.length - 1];
      const players = findPacket(latest, "players")?.players;
      if (!players) return false;
      const names = Object.values(players).map((p) => p.name);
      return !names.includes("alice");
    }, 2000);
  }, 4000);
});
