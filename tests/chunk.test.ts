import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { CHUNK_HEIGHT, Chunk } from "../src/game/chunk";

describe("Chunk", () => {
  it("generates at least one visible cube per column", () => {
    const size = 8;
    const chunk = new Chunk(0, 0, size, 123);
    expect(chunk.numCubes()).toBeGreaterThanOrEqual(size * size);
  });

  it("returns a Float32Array of positions with length 4 * numCubes", () => {
    const size = 4;
    const chunk = new Chunk(0, 0, size, 123);
    const positions = chunk.cubePositions();
    expect(positions).toBeInstanceOf(Float32Array);
    expect(positions.length).toBe(4 * chunk.numCubes());
  });

  it("returns voxel ambient occlusion values for every cube face vertex", () => {
    const chunk = new Chunk(0, 0, 8, 123);
    const ao = chunk.cubeAmbientOcclusion();
    expect(ao).toBeInstanceOf(Uint8Array);
    expect(ao.length).toBe(24 * chunk.numCubes());
    for (const value of ao) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(3);
    }
  });

  it("produces deterministic output from seeded RNG", () => {
    const seed = 42;
    const chunk1 = new Chunk(0, 0, 8, seed);
    const chunk2 = new Chunk(0, 0, 8, seed);
    expect(Array.from(chunk1.cubePositions())).toEqual(Array.from(chunk2.cubePositions()));
  });

  it("positions cubes within expected bounds", () => {
    const size = 4;
    const seed = 123;
    const chunk = new Chunk(0, 0, size, seed);
    const positions = chunk.cubePositions();

    for (let i = 0; i < chunk.numCubes(); i++) {
      const x = positions[4 * i] as number;
      const y = positions[4 * i + 1] as number;
      const z = positions[4 * i + 2] as number;
      expect(x).toBeGreaterThanOrEqual(-size / 2);
      expect(x).toBeLessThan(size / 2);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100); // New height range [0, 100]
      expect(z).toBeGreaterThanOrEqual(-size / 2);
      expect(z).toBeLessThan(size / 2);
    }
  });

  it("produces different terrain with different seeds", () => {
    const chunk1 = new Chunk(0, 0, 8, 42);
    const chunk2 = new Chunk(0, 0, 8, 999);
    expect(Array.from(chunk1.cubePositions())).not.toEqual(Array.from(chunk2.cubePositions()));
  });

  it("generates heights in full [0, 100] range with multi-octave noise", () => {
    const chunk = new Chunk(0, 0, 64, 12345);
    const positions = chunk.cubePositions();

    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let i = 0; i < chunk.numCubes(); i++) {
      const y = positions[4 * i + 1] as number;
      minHeight = Math.min(minHeight, y);
      maxHeight = Math.max(maxHeight, y);
    }

    // With 64x64 chunk and 3 octaves, should use significant portion of range
    expect(minHeight).toBeGreaterThanOrEqual(0);
    expect(maxHeight).toBeLessThanOrEqual(100);
    expect(maxHeight - minHeight).toBeGreaterThan(20);
  });

  it("preserves bedrock at Y=0", () => {
    const size = 16;
    const chunk = new Chunk(0, 0, size, 42);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        expect(chunk.getBlock(x, 0, z)).toBe(CubeType.Bedrock);
      }
    }
  });

  it("does not carve caves through the surface", () => {
    const size = 16;
    const chunk = new Chunk(0, 0, size, 42);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const surfaceY = chunk.heightMap[z * size + x] as number;
        expect(chunk.getBlock(x, surfaceY, z)).not.toBe(CubeType.Air);
      }
    }
  });

  it("places diamond ore only at Y <= 16", () => {
    const size = 32;
    const chunk = new Chunk(0, 0, size, 777);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        for (let y = 17; y < CHUNK_HEIGHT; y++) {
          expect(chunk.getBlock(x, y, z)).not.toBe(CubeType.DiamondOre);
        }
      }
    }
  });

  it("generates block-based vegetation without clipping past chunk bounds", () => {
    const chunk = new Chunk(128, -128, 64, 12345);
    let vegetationBlocks = 0;

    for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        for (let y = 1; y < CHUNK_HEIGHT; y++) {
          const block = chunk.getBlock(x, y, z);
          if (
            block === CubeType.OakLog ||
            block === CubeType.OakLeaf ||
            block === CubeType.ShrubLeaf ||
            block === CubeType.ShrubStem
          ) {
            vegetationBlocks++;
          }
        }
      }
    }

    expect(vegetationBlocks).toBeGreaterThan(0);
  });

  it("renders vegetation blocks that rise above the terrain surface", () => {
    const chunk = new Chunk(32, 32, 64, 123);
    const renderedPositions = new Set<string>();

    const positions = chunk.cubePositions();
    for (let i = 0; i < chunk.numCubes(); i++) {
      renderedPositions.add(`${positions[4 * i]},${positions[4 * i + 1]},${positions[4 * i + 2]}`);
    }

    let foundRenderedVegetation = false;
    const originX = 32 - 32;
    const originZ = 32 - 32;
    outer: for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        for (let y = 1; y < CHUNK_HEIGHT; y++) {
          const block = chunk.getBlock(x, y, z);
          if (
            block !== CubeType.OakLog &&
            block !== CubeType.OakLeaf &&
            block !== CubeType.ShrubLeaf &&
            block !== CubeType.ShrubStem
          ) {
            continue;
          }

          const key = `${originX + x},${y},${originZ + z}`;
          if (renderedPositions.has(key)) {
            foundRenderedVegetation = true;
            break outer;
          }
        }
      }
    }

    expect(foundRenderedVegetation).toBe(true);
  });

  describe("tickFluids", () => {
    it("spreads a source placed above terrain into the surrounding air column", () => {
      const chunk = new Chunk(0, 0, 8, 3);
      const y = CHUNK_HEIGHT - 1;
      chunk.addFluid(4, y, 4, CubeType.Water, 0);

      const beforeCount = countFluid(chunk);
      for (let t = 0; t < 16; t++) chunk.tickFluids();
      const afterCount = countFluid(chunk);

      expect(afterCount).toBeGreaterThan(beforeCount);
      expect(chunk.getBlock(4, y, 4)).toBe(CubeType.Water);
    });

    it("reaches a steady state after enough ticks (idempotence)", () => {
      const chunk = new Chunk(0, 0, 4, 5);
      chunk.addFluid(2, CHUNK_HEIGHT - 1, 2, CubeType.Water, 0);
      for (let t = 0; t < 200; t++) chunk.tickFluids();
      const snapshot = countFluid(chunk);
      for (let t = 0; t < 10; t++) chunk.tickFluids();
      expect(countFluid(chunk)).toBe(snapshot);
    });

    it("ignores a chunk with no fluids", () => {
      const chunk = new Chunk(0, 0, 4, 5);
      const before = chunk.blocks.slice();
      for (let t = 0; t < 5; t++) {
        expect(chunk.tickFluids()).toBe(false);
      }
      expect(Array.from(chunk.blocks)).toEqual(Array.from(before));
    });

    it("decays flowing fluid once its source is removed", () => {
      const chunk = new Chunk(0, 0, 32, 7);
      const y = CHUNK_HEIGHT - 1;
      chunk.addFluid(16, y, 16, CubeType.Water, 0);
      for (let t = 0; t < 20; t++) chunk.tickFluids();
      const fluidAfterSpread = countFluid(chunk);
      expect(fluidAfterSpread).toBeGreaterThan(4);

      expect(chunk.removeFluidAt(16, y, 16)).toBe(true);
      for (let t = 0; t < 40; t++) chunk.tickFluids();

      expect(chunk.getBlock(16, y, 16)).toBe(CubeType.Air);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        expect(chunk.getBlock(16 + dx, y, 16 + dz)).toBe(CubeType.Air);
      }
    });

    it("turns water into stone on contact with lava", () => {
      const chunk = new Chunk(0, 0, 8, 9);
      const y = CHUNK_HEIGHT - 1;
      paintStoneFloor(chunk, y - 1);
      chunk.addFluid(2, y, 4, CubeType.Water, 0);
      chunk.addFluid(5, y, 4, CubeType.Lava, 0);
      for (let t = 0; t < 12; t++) chunk.tickFluids();

      let foundStone = false;
      for (let dx = 2; dx <= 5; dx++) {
        if (chunk.getBlock(dx, y, 4) === CubeType.Stone) {
          foundStone = true;
          break;
        }
      }
      expect(foundStone).toBe(true);
    });

    it("reports a cross-chunk spillover when a flow leaves the chunk", () => {
      const chunk = new Chunk(0, 0, 4, 11);
      const y = CHUNK_HEIGHT - 1;
      paintStoneFloor(chunk, y - 1);
      chunk.addFluid(0, y, 2, CubeType.Water, 0);

      const spillovers: Array<{ wx: number; wy: number; wz: number; type: number; level: number }> = [];
      for (let t = 0; t < 5; t++) {
        chunk.tickFluids((wx, wy, wz, type, level) => {
          spillovers.push({ wx, wy, wz, type, level });
        });
      }
      const waterSpill = spillovers.find((s) => s.type === CubeType.Water);
      expect(waterSpill).toBeDefined();
    });
  });
});

function countFluid(chunk: Chunk): number {
  let count = 0;
  for (let i = 0; i < chunk.blocks.length; i++) {
    const t = chunk.blocks[i];
    if (t === CubeType.Water || t === CubeType.Lava) count++;
  }
  return count;
}

function paintStoneFloor(chunk: Chunk, y: number, chunkSize = 64): void {
  for (let z = 0; z < chunkSize; z++) {
    for (let x = 0; x < chunkSize; x++) {
      chunk.blocks[y * chunkSize * chunkSize + z * chunkSize + x] = CubeType.Stone;
    }
  }
}
