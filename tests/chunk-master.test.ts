import { Mat4 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import type { ChunkBatchData, ChunkQueueArgs } from "../src/client/engine/chunks/client";
import type { ChunkClient } from "../src/client/engine/chunks/manager";
import { ChunkManager } from "../src/client/engine/chunks/manager";
import { Biome } from "../src/game/biome";
import {
  emptyPlacedObjectCounts,
  type PlacedObject,
  PlacedObjectCategory,
  PlacedObjectType,
} from "../src/game/object-placement";

function flushPromises(): Promise<void> {
  return Promise.resolve();
}

function placedObject(type: PlacedObjectType): PlacedObject {
  return {
    type,
    category: PlacedObjectCategory.Decorative,
    x: 1,
    y: 64.5,
    z: 2,
    rotationY: 0,
    scale: 1,
    biome: Biome.Forest,
    chunkOriginX: 0,
    chunkOriginZ: 0,
    renderTypeIndex: 0,
    tags: [],
  };
}

function renderData(value: number, objects: readonly PlacedObject[] = []): ChunkBatchData {
  return {
    chunks: [
      {
        originX: 0,
        originZ: 0,
        cubePositions: new Float32Array([value, 0, 0, 0]),
        cubeColors: new Float32Array([value, 0, 0]),
        numCubes: 1,
        placedObjects: objects,
        placedObjectCounts: emptyPlacedObjectCounts(),
      },
    ],
  };
}

const identity = Mat4.create();

describe("ChunkManager", () => {
  it("submits the visible chunk queue in center-first order and pumps incremental updates", async () => {
    const setCalls: ChunkQueueArgs[] = [];
    let nextCalls = 0;
    const client: ChunkClient = {
      async setVisibleChunks(args) {
        setCalls.push(args);
        return renderData(0);
      },
      async generateNext(args) {
        nextCalls++;
        if (args.generationId !== 1 || nextCalls > 3) return null;
        return renderData(nextCalls);
      },
      dispose() {},
    };

    const chunkManager = new ChunkManager(0, 0, 123, client);

    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.chunkOrigins.slice(0, 5)).toEqual([
      { originX: 0, originZ: 0 },
      { originX: -64, originZ: -64 },
      { originX: -64, originZ: 0 },
      { originX: -64, originZ: 64 },
      { originX: 0, originZ: -64 },
    ]);
    chunkManager.cull(identity, identity);
    expect(Array.from(chunkManager.positions)).toEqual([3, 0, 0, 0]);
    expect(Array.from(chunkManager.colors)).toEqual([3, 0, 0]);
    expect(chunkManager.count).toBe(1);
  });

  it("ignores stale queued results after moving to a new chunk", async () => {
    let resolveFirst: ((value: ChunkBatchData | null) => void) | undefined;
    let generationSeenBySet = -1;
    const client: ChunkClient = {
      async setVisibleChunks(args) {
        generationSeenBySet = args.generationId;
        return renderData(args.generationId);
      },
      generateNext(args) {
        if (args.generationId === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(null);
      },
      dispose() {},
    };

    const chunkManager = new ChunkManager(0, 0, 123, client);
    await flushPromises();

    chunkManager.update(64, 0);
    await flushPromises();

    resolveFirst?.(renderData(999));
    await flushPromises();

    expect(generationSeenBySet).toBe(2);
    chunkManager.cull(identity, identity);
    expect(Array.from(chunkManager.positions)).toEqual([2, 0, 0, 0]);
    expect(Array.from(chunkManager.colors)).toEqual([2, 0, 0]);
    expect(chunkManager.count).toBe(1);
  });

  it("stores placed object data from the worker batch payload", async () => {
    const rock = placedObject(PlacedObjectType.Rock);
    const tree = placedObject(PlacedObjectType.Tree);
    const client: ChunkClient = {
      async setVisibleChunks() {
        return renderData(1, [rock, tree]);
      },
      async generateNext() {
        return null;
      },
      dispose() {},
    };

    const chunkManager = new ChunkManager(0, 0, 123, client);
    await flushPromises();

    expect(chunkManager.getVisiblePlacedObjects()).toEqual([rock, tree]);
  });
});
