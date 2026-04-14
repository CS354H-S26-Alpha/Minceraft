import { describe, expect, it } from "vitest";
import { Biome } from "../src/game/biome";
import { type PlacedObject, PlacedObjectCategory, PlacedObjectType } from "../src/game/object-placement";
import { filterRenderablePlacedObjects } from "../src/game/object-placement-render";

function object(overrides: Partial<PlacedObject> = {}): PlacedObject {
  return {
    type: PlacedObjectType.Grass,
    category: PlacedObjectCategory.Decorative,
    x: 0,
    y: 65,
    z: 0,
    rotationY: 0,
    scale: 1,
    biome: Biome.Forest,
    chunkOriginX: -32,
    chunkOriginZ: -32,
    renderTypeIndex: 0,
    tags: [],
    ...overrides,
  };
}

describe("placed object render filtering", () => {
  it("culls small decorative objects beyond their render radius", () => {
    const nearGrass = object({ x: 10, z: 0 });
    const farGrass = object({ x: 60, z: 0 });

    expect(filterRenderablePlacedObjects([nearGrass, farGrass], 0, 0)).toEqual([nearGrass]);
  });

  it("keeps nearby flowers but culls distant ones aggressively", () => {
    const nearFlower = object({
      type: PlacedObjectType.FlowerPoppy,
      renderTypeIndex: 3,
      x: 12,
      z: 0,
    });
    const farFlower = object({
      type: PlacedObjectType.FlowerDandelion,
      renderTypeIndex: 2,
      x: 44,
      z: 0,
    });

    expect(filterRenderablePlacedObjects([nearFlower, farFlower], 0, 0)).toEqual([nearFlower]);
  });

  it("keeps sparse landmark objects visible farther away", () => {
    const tree = object({
      type: PlacedObjectType.Tree,
      renderTypeIndex: 3,
      x: 80,
      z: 0,
    });
    const spawn = object({
      type: PlacedObjectType.EnemySpawn,
      category: PlacedObjectCategory.Gameplay,
      renderTypeIndex: 4,
      x: 84,
      z: 0,
    });

    expect(filterRenderablePlacedObjects([tree, spawn], 0, 0)).toEqual([tree, spawn]);
  });

  it("thins far grass deterministically instead of flickering", () => {
    const grassA = object({ x: 30.1, z: 0.2 });
    const grassB = object({ x: 31.1, z: 0.2 });

    const first = filterRenderablePlacedObjects([grassA, grassB], 0, 0);
    const second = filterRenderablePlacedObjects([grassA, grassB], 0, 0);

    expect(first).toEqual(second);
  });
});
