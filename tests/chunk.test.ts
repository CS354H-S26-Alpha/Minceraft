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
    const chunk = new Chunk(-128, -128, 64, 12345);
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
    for (let z = 0; z < 64 && !foundRenderedVegetation; z++) {
      for (let x = 0; x < 64 && !foundRenderedVegetation; x++) {
        const surfaceY = chunk.heightMap[z * 64 + x] as number;
        for (let y = surfaceY + 1; y < CHUNK_HEIGHT; y++) {
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
            break;
          }
        }
      }
    }

    expect(foundRenderedVegetation).toBe(true);
  });
});
