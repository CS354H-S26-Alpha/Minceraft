/// <reference lib="webworker" />

import { expose, transfer } from "comlink";
import type { ChunkBatchData, ChunkWorkerApi } from "./client";
import { ChunkMeshBuilder } from "./queue";

function transferBatchData(data: ChunkBatchData): ChunkBatchData {
  const transferables: ArrayBuffer[] = [];
  for (const chunk of data.chunks) {
    transferables.push(
      chunk.cubePositions.buffer as ArrayBuffer,
      chunk.cubeColors.buffer as ArrayBuffer,
      chunk.cubeAmbientOcclusion.buffer as ArrayBuffer,
      chunk.surfaceHeights.buffer as ArrayBuffer,
      chunk.surfaceTypes.buffer as ArrayBuffer,
    );
  }
  return transfer(data, transferables);
}

const builder = new ChunkMeshBuilder();

const api: ChunkWorkerApi = {
  async loadChunks(chunks) {
    return transferBatchData(builder.loadChunks(chunks));
  },

  syncBlock(wx, wy, wz, blockType) {
    builder.syncBlock(wx, wy, wz, blockType);
  },

  async clearCache() {
    builder.clearCache();
  },
};

expose(api);
