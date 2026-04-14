import { releaseProxy, wrap } from "comlink";
import type { PlacedObject, PlacedObjectType } from "@/game/object-placement";
import ChunkWorkerConstructor from "./worker?worker";

/** Flat render buffers for the chunks currently visible to the player. */
export interface ChunkRenderData {
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  numCubes: number;
  placedObjects: readonly PlacedObject[];
  placedObjectCounts: Readonly<Record<PlacedObjectType, number>>;
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
  setVisibleChunks(args: ChunkQueueArgs): Promise<ChunkRenderData>;
  generateNext(args: ChunkQueueArgs): Promise<ChunkRenderData | null>;
}

export interface ChunkWorkerClientApi extends ChunkWorkerApi {
  dispose(): void;
}

/** Comlink wrapper for the chunk generation web worker. */
export class ChunkWorkerClient implements ChunkWorkerClientApi {
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
