import { describe, expect, it } from "vitest";
import type { ChunkBatchData, ChunkQueueArgs } from "../src/client/engine/chunks/client";
import type { ChunkClient } from "../src/client/engine/chunks/manager";
import { ChunkManager } from "../src/client/engine/chunks/manager";

function flushPromises(): Promise<void> {
  return Promise.resolve();
}

function renderData(value: number): ChunkBatchData {
  return {
    chunks: [
      {
        originX: 0,
        originZ: 0,
        cubePositions: new Float32Array([value, 0, 0, 0]),
        cubeColors: new Float32Array([value, 0, 0]),
        blocks: new Uint8Array(0),
        cubeAmbientOcclusion: new Uint8Array(24).fill(3),
        surfaceHeights: new Uint8Array([1]),
        surfaceTypes: new Uint8Array([1]),
        numCubes: 1,
      },
    ],
  };
}

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe("ChunkManager", () => {
  it("submits the visible chunk queue in center-first order and pumps incremental updates", async () => {
    const setCalls: ChunkQueueArgs[] = [];
    let nextCalls = 0;
    const client: ChunkClient = {
      async setVisibleChunks(args) {
        setCalls.push(args);
        return renderData(0);
      },
      async generateNext() {
        nextCalls++;
        if (nextCalls > 3) return null;
        return renderData(nextCalls);
      },
      async tickFluids() {
        return null;
      },
      dispose: () => {},
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
    expect(chunkManager.ambientOcclusion.length).toBe(24);
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
      async tickFluids() {
        return null;
      },
      dispose: () => {},
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
    expect(chunkManager.ambientOcclusion.length).toBe(24);
    expect(chunkManager.count).toBe(1);
  });
});
