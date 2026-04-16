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
});
