import { releaseProxy, wrap } from "comlink";
import ChunkWorkerConstructor from "./worker?worker";

/** Render data for a single chunk, tagged with its world-space origin. */
export interface SingleChunkData {
  originX: number;
  originZ: number;
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  surfaceHeights: Uint8Array;
  surfaceTypes: Uint8Array;
  numCubes: number;
}

/** Per-chunk render data for all loaded chunks in a generation. */
export interface ChunkBatchData {
  chunks: SingleChunkData[];
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
  seed: number;
  chunkOrigins: ChunkOrigin[];
}

export interface ChunkWorkerApi {
  setVisibleChunks(args: ChunkQueueArgs): Promise<ChunkBatchData>;
  generateNext(args: ChunkQueueArgs): Promise<ChunkBatchData | null>;
}

/** Comlink wrapper for the chunk generation web worker. */
export class ChunkWorkerClient {
  private readonly worker = new ChunkWorkerConstructor();
  private readonly remote = wrap<ChunkWorkerApi>(this.worker);

  setVisibleChunks(args: ChunkQueueArgs) {
    return this.remote.setVisibleChunks(args);
  }

  generateNext(args: ChunkQueueArgs) {
    return this.remote.generateNext(args);
  }

  dispose(): void {
    this.remote[releaseProxy]();
    this.worker.terminate();
  }
}
