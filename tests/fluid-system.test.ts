import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { CHUNK_SIZE, Chunk } from "../src/game/chunk";
import type { ChunkStorage } from "../src/game/chunk-storage";
import { FluidSystem } from "../src/game/fluid-system";

/**
 * Lightweight ChunkStorage substitute exposing just the three methods
 * `FluidSystem.tick()` calls. Avoids the DurableSqlite dependency.
 */
function makeStorage(chunksByOrigin: Map<string, Chunk>) {
  const dirtyKeys = new Set<string>();
  const storage = {
    getChunk(originX: number, originZ: number): Chunk | null {
      return chunksByOrigin.get(`${originX},${originZ}`) ?? null;
    },
    *loadedChunks(): IterableIterator<Chunk> {
      for (const chunk of chunksByOrigin.values()) yield chunk;
    },
    markDirty(wx: number, wz: number): void {
      const ox = Math.floor(wx / CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE / 2;
      const oz = Math.floor(wz / CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE / 2;
      dirtyKeys.add(`${ox},${oz}`);
    },
  } as unknown as ChunkStorage;
  return { storage, dirtyKeys };
}

function emptyChunk(originX: number, originZ: number): Chunk {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 128);
  return new Chunk(originX, originZ, CHUNK_SIZE, 1, true, { blocks });
}

function setBlock(chunk: Chunk, lx: number, ly: number, lz: number, type: CubeType): void {
  chunk.blocks[ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = type;
}

function runTickNTimes(system: FluidSystem, n: number) {
  const broadcasts: boolean[] = [];
  for (let i = 0; i < n; i++) {
    broadcasts.push(system.tick() as boolean);
    system.clearPending();
  }
  return broadcasts;
}

describe("FluidSystem", () => {
  it("does nothing on ticks not aligned to the 4-tick cadence", () => {
    const chunk = emptyChunk(CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const { storage } = makeStorage(new Map([[`${CHUNK_SIZE / 2},${CHUNK_SIZE / 2}`, chunk]]));
    const system = new FluidSystem(storage);

    // Seed a source that would otherwise flow.
    chunk.addFluid(10, 10, 10, CubeType.Water);

    // Ticks 1-3: system still increments its counter but does not tick fluids.
    expect(system.tick()).toBe(false);
    expect(system.tick()).toBe(false);
    expect(system.tick()).toBe(false);
    // Tick 4: actually ticks; expect a flow downward (10,9,10 becomes water).
    expect(system.tick()).toBe(true);
    expect(chunk.getBlock(10, 9, 10)).toBe(CubeType.Water);
  });

  it("emits a blockChanges packet with the flowed cells", () => {
    const chunk = emptyChunk(CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const { storage } = makeStorage(new Map([[`${CHUNK_SIZE / 2},${CHUNK_SIZE / 2}`, chunk]]));
    const system = new FluidSystem(storage);

    chunk.addFluid(10, 10, 10, CubeType.Water);
    runTickNTimes(system, 3); // tick 4 produces changes below
    expect(system.tick()).toBe(true);

    const packets = system.packetsFor("p1", { onlinePlayerIds: new Set(["p1"]) });
    const changes = packets.flatMap((p) => (p.type === "blockChanges" ? p.changes : []));
    expect(changes.some((c) => c.x === 10 && c.y === 9 && c.z === 10 && c.blockType === CubeType.Water)).toBe(true);
  });

  it("hardens opposing fluids into stone", () => {
    const chunk = emptyChunk(CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const { storage } = makeStorage(new Map([[`${CHUNK_SIZE / 2},${CHUNK_SIZE / 2}`, chunk]]));
    const system = new FluidSystem(storage);

    // Water source sits directly above a lava source; when water flows down it
    // should harden the lava cell into Stone.
    chunk.addFluid(10, 11, 10, CubeType.Water);
    chunk.addFluid(10, 10, 10, CubeType.Lava);
    runTickNTimes(system, 3);
    system.tick();

    expect(chunk.getBlock(10, 10, 10)).toBe(CubeType.Stone);
  });

  it("routes cross-chunk spillover when the neighbour chunk is loaded", () => {
    // chunkOrigin places world coords ∈ [-32, 31] in origin-0 chunk and
    // [32, 95] in origin-64. So chunk1 at origin (0, 0), chunk2 at (CHUNK_SIZE, 0).
    const chunk1 = emptyChunk(0, 0);
    const chunk2 = emptyChunk(CHUNK_SIZE, 0);
    const { storage } = makeStorage(
      new Map([
        ["0,0", chunk1],
        [`${CHUNK_SIZE},0`, chunk2],
      ]),
    );
    const system = new FluidSystem(storage);

    // Source on chunk1's +X edge (local x = CHUNK_SIZE-1) with a stone floor
    // so it spreads laterally rather than falls.
    setBlock(chunk1, CHUNK_SIZE - 1, 9, 10, CubeType.Stone);
    chunk1.addFluid(CHUNK_SIZE - 1, 10, 10, CubeType.Water);
    // Matching stone floor in chunk2 at local (0, 9, 10) for the spillover to settle on.
    setBlock(chunk2, 0, 9, 10, CubeType.Stone);

    runTickNTimes(system, 3);
    system.tick();

    // Water should have spilled into chunk2's local (0, 10, 10).
    expect(chunk2.getBlock(0, 10, 10)).toBe(CubeType.Water);
  });

  it("does not crash when spillover targets an unloaded neighbour", () => {
    const chunk = emptyChunk(0, 0);
    const { storage } = makeStorage(new Map([["0,0", chunk]]));
    const system = new FluidSystem(storage);

    setBlock(chunk, CHUNK_SIZE - 1, 9, 10, CubeType.Stone);
    chunk.addFluid(CHUNK_SIZE - 1, 10, 10, CubeType.Water);

    runTickNTimes(system, 3);
    expect(() => system.tick()).not.toThrow();
  });

  it("spreads lava on a slower cadence than water", () => {
    const chunk = emptyChunk(CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const { storage } = makeStorage(new Map([[`${CHUNK_SIZE / 2},${CHUNK_SIZE / 2}`, chunk]]));
    const system = new FluidSystem(storage);

    chunk.addFluid(10, 10, 10, CubeType.Lava);

    // First water tick (game tick 4) — lava is paused, stays put.
    runTickNTimes(system, 3);
    system.tick();
    expect(chunk.getBlock(10, 9, 10)).toBe(CubeType.Air);

    // Second water tick (game tick 8) — lava still paused.
    runTickNTimes(system, 3);
    system.tick();
    expect(chunk.getBlock(10, 9, 10)).toBe(CubeType.Air);

    // Third water tick (game tick 12) — first lava tick, flows downward.
    runTickNTimes(system, 3);
    system.tick();
    expect(chunk.getBlock(10, 9, 10)).toBe(CubeType.Lava);
  });

  it("skips ticking when no loaded chunk has active fluids", () => {
    const chunk = emptyChunk(CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const { storage } = makeStorage(new Map([[`${CHUNK_SIZE / 2},${CHUNK_SIZE / 2}`, chunk]]));
    const system = new FluidSystem(storage);

    runTickNTimes(system, 3);
    expect(system.tick()).toBe(false);
  });
});
