import { describe, expect, it } from "vitest";
import { hash3D, perlin3D, perlin3DOctaves } from "../src/utils/noise";

describe("hash3D", () => {
  it("returns deterministic values", () => {
    expect(hash3D(42, 1, 2, 3)).toBe(hash3D(42, 1, 2, 3));
  });

  it("returns values in [0, 1]", () => {
    for (let i = 0; i < 100; i++) {
      const val = hash3D(i, i * 3, i * 7, i * 13);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("produces different values for different seeds", () => {
    expect(hash3D(1, 5, 5, 5)).not.toBe(hash3D(2, 5, 5, 5));
  });
});

describe("perlin3D", () => {
  it("returns deterministic values", () => {
    const a = perlin3D(42, 1.5, 2.5, 3.5, 1 / 16);
    const b = perlin3D(42, 1.5, 2.5, 3.5, 1 / 16);
    expect(a).toBe(b);
  });

  it("returns values within [-1, 1]", () => {
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * 200 - 100;
      const y = Math.random() * 200 - 100;
      const z = Math.random() * 200 - 100;
      const val = perlin3D(42, x, y, z, 1 / 8);
      expect(val).toBeGreaterThanOrEqual(-1);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("is smooth (adjacent samples differ by a small amount)", () => {
    const base = perlin3D(42, 10, 20, 30, 1 / 16);
    const nearby = perlin3D(42, 10.01, 20, 30, 1 / 16);
    expect(Math.abs(base - nearby)).toBeLessThan(0.1);
  });

  it("produces different values for different seeds", () => {
    const a = perlin3D(1, 5, 5, 5, 1 / 8);
    const b = perlin3D(2, 5, 5, 5, 1 / 8);
    expect(a).not.toBe(b);
  });
});

describe("perlin3DOctaves", () => {
  it("returns values within [-1, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 200 - 100;
      const y = Math.random() * 200 - 100;
      const z = Math.random() * 200 - 100;
      const val = perlin3DOctaves(42, x, y, z, 1 / 8, 3, 2.0, 0.5);
      expect(val).toBeGreaterThanOrEqual(-1);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic", () => {
    const a = perlin3DOctaves(99, 3, 7, 11, 1 / 16);
    const b = perlin3DOctaves(99, 3, 7, 11, 1 / 16);
    expect(a).toBe(b);
  });
});
