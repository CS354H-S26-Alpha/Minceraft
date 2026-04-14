/// <reference lib="webworker" />

import { expose, transfer } from "comlink";
import type { ChunkBatchData, ChunkWorkerApi } from "./client";
import { ChunkGenerationQueue } from "./queue";

function transferBatchData(data: ChunkBatchData): ChunkBatchData {
  const transferables: ArrayBuffer[] = [];
  const chunks = data.chunks.map(chunk => {
    // Copy before transferring — zero-copy transfer detaches the buffer on the worker
    // side, which would corrupt cached chunk data read by assembleRenderData later.
    const cubePositions = chunk.cubePositions.slice();
    const cubeColors = chunk.cubeColors.slice();
    transferables.push(cubePositions.buffer as ArrayBuffer, cubeColors.buffer as ArrayBuffer);
    return { ...chunk, cubePositions, cubeColors };
  });
  return transfer({ chunks }, transferables);
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
