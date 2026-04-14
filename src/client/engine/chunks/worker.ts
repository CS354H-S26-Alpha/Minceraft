/// <reference lib="webworker" />

import { expose, transfer } from "comlink";
import type { ChunkRenderData, ChunkWorkerApi } from "./client";
import { ChunkGenerationQueue } from "./queue";

function transferRenderData(data: ChunkRenderData): ChunkRenderData {
  return transfer(data, [data.cubePositions.buffer, data.cubeColors.buffer]);
}

const queue = new ChunkGenerationQueue();

const api: ChunkWorkerApi = {
  async setVisibleChunks(args) {
    return transferRenderData(queue.setVisibleChunks(args));
  },

  async generateNext(args) {
    const data = queue.generateNext(args);
    if (!data) return null;
    return transferRenderData(data);
  },
};

expose(api);
