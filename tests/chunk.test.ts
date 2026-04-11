import { describe, expect, it } from "vitest";
import { Chunk } from "../src/minceraft/Chunk.js";

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
    const chunk1 = new Chunk(0, 0, 8);
    const chunk2 = new Chunk(0, 0, 8);
    expect(Array.from(chunk1.cubePositions())).toEqual(Array.from(chunk2.cubePositions()));
  });

  it("positions cubes within expected bounds", () => {
    const size = 4;
    const chunk = new Chunk(0, 0, size);
    const positions = chunk.cubePositions();

    for (let i = 0; i < chunk.numCubes(); i++) {
      const x = positions[4 * i] as number;
      const y = positions[4 * i + 1] as number;
      const z = positions[4 * i + 2] as number;
      expect(x).toBeGreaterThanOrEqual(-size / 2);
      expect(x).toBeLessThan(size / 2);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(10);
      expect(z).toBeGreaterThanOrEqual(-size / 2);
      expect(z).toBeLessThan(size / 2);
    }
  });
});
