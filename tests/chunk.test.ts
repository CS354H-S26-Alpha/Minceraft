import { describe, expect, it } from "vitest";
import { Chunk } from "../src/game/chunk";

describe("Chunk", () => {
  it("generates the correct number of cubes", () => {
    const chunk = new Chunk(0, 0, 8);
    expect(chunk.numCubes()).toBe(64);
  });

  it("returns a Float32Array of positions with length 4 * numCubes", () => {
    const size = 4;
    const chunk = new Chunk(0, 0, size);
    const positions = chunk.cubePositions();
    expect(positions).toBeInstanceOf(Float32Array);
    expect(positions.length).toBe(4 * size * size);
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
});
