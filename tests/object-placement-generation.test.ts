import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { Biome } from "../src/game/biome";
import { Chunk } from "../src/game/chunk";
import {
  generatePlacedObjectsForChunk,
  OBJECT_PLACEMENT_RULES,
  type ObjectPlacementSample,
  PlacedObjectType,
  placedObjectTypeIndex,
  supportsObjectPlacement,
  supportsPlacedFootprint,
} from "../src/game/object-placement";

function flatForestSample(localX: number, localZ: number, chunkSize: number): ObjectPlacementSample {
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
    distanceToChunkEdge: Math.min(localX, localZ, chunkSize - 1 - localX, chunkSize - 1 - localZ),
  };
}

describe("per-chunk object placement generation", () => {
  it("is deterministic for the same chunk seed and origin", () => {
    const args = {
      seed: 42,
      chunkOriginX: -32,
      chunkOriginZ: -32,
      chunkSize: 32,
      sampleAt: (localX: number, localZ: number) => flatForestSample(localX, localZ, 32),
    };

    expect(generatePlacedObjectsForChunk(args)).toEqual(generatePlacedObjectsForChunk(args));
  });

  it("changes when the seed changes", () => {
    const common = {
      chunkOriginX: -32,
      chunkOriginZ: -32,
      chunkSize: 32,
      sampleAt: (localX: number, localZ: number) => flatForestSample(localX, localZ, 32),
    };

    expect(generatePlacedObjectsForChunk({ seed: 42, ...common })).not.toEqual(
      generatePlacedObjectsForChunk({ seed: 99, ...common }),
    );
  });

  it("produces only valid object placements for a chunk", () => {
    const chunk = new Chunk(0, 0, 64, 12345);
    const chunkOriginX = -32;
    const chunkOriginZ = -32;
    // Use terrainHeightMap (pre-vegetation) so relief/surfaceBlock checks match placement conditions.
    const th = chunk.terrainHeightMap;
    const chunkArgs = {
      seed: 12345,
      chunkOriginX,
      chunkOriginZ,
      chunkSize: 64,
      sampleAt(localX: number, localZ: number): ObjectPlacementSample {
        const idx = localZ * 64 + localX;
        const surfaceY = th[idx] as number;
        const center = surfaceY;
        return {
          biome: chunk.biomeMap[idx] as Biome,
          surfaceY,
          surfaceBlock: chunk.getBlock(localX, surfaceY, localZ),
          northY: localZ > 0 ? (th[(localZ - 1) * 64 + localX] as number) : center,
          southY: localZ + 1 < 64 ? (th[(localZ + 1) * 64 + localX] as number) : center,
          eastY: localX + 1 < 64 ? (th[localZ * 64 + localX + 1] as number) : center,
          westY: localX > 0 ? (th[localZ * 64 + localX - 1] as number) : center,
          northEastY: localZ > 0 && localX + 1 < 64 ? (th[(localZ - 1) * 64 + localX + 1] as number) : center,
          northWestY: localZ > 0 && localX > 0 ? (th[(localZ - 1) * 64 + localX - 1] as number) : center,
          southEastY: localZ + 1 < 64 && localX + 1 < 64 ? (th[(localZ + 1) * 64 + localX + 1] as number) : center,
          southWestY: localZ + 1 < 64 && localX > 0 ? (th[(localZ + 1) * 64 + localX - 1] as number) : center,
          isSubmerged: false,
          distanceToChunkEdge: Math.min(localX, localZ, 63 - localX, 63 - localZ),
        };
      },
    };

    expect(chunk.placedObjects().length).toBeGreaterThan(0);
    for (const object of chunk.placedObjects()) {
      const localX = Math.floor(object.x - chunkOriginX);
      const localZ = Math.floor(object.z - chunkOriginZ);
      const idx = localZ * 64 + localX;
      const surfaceY = th[idx] as number;
      const center = surfaceY;

      const sample: ObjectPlacementSample = {
        biome: chunk.biomeMap[idx] as Biome,
        surfaceY,
        surfaceBlock: chunk.getBlock(localX, surfaceY, localZ),
        northY: localZ > 0 ? (th[(localZ - 1) * 64 + localX] as number) : center,
        southY: localZ + 1 < 64 ? (th[(localZ + 1) * 64 + localX] as number) : center,
        eastY: localX + 1 < 64 ? (th[localZ * 64 + localX + 1] as number) : center,
        westY: localX > 0 ? (th[localZ * 64 + localX - 1] as number) : center,
        northEastY: localZ > 0 && localX + 1 < 64 ? (th[(localZ - 1) * 64 + localX + 1] as number) : center,
        northWestY: localZ > 0 && localX > 0 ? (th[(localZ - 1) * 64 + localX - 1] as number) : center,
        southEastY: localZ + 1 < 64 && localX + 1 < 64 ? (th[(localZ + 1) * 64 + localX + 1] as number) : center,
        southWestY: localZ + 1 < 64 && localX > 0 ? (th[(localZ + 1) * 64 + localX - 1] as number) : center,
        isSubmerged: false,
        distanceToChunkEdge: Math.min(localX, localZ, 63 - localX, 63 - localZ),
      };

      expect(supportsObjectPlacement(OBJECT_PLACEMENT_RULES[object.type], sample)).toBe(true);
      expect(supportsPlacedFootprint(chunkArgs, object.type, object.x, object.z, surfaceY, object.scale)).toBe(true);
      expect(object.y).toBeGreaterThanOrEqual(surfaceY + 0.4);
      expect(object.y).toBeLessThanOrEqual(surfaceY + 1.05);
      expect(object.chunkOriginX).toBe(chunkOriginX);
      expect(object.chunkOriginZ).toBe(chunkOriginZ);
      expect(object.renderTypeIndex).toBe(placedObjectTypeIndex(object.type));
      expect(object.type).not.toBe(PlacedObjectType.Tree);
      expect(object.type).not.toBe(PlacedObjectType.Shrub);
    }
  });

  it("builds tree and shrub anchors into chunk blocks instead of render props", () => {
    let oakLogCount = 0;
    let oakLeafCount = 0;
    let shrubLeafCount = 0;
    const renderableTypes = new Set<PlacedObjectType>();

    for (const [centerX, centerZ] of [[128, -128]]) {
      const chunk = new Chunk(centerX, centerZ, 64, 12345);
      for (let z = 0; z < 64; z++) {
        for (let x = 0; x < 64; x++) {
          for (let y = 1; y < 128; y++) {
            const block = chunk.getBlock(x, y, z);
            if (block === CubeType.OakLog) oakLogCount++;
            if (block === CubeType.OakLeaf) oakLeafCount++;
            if (block === CubeType.ShrubLeaf) shrubLeafCount++;
          }
        }
      }
      for (const object of chunk.placedObjects()) {
        renderableTypes.add(object.type);
      }
    }

    expect(oakLogCount).toBeGreaterThan(0);
    expect(oakLeafCount).toBeGreaterThan(0);
    expect(shrubLeafCount).toBeGreaterThan(0);
    expect(renderableTypes.has(PlacedObjectType.Tree)).toBe(false);
    expect(renderableTypes.has(PlacedObjectType.Shrub)).toBe(false);
  });

  it("generates dead bushes as renderable props in desert chunks", () => {
    const chunk = new Chunk(288, 96, 64, 123);
    const counts = chunk.placedObjectCounts();

    expect(counts[PlacedObjectType.DeadBush]).toBeGreaterThan(0);
    expect(chunk.placedObjects().some((object) => object.type === PlacedObjectType.DeadBush)).toBe(true);
  });

  it("builds cactus anchors into cactus blocks instead of render props", () => {
    const chunk = new Chunk(224, 32, 64, 123);
    let cactusBlocks = 0;

    for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        for (let y = 1; y < 128; y++) {
          if (chunk.getBlock(x, y, z) === CubeType.Cactus) cactusBlocks++;
        }
      }
    }

    expect(cactusBlocks).toBeGreaterThan(0);
    expect(chunk.placedObjects().some((object) => object.type === PlacedObjectType.Cactus)).toBe(false);
    expect(chunk.placedObjectCounts()[PlacedObjectType.Cactus]).toBeGreaterThan(0);
  });

  it("keeps generated objects inside the chunk bounds", () => {
    const chunk = new Chunk(0, 0, 64, 12345);

    for (const object of chunk.placedObjects()) {
      expect(object.x).toBeGreaterThanOrEqual(-32);
      expect(object.x).toBeLessThan(32);
      expect(object.z).toBeGreaterThanOrEqual(-32);
      expect(object.z).toBeLessThan(32);
    }
  });

  it("enforces same-type minimum spacing", () => {
    const chunk = new Chunk(0, 0, 64, 12345);
    const objects = chunk.placedObjects();

    for (let i = 0; i < objects.length; i++) {
      const a = objects[i];
      if (!a) continue;
      const rule = OBJECT_PLACEMENT_RULES[a.type];
      for (let j = i + 1; j < objects.length; j++) {
        const b = objects[j];
        if (!b) continue;
        if (a.type !== b.type) continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(rule.minSpacing * rule.minSpacing);
      }
    }
  });
});
