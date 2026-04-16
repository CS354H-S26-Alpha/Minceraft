import { describe, expect, it } from "vitest";
import type { ChunkClient } from "../src/client/engine/chunks/manager";
import { ChunkManager } from "../src/client/engine/chunks/manager";
import { CubeType } from "../src/client/engine/render/cube-types";
import { CHUNK_SIZE, SECTIONS_PER_CHUNK } from "../src/game/chunk";

function createMockClient(): ChunkClient {
  return {
    async loadChunks(chunks) {
      return {
        chunks: chunks.map((c) => ({
          ...c,
          cubePositions: new Float32Array(4),
          cubeColors: new Float32Array(3),
          blocks: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 128),
          cubeAmbientOcclusion: new Uint8Array(24),
          surfaceHeights: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
          surfaceTypes: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
          numCubes: 1,
          sectionOffsets: new Uint32Array(SECTIONS_PER_CHUNK),
          sectionCounts: new Uint16Array(SECTIONS_PER_CHUNK),
        })),
      };
    },
    syncBlock() {},
    async clearCache() {},
    dispose() {},
  };
}

async function ingestAndFlush(
  manager: ChunkManager,
  chunks: Array<{ originX: number; originZ: number; blocks: Uint8Array }>,
): Promise<void> {
  manager.receiveChunks(chunks);
  manager.processIncoming();
  // Wait for the worker promise to resolve
  await Promise.resolve();
  await Promise.resolve();
}

describe("ChunkManager", () => {
  it("receives chunks and makes them available via getBlock", async () => {
    const manager = new ChunkManager(createMockClient());
    await ingestAndFlush(manager, [{ originX: 0, originZ: 0, blocks: new Uint8Array(0) }]);

    expect(manager.getBlock(0, 0, 0)).toBe(CubeType.Air);
  });

  it("modifyBlock updates local state", async () => {
    const manager = new ChunkManager(createMockClient());
    await ingestAndFlush(manager, [{ originX: 0, originZ: 0, blocks: new Uint8Array(0) }]);

    const prev = manager.modifyBlock(0, 10, 0, CubeType.Stone);
    expect(prev).toBe(CubeType.Air);
    expect(manager.getBlock(0, 10, 0)).toBe(CubeType.Stone);
  });

  it("returns null for unloaded chunks", () => {
    const manager = new ChunkManager(createMockClient());
    expect(manager.getBlock(0, 0, 0)).toBe(CubeType.Air);
    expect(manager.modifyBlock(0, 0, 0, CubeType.Stone)).toBeNull();
  });
});
