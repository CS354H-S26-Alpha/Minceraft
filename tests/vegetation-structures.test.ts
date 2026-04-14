import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { PlacedObjectType } from "../src/game/object-placement";
import {
  canPlaceVegetationTemplate,
  pickVegetationTemplate,
  placeVegetationTemplate,
  vegetationTemplatesFor,
} from "../src/game/vegetation-structures";

function makeAccess(overrides: Partial<Record<string, CubeType>> = {}) {
  const placed = new Map<string, CubeType>();
  for (const [key, value] of Object.entries(overrides)) {
    placed.set(key, value);
  }

  return {
    chunkHeight: 128,
    chunkSize: 64,
    getBlock(localX: number, y: number, localZ: number) {
      return placed.get(`${localX},${y},${localZ}`) ?? CubeType.Air;
    },
    setBlock(localX: number, y: number, localZ: number, type: CubeType) {
      placed.set(`${localX},${y},${localZ}`, type);
    },
    placed,
  };
}

describe("vegetation structures", () => {
  it("selects deterministic templates for a tree anchor", () => {
    const first = pickVegetationTemplate(123, PlacedObjectType.Tree, 14, -28);
    const second = pickVegetationTemplate(123, PlacedObjectType.Tree, 14, -28);

    expect(first.id).toBe(second.id);
  });

  it("rejects templates that would cross chunk bounds", () => {
    const access = makeAccess();
    const template = vegetationTemplatesFor(PlacedObjectType.Tree)[2];
    expect(template).toBeDefined();
    if (!template) throw new Error("missing tree template");

    expect(canPlaceVegetationTemplate(access, 0, 64, 0, template)).toBe(false);
  });

  it("rejects templates that intersect existing blocks", () => {
    const access = makeAccess({ "10,66,10": CubeType.Stone });
    const template = vegetationTemplatesFor(PlacedObjectType.Tree)[0];
    expect(template).toBeDefined();
    if (!template) throw new Error("missing tree template");

    expect(canPlaceVegetationTemplate(access, 10, 64, 10, template)).toBe(false);
  });

  it("places shrub blocks into the chunk grid", () => {
    const access = makeAccess();
    const template = vegetationTemplatesFor(PlacedObjectType.Shrub)[0];
    expect(template).toBeDefined();
    if (!template) throw new Error("missing shrub template");

    expect(canPlaceVegetationTemplate(access, 20, 64, 20, template)).toBe(true);
    placeVegetationTemplate(access, 20, 64, 20, template);

    expect(access.placed.get("20,65,20")).toBe(CubeType.ShrubStem);
    expect(access.placed.get("20,66,20")).toBe(CubeType.ShrubLeaf);
  });

  it("places cactus columns into the chunk grid", () => {
    const access = makeAccess();
    const template = vegetationTemplatesFor(PlacedObjectType.Cactus)[1];
    expect(template).toBeDefined();
    if (!template) throw new Error("missing cactus template");

    expect(canPlaceVegetationTemplate(access, 22, 64, 22, template)).toBe(true);
    placeVegetationTemplate(access, 22, 64, 22, template);

    expect(access.placed.get("22,65,22")).toBe(CubeType.Cactus);
    expect(access.placed.get("22,67,22")).toBe(CubeType.Cactus);
  });

  it("includes branched cactus silhouettes", () => {
    const templates = vegetationTemplatesFor(PlacedObjectType.Cactus);
    expect(templates.some((template) => template.blocks.some((block) => block.dx !== 0 || block.dz !== 0))).toBe(true);
  });
});
