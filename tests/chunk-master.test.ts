import { describe, expect, it } from "vitest";
import type { ChunkGenerationService } from "../src/client/engine/chunks/chunk-generation-client";
import type {
  VisibleChunkQueueArgs,
  VisibleChunkRenderData,
} from "../src/client/engine/chunks/chunk-generation-protocol";
import { ChunkMaster } from "../src/client/engine/chunks/chunk-master";

function flushPromises(): Promise<void> {
  return Promise.resolve();
}

function renderData(value: number): VisibleChunkRenderData {
  return {
    cubePositions: new Float32Array([value, 0, 0, 0]),
    cubeColors: new Float32Array([value, 0, 0]),
    numCubes: value,
  };
}

describe("ChunkMaster", () => {
  it("submits the visible chunk queue in center-first order and pumps incremental updates", async () => {
    const setCalls: VisibleChunkQueueArgs[] = [];
    let nextCalls = 0;
    const client: ChunkGenerationService = {
      async setVisibleChunks(args) {
        setCalls.push(args);
        return renderData(0);
      },
      async generateNextVisibleChunk() {
        nextCalls++;
        if (nextCalls > 3) return null;
        return renderData(nextCalls);
      },
      dispose: () => {},
    };

    const chunkMaster = new ChunkMaster(0, 0, 123, client);

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
    expect(Array.from(chunkMaster.getNearCubePositionsFlattened())).toEqual([3, 0, 0, 0]);
    expect(Array.from(chunkMaster.getNearCubeColorsFlattened())).toEqual([3, 0, 0]);
    expect(chunkMaster.getNearCubeSize()).toBe(3);
  });

  it("ignores stale queued results after moving to a new chunk", async () => {
    let resolveFirst: ((value: VisibleChunkRenderData | null) => void) | undefined;
    let generationSeenBySet = -1;
    const client: ChunkGenerationService = {
      async setVisibleChunks(args) {
        generationSeenBySet = args.generationId;
        return renderData(args.generationId);
      },
      generateNextVisibleChunk(args) {
        if (args.generationId === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(null);
      },
      dispose: () => {},
    };

    const chunkMaster = new ChunkMaster(0, 0, 123, client);
    await flushPromises();

    chunkMaster.updateChunksAroundPos(64, 0);
    await flushPromises();

    resolveFirst?.(renderData(999));
    await flushPromises();

    expect(generationSeenBySet).toBe(2);
    expect(Array.from(chunkMaster.getNearCubePositionsFlattened())).toEqual([2, 0, 0, 0]);
    expect(Array.from(chunkMaster.getNearCubeColorsFlattened())).toEqual([2, 0, 0]);
    expect(chunkMaster.getNearCubeSize()).toBe(2);
  });
});
