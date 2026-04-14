import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { Biome } from "../src/game/biome";
import {
  computeLocalRelief,
  OBJECT_PLACEMENT_RULES,
  type ObjectPlacementSample,
  PLACED_OBJECT_TYPES,
  PlacedObjectType,
  RENDERABLE_PLACED_OBJECT_TYPES,
  supportsObjectPlacement,
  supportsPlacedFootprint,
} from "../src/game/object-placement";

function sample(overrides: Partial<ObjectPlacementSample> = {}): ObjectPlacementSample {
  return {
    biome: Biome.Forest,
    surfaceY: 64,
    surfaceBlock: CubeType.ForestGrass,
    northY: 64,
    southY: 64,
    eastY: 64,
    westY: 64,
    northEastY: 64,
    northWestY: 64,
    southEastY: 64,
    southWestY: 64,
    isSubmerged: false,
    distanceToChunkEdge: 4,
    ...overrides,
  };
}

describe("object placement rules", () => {
  it("defines rules for every supported object type", () => {
    expect(Object.keys(OBJECT_PLACEMENT_RULES).sort()).toEqual([...PLACED_OBJECT_TYPES].sort());
  });

  it("limits renderable placed object types to non-block props", () => {
    expect(RENDERABLE_PLACED_OBJECT_TYPES).toEqual([
      PlacedObjectType.Grass,
      PlacedObjectType.TallGrass,
      PlacedObjectType.FlowerDandelion,
      PlacedObjectType.FlowerPoppy,
      PlacedObjectType.Rock,
      PlacedObjectType.DeadBush,
      PlacedObjectType.EnemySpawn,
    ]);
  });

  it("computes local relief from neighbor heights", () => {
    expect(computeLocalRelief(sample({ northY: 66, southY: 63, eastY: 61, westY: 64 }))).toBe(3);
  });

  it("rejects rock placement when a diagonal support corner drops away", () => {
    const rockRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.Rock];
    expect(supportsObjectPlacement(rockRule, sample({ southEastY: 62, distanceToChunkEdge: 3 }))).toBe(false);
  });

  it("rejects a jittered shrub footprint that would extend onto a lower cell", () => {
    const args = {
      seed: 1,
      chunkOriginX: 0,
      chunkOriginZ: 0,
      chunkSize: 8,
      sampleAt(localX: number, localZ: number): ObjectPlacementSample {
        return sample({
          surfaceY: localX >= 3 ? 63 : 64,
          distanceToChunkEdge: Math.min(localX, localZ, 7 - localX, 7 - localZ),
        });
      },
    };

    expect(supportsPlacedFootprint(args, PlacedObjectType.Shrub, 2.82, 2.5, 64, 1)).toBe(false);
  });

  it("rejects a rock whose rendered footprint would extend onto a lower ledge", () => {
    const args = {
      seed: 1,
      chunkOriginX: 0,
      chunkOriginZ: 0,
      chunkSize: 8,
      sampleAt(localX: number, localZ: number): ObjectPlacementSample {
        const dropped = localX >= 4 && localZ >= 2 && localZ <= 3;
        return sample({
          surfaceY: dropped ? 63 : 64,
          distanceToChunkEdge: Math.min(localX, localZ, 7 - localX, 7 - localZ),
        });
      },
    };

    expect(supportsPlacedFootprint(args, PlacedObjectType.Rock, 3.5, 2.5, 64, 1)).toBe(false);
  });

  it("accepts a valid forest tree placement sample", () => {
    const treeRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.Tree];
    expect(
      supportsObjectPlacement(
        treeRule,
        sample({
          surfaceY: 72,
          northY: 72,
          southY: 72,
          eastY: 72,
          westY: 72,
          northEastY: 72,
          northWestY: 72,
          southEastY: 72,
          southWestY: 72,
          distanceToChunkEdge: 3,
        }),
      ),
    ).toBe(true);
  });

  it("rejects placement on the wrong biome", () => {
    const treeRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.Tree];
    expect(supportsObjectPlacement(treeRule, sample({ biome: Biome.Desert, surfaceBlock: CubeType.Sand }))).toBe(false);
  });

  it("rejects placement on unsupported surface blocks", () => {
    const grassRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.Grass];
    expect(supportsObjectPlacement(grassRule, sample({ surfaceBlock: CubeType.Stone }))).toBe(false);
  });

  it("accepts dandelions on flat forest grass", () => {
    const flowerRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.FlowerDandelion];
    expect(supportsObjectPlacement(flowerRule, sample({ distanceToChunkEdge: 2 }))).toBe(true);
  });

  it("rejects dead bushes on grassy forest terrain", () => {
    const deadBushRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.DeadBush];
    expect(supportsObjectPlacement(deadBushRule, sample())).toBe(false);
  });

  it("accepts cactus anchors on flat desert sand", () => {
    const cactusRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.Cactus];
    expect(
      supportsObjectPlacement(
        cactusRule,
        sample({
          biome: Biome.Desert,
          surfaceBlock: CubeType.Sand,
          distanceToChunkEdge: 2,
        }),
      ),
    ).toBe(true);
  });

  it("rejects placement on steep local terrain", () => {
    const enemyRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.EnemySpawn];
    expect(supportsObjectPlacement(enemyRule, sample({ northY: 67 }))).toBe(false);
  });

  it("rejects dry-only placement when submerged", () => {
    const shrubRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.Shrub];
    expect(supportsObjectPlacement(shrubRule, sample({ isSubmerged: true }))).toBe(false);
  });

  it("rejects placement too close to chunk edges", () => {
    const treeRule = OBJECT_PLACEMENT_RULES[PlacedObjectType.Tree];
    expect(supportsObjectPlacement(treeRule, sample({ distanceToChunkEdge: 1 }))).toBe(false);
  });
});
