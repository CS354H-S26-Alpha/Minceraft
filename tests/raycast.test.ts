import { describe, expect, it } from "vitest";
import { raycastVoxels } from "../src/client/engine/raycast";
import { CubeType } from "../src/client/engine/render/cube-types";

function makeGetBlock(blocks: Map<string, CubeType>): (wx: number, wy: number, wz: number) => CubeType {
  return (wx, wy, wz) => blocks.get(`${wx},${wy},${wz}`) ?? CubeType.Air;
}

describe("raycastVoxels", () => {
  it("hits a block directly ahead", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("5,0,0", CubeType.Stone);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    expect(hit?.blockX).toBe(5);
    expect(hit?.blockY).toBe(0);
    expect(hit?.blockZ).toBe(0);
    expect(hit?.faceNormal).toEqual([-1, 0, 0]);
    expect(hit?.blockType).toBe(CubeType.Stone);
  });

  it("hits a block in negative direction", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("-3,0,0", CubeType.Dirt);
    const hit = raycastVoxels(0.5, 0.5, 0.5, -1, 0, 0, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    expect(hit?.blockX).toBe(-3);
    expect(hit?.faceNormal).toEqual([1, 0, 0]);
  });

  it("hits a block on the Y axis", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("0,-2,0", CubeType.Grass);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 0, -1, 0, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    expect(hit?.blockY).toBe(-2);
    expect(hit?.faceNormal).toEqual([0, 1, 0]);
  });

  it("hits a block on the Z axis", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("0,0,4", CubeType.Sand);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 0, 0, 1, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    expect(hit?.blockZ).toBe(4);
    expect(hit?.faceNormal).toEqual([0, 0, -1]);
  });

  it("returns null when no block is within range", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("100,0,0", CubeType.Stone);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 6, makeGetBlock(blocks));
    expect(hit).toBeNull();
  });

  it("returns null in empty world", () => {
    const hit = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 10, () => CubeType.Air);
    expect(hit).toBeNull();
  });

  it("hits diagonal block with correct face normal", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("3,3,3", CubeType.Stone);
    const d = 1 / Math.sqrt(3);
    const hit = raycastVoxels(0.5, 0.5, 0.5, d, d, d, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    expect(hit?.blockX).toBe(3);
    expect(hit?.blockY).toBe(3);
    expect(hit?.blockZ).toBe(3);
    // The face normal should be axis-aligned (one of the three axes)
    const nonZero = hit?.faceNormal.filter((v) => v !== 0);
    expect(nonZero.length).toBe(1);
  });

  it("returns the nearest block when multiple are in the path", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("2,0,0", CubeType.Stone);
    blocks.set("5,0,0", CubeType.Dirt);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    expect(hit?.blockX).toBe(2);
    expect(hit?.blockType).toBe(CubeType.Stone);
  });

  it("detects block at origin when standing inside it", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("0,0,0", CubeType.Stone);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    expect(hit?.blockX).toBe(0);
    expect(hit?.distance).toBe(0);
  });

  it("reports correct distance", () => {
    const blocks = new Map<string, CubeType>();
    blocks.set("5,0,0", CubeType.Stone);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 10, makeGetBlock(blocks));
    expect(hit).not.toBeNull();
    // Distance from x=0.5 to the face at x=5 is 4.5
    expect(hit?.distance).toBeCloseTo(4.5, 5);
  });
});
