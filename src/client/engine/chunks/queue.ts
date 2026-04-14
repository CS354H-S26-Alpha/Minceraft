import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "@/game/chunk";
import type { ChunkBatchData, ChunkOrigin, ChunkQueueArgs, SingleChunkData } from "./client";

interface ChunkLike {
  renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void;
  getBlockWorld(wx: number, wy: number, wz: number): CubeType;
  cubePositions(): Float32Array;
  cubeColors(): Float32Array;
  numCubes(): number;
}

type ChunkFactory = (centerX: number, centerZ: number, size: number, seed: number) => ChunkLike;

interface QueuedChunk extends ChunkOrigin {
  key: string;
}

/** Manages chunk caching and incremental terrain generation. */
export class ChunkGenerationQueue {
  private readonly chunkMap = new Map<string, ChunkLike>();
  private activeSeed: number | undefined;
  private activeGenerationId = -1;
  private queuedChunks: QueuedChunk[] = [];

  constructor(
    private readonly chunkFactory: ChunkFactory = (centerX, centerZ, size, seed) =>
      new Chunk(centerX, centerZ, size, seed),
  ) {}

  /** Replaces the desired visible set and returns a render from already-cached chunks. */
  setVisibleChunks(args: ChunkQueueArgs): ChunkBatchData {
    this.ensureSeed(args.seed);
    this.activeGenerationId = args.generationId;
    this.queuedChunks = this.buildQueue(args.chunkOrigins);
    return this.renderVisible(args);
  }

  /** Generates one queued chunk and returns an updated render, or `null` if done or stale. */
  generateNext(args: ChunkQueueArgs): ChunkBatchData | null {
    this.ensureSeed(args.seed);
    if (args.generationId !== this.activeGenerationId) return null;

    while (this.queuedChunks.length > 0) {
      const next = this.queuedChunks.shift();
      if (!next) return null;
      if (this.chunkMap.has(next.key)) continue;
      this.chunkMap.set(next.key, this.chunkFactory(next.originX, next.originZ, CHUNK_SIZE, args.seed));
      return this.renderVisible(args);
    }

    return null;
  }

  private ensureSeed(seed: number): void {
    if (this.activeSeed === seed) return;
    this.chunkMap.clear();
    this.queuedChunks = [];
    this.activeSeed = seed;
    this.activeGenerationId = -1;
  }

  private buildQueue(chunkOrigins: ChunkOrigin[]) {
    const queue = [];
    const seenKeys = new Set<string>();

    for (const chunkOrigin of chunkOrigins) {
      const key = chunkKey(chunkOrigin.originX, chunkOrigin.originZ);
      if (seenKeys.has(key) || this.chunkMap.has(key)) continue;
      seenKeys.add(key);
      queue.push({ ...chunkOrigin, key });
    }

    return queue;
  }

  private renderVisible({ originX, originZ, renderDistance }: ChunkQueueArgs): ChunkBatchData {
    const entries: { chunkX: number; chunkZ: number; chunk: ChunkLike }[] = [];

    for (let cx = -renderDistance; cx <= renderDistance; cx++) {
      for (let cz = -renderDistance; cz <= renderDistance; cz++) {
        const chunkX = originX + cx * CHUNK_SIZE;
        const chunkZ = originZ + cz * CHUNK_SIZE;
        const chunk = this.chunkMap.get(chunkKey(chunkX, chunkZ));
        if (!chunk) continue;
        entries.push({ chunkX, chunkZ, chunk });
      }
    }

    const worldGetBlock = (wx: number, wy: number, wz: number): CubeType => {
      const [ox, oz] = chunkOrigin(wx, wz);
      const chunk = this.chunkMap.get(chunkKey(ox, oz));
      if (!chunk) return CubeType.Stone;
      return chunk.getBlockWorld(wx, wy, wz);
    };

    for (const { chunk } of entries) chunk.renderChunk(worldGetBlock);

    const chunks: SingleChunkData[] = [];
    for (const { chunkX, chunkZ, chunk } of entries) {
      const numCubes = chunk.numCubes();
      if (numCubes === 0) continue;
      chunks.push({
        originX: chunkX,
        originZ: chunkZ,
        cubePositions: chunk.cubePositions(),
        cubeColors: chunk.cubeColors(),
        numCubes,
      });
    }

    return { chunks };
  }
}
