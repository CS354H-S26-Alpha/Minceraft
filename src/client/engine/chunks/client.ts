import { releaseProxy, wrap } from "comlink";
import type { PlacedObject, PlacedObjectType } from "@/game/object-placement";
import ChunkWorkerConstructor from "./worker?worker";

/** Render data for a single chunk, tagged with its world-space origin. */
export interface SingleChunkData {
  originX: number;
  originZ: number;
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  /** Packed block grid (CubeType per voxel), indexed `y*S*S + z*S + x`. */
  blocks: Uint8Array;
  cubeAmbientOcclusion: Uint8Array;
  /** Detached copy of surface Y per column, indexed `z*S + x`. */
  surfaceHeights: Uint8Array;
  /** Detached copy of surface block type per column, indexed `z*S + x`. */
  surfaceTypes: Uint8Array;
  numCubes: number;
  placedObjects: readonly PlacedObject[];
  placedObjectCounts: Readonly<Record<PlacedObjectType, number>>;
  /** Per-section cube offset into the render arrays (128 entries). */
  sectionOffsets: Uint32Array;
  /** Per-section cube count (128 entries). */
  sectionCounts: Uint16Array;
}

/** Mesh-only chunk data returned by the worker (no placed objects). */
export type WorkerChunkData = Omit<SingleChunkData, "placedObjects" | "placedObjectCounts">;

/** Per-chunk mesh batch returned by the worker. */
export interface ChunkBatchData {
  chunks: WorkerChunkData[];
}

export interface ChunkWorkerApi {
  /** Receive server block data (RLE-encoded), build meshes, return render batch. */
  loadChunks(chunks: Array<{ originX: number; originZ: number; blocks: Uint8Array }>): Promise<ChunkBatchData>;
  /** Update a single block in the cache without re-rendering (fire-and-forget sync). */
  syncBlock(wx: number, wy: number, wz: number, blockType: number): void;
  /** Clear all cached block data. */
  clearCache(): Promise<void>;
}

/** Comlink wrapper for the chunk mesh-building web worker. */
export class ChunkWorkerClient {
  private readonly worker = new ChunkWorkerConstructor();
  private readonly remote = wrap<ChunkWorkerApi>(this.worker);

  loadChunks(chunks: Array<{ originX: number; originZ: number; blocks: Uint8Array }>) {
    return this.remote.loadChunks(chunks);
  }

  syncBlock(wx: number, wy: number, wz: number, blockType: number) {
    void this.remote.syncBlock(wx, wy, wz, blockType);
  }

  clearCache() {
    return this.remote.clearCache();
  }

  dispose(): void {
    this.remote[releaseProxy]();
    this.worker.terminate();
  }
}
