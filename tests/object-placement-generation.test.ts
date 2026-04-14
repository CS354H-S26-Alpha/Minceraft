import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { Biome } from "../src/game/biome";
import { Chunk } from "../src/game/chunk";
import {
  generatePlacedObjectsForChunk,
  OBJECT_PLACEMENT_RULES,
  type ObjectPlacementSample,
  placedObjectTypeIndex,
  supportsObjectPlacement,
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

    expect(chunk.placedObjects().length).toBeGreaterThan(0);
    for (const object of chunk.placedObjects()) {
      const localX = Math.floor(object.x - (0 - 64 / 2));
      const localZ = Math.floor(object.z - (0 - 64 / 2));
      const idx = localZ * 64 + localX;
      const surfaceY = chunk.heightMap[idx] as number;
      const center = surfaceY;

      const sample: ObjectPlacementSample = {
        biome: chunk.biomeMap[idx] as Biome,
        surfaceY,
        surfaceBlock: chunk.getBlock(localX, surfaceY, localZ),
        northY: localZ > 0 ? (chunk.heightMap[(localZ - 1) * 64 + localX] as number) : center,
        southY: localZ + 1 < 64 ? (chunk.heightMap[(localZ + 1) * 64 + localX] as number) : center,
        eastY: localX + 1 < 64 ? (chunk.heightMap[localZ * 64 + localX + 1] as number) : center,
        westY: localX > 0 ? (chunk.heightMap[localZ * 64 + localX - 1] as number) : center,
        isSubmerged: false,
        distanceToChunkEdge: Math.min(localX, localZ, 63 - localX, 63 - localZ),
      };

      expect(supportsObjectPlacement(OBJECT_PLACEMENT_RULES[object.type], sample)).toBe(true);
      expect(object.y).toBeGreaterThanOrEqual(surfaceY + 0.4);
      expect(object.y).toBeLessThanOrEqual(surfaceY + 0.5);
      expect(object.chunkOriginX).toBe(-32);
      expect(object.chunkOriginZ).toBe(-32);
      expect(object.renderTypeIndex).toBe(placedObjectTypeIndex(object.type));
    }
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
