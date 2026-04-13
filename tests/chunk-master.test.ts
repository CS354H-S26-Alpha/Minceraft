import { describe, expect, it } from "vitest";
import { ChunkMaster } from "../src/game/chunk-master";
import { PlacedObjectType } from "../src/game/object-placement";

describe("ChunkMaster object placement cache", () => {
  it("aggregates placed objects from loaded chunks", () => {
    const chunkMaster = new ChunkMaster(0, 0, 123);

    expect(chunkMaster.getNearPlacedObjectCount()).toBeGreaterThan(0);
    expect(chunkMaster.getNearPlacedObjects().length).toBe(chunkMaster.getNearPlacedObjectCount());
  });

  it("tracks placed object counts by type", () => {
    const chunkMaster = new ChunkMaster(0, 0, 123);
    const counts = chunkMaster.getNearPlacedObjectCounts();
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

    expect(total).toBe(chunkMaster.getNearPlacedObjectCount());
    expect(counts[PlacedObjectType.Tree]).toBeGreaterThanOrEqual(0);
    expect(counts[PlacedObjectType.Grass]).toBeGreaterThanOrEqual(0);
  });

  it("updates cached placed objects when the loaded chunk window changes", () => {
    const chunkMaster = new ChunkMaster(0, 0, 123);
    const before = chunkMaster.getNearPlacedObjects();

    chunkMaster.updateChunksAroundPos(64, 0);
    const after = chunkMaster.getNearPlacedObjects();

    expect(after).not.toBe(before);
    expect(after.length).toBeGreaterThan(0);
  });

  it("returns stable cached objects when the origin does not change", () => {
    const chunkMaster = new ChunkMaster(0, 0, 123);
    const before = chunkMaster.getNearPlacedObjects();

    chunkMaster.updateChunksAroundPos(0, 0);

    expect(chunkMaster.getNearPlacedObjects()).toBe(before);
  });
});
