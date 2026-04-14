import { releaseProxy, wrap } from "comlink";
import ChunkWorkerConstructor from "./worker?worker";

/** Flat render buffers for the chunks currently visible to the player. */
export interface ChunkRenderData {
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  numCubes: number;
}

export interface ChunkOrigin {
  originX: number;
  originZ: number;
}

/**
 * Parameters for a chunk generation pass. `generationId` increases
 * monotonically so both sides can discard stale work after the player
 * crosses into a new chunk.
 */
export interface ChunkQueueArgs {
  generationId: number;
  originX: number;
  originZ: number;
  renderDistance: number;
  loadDistance?: number;
  evictDistance?: number;
  seed: number;
  chunkOrigins: ChunkOrigin[];
}

export interface ChunkWorkerApi {
  setVisibleChunks(args: ChunkQueueArgs): Promise<ChunkRenderData>;
  generateNext(args: ChunkQueueArgs): Promise<ChunkRenderData | null>;
}

/** Comlink wrapper for the chunk generation web worker. */
export class ChunkWorkerClient {
  private readonly worker = new ChunkWorkerConstructor();
  private readonly remote = wrap<ChunkWorkerApi>(this.worker);

  private nextId = 0;
  private pending = new Map<number, (value: void | PromiseLike<void>) => void>();

  setVisibleChunks(args: ChunkQueueArgs) {
    return this.remote.setVisibleChunks(args);
  }

  generateNext(args: ChunkQueueArgs) {
    return this.remote.generateNext(args);
  }

  async clearCache(): Promise<void> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: "clearCache", id });
    });
  }

  dispose(): void {
    this.remote[releaseProxy]();
    this.worker.terminate();
  }
}
