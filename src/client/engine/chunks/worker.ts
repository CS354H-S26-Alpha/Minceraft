/// <reference lib="webworker" />

import { expose, transfer } from "comlink";
import type { ChunkBatchData, ChunkWorkerApi } from "./client";
import { ChunkGenerationQueue } from "./queue";

function transferBatchData(data: ChunkBatchData): ChunkBatchData {
  const transferables: ArrayBuffer[] = [];
  for (const chunk of data.chunks) {
    transferables.push(
      chunk.cubePositions.buffer as ArrayBuffer,
      chunk.cubeColors.buffer as ArrayBuffer,
      chunk.cubeFaceTiles0.buffer as ArrayBuffer,
      chunk.cubeFaceTiles1.buffer as ArrayBuffer,
    );
  }
  return transfer(data, transferables);
}

const queue = new ChunkGenerationQueue();

const api: ChunkWorkerApi = {
  async setVisibleChunks(args) {
    return transferBatchData(queue.setVisibleChunks(args));
  },

  async generateNext(args) {
    const data = queue.generateNext(args);
    if (!data) return null;
    return transferBatchData(data);
  },
};

expose(api);
