import { describe, expect, it } from "vitest";
import { Cube } from "../src/minceraft/Cube.js";

describe("Cube", () => {
  it("has 24 vertices (6 faces * 4 vertices)", () => {
    const cube = new Cube();
    expect(cube.positionsFlat().length).toBe(24 * 4);
  });

  it("has 36 indices (12 triangles * 3 vertices)", () => {
    const cube = new Cube();
    expect(cube.indicesFlat().length).toBe(36);
  });

  it("has 24 normals matching vertex count", () => {
    const cube = new Cube();
    expect(cube.normalsFlat().length).toBe(24 * 4);
  });

  it("has 24 UV coordinates matching vertex count", () => {
    const cube = new Cube();
    expect(cube.uvFlat().length).toBe(24 * 2);
  });

  it("returns Float32Array for positions", () => {
    const cube = new Cube();
    expect(cube.positionsFlat()).toBeInstanceOf(Float32Array);
  });

  it("returns Uint32Array for indices", () => {
    const cube = new Cube();
    expect(cube.indicesFlat()).toBeInstanceOf(Uint32Array);
  });

  it("has all indices within valid vertex range", () => {
    const cube = new Cube();
    const indices = cube.indicesFlat();
    const vertexCount = cube.positionsFlat().length / 4;
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertexCount);
    }
  });

  it("has unit-length normals", () => {
    const cube = new Cube();
    const normals = cube.normalsFlat();
    for (let i = 0; i < normals.length; i += 4) {
      const x = normals[i] as number;
      const y = normals[i + 1] as number;
      const z = normals[i + 2] as number;
      const length = Math.sqrt(x * x + y * y + z * z);
      expect(length).toBeCloseTo(1.0);
    }
  });
});
