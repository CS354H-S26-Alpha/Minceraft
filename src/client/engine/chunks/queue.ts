import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "@/game/chunk";
import type { ChunkBatchData, ChunkOrigin, ChunkQueueArgs, SingleChunkData } from "./client";

interface ChunkLike {
  renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void;
  getBlockWorld(wx: number, wy: number, wz: number): CubeType;
  cubePositions(): Float32Array;
  cubeColors(): Float32Array;
  cubeAmbientOcclusion(): Uint8Array;
  surfaceHeights(): Uint8Array;
  surfaceTypes(): Uint8Array;
  numCubes(): number;
}

type ChunkFactory = (centerX: number, centerZ: number, size: number, seed: number) => ChunkLike;

interface QueuedChunk extends ChunkOrigin {
  key: string;
}

interface ChunkEntry {
  chunkX: number;
  chunkZ: number;
  chunk: ChunkLike;
}

const CARDINAL_OFFSETS: [number, number][] = [
  [CHUNK_SIZE, 0],
  [-CHUNK_SIZE, 0],
  [0, CHUNK_SIZE],
  [0, -CHUNK_SIZE],
];

/** Manages chunk caching and incremental terrain generation. */
export class ChunkGenerationQueue {
  private readonly chunkMap = new Map<string, ChunkLike>();
  private visibleKeys = new Set<string>();
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
    this.visibleKeys = new Set(args.chunkOrigins.map((o) => chunkKey(o.originX, o.originZ)));
    this.queuedChunks = this.buildQueue(args.chunkOrigins);
    return this.renderAllVisible(args);
  }

  /** Generates one queued chunk and returns only the changed chunks, or `null` if done or stale. */
  generateNext(args: ChunkQueueArgs): ChunkBatchData | null {
    this.ensureSeed(args.seed);
    if (args.generationId !== this.activeGenerationId) return null;

    while (this.queuedChunks.length > 0) {
      const next = this.queuedChunks.shift();
      if (!next) return null;
      if (this.chunkMap.has(next.key)) continue;
      this.chunkMap.set(next.key, this.chunkFactory(next.originX, next.originZ, CHUNK_SIZE, args.seed));
      return this.renderIncremental(next.originX, next.originZ);
    }

    return null;
  }

  private ensureSeed(seed: number): void {
    if (this.activeSeed === seed) return;
    this.chunkMap.clear();
    this.queuedChunks = [];
    this.visibleKeys = new Set();
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

  private buildWorldGetBlock(): (wx: number, wy: number, wz: number) => CubeType {
    return (wx, wy, wz) => {
      const [ox, oz] = chunkOrigin(wx, wz);
      const chunk = this.chunkMap.get(chunkKey(ox, oz));
      if (!chunk) return CubeType.Air;
      return chunk.getBlockWorld(wx, wy, wz);
    };
  }

  /** Render all visible cached chunks — used on initial setVisibleChunks. */
  private renderAllVisible({ originX, originZ, renderDistance }: ChunkQueueArgs): ChunkBatchData {
    const entries: ChunkEntry[] = [];

    for (let cx = -renderDistance; cx <= renderDistance; cx++) {
      for (let cz = -renderDistance; cz <= renderDistance; cz++) {
        const chunkX = originX + cx * CHUNK_SIZE;
        const chunkZ = originZ + cz * CHUNK_SIZE;
        const chunk = this.chunkMap.get(chunkKey(chunkX, chunkZ));
        if (!chunk) continue;
        entries.push({ chunkX, chunkZ, chunk });
      }
    }

    const worldGetBlock = this.buildWorldGetBlock();
    for (const { chunk } of entries) chunk.renderChunk(worldGetBlock);

    return this.collectBatch(entries);
  }

  /**
   * Render the new chunk + its cardinal neighbors (neighbors re-rendered for
   * edge culling correctness), but only return chunks in the current visible
   * set so stale cached chunks outside renderDistance can't leak back into the
   * main thread's chunk map.
   */
  private renderIncremental(newOriginX: number, newOriginZ: number): ChunkBatchData {
    const worldGetBlock = this.buildWorldGetBlock();
    const rendered: ChunkEntry[] = [];

    const newKey = chunkKey(newOriginX, newOriginZ);
    const newChunk = this.chunkMap.get(newKey);
    if (newChunk) {
      newChunk.renderChunk(worldGetBlock);
      if (this.visibleKeys.has(newKey)) {
        rendered.push({ chunkX: newOriginX, chunkZ: newOriginZ, chunk: newChunk });
      }
    }

    for (const [dx, dz] of CARDINAL_OFFSETS) {
      const nx = newOriginX + dx;
      const nz = newOriginZ + dz;
      const nkey = chunkKey(nx, nz);
      const neighbor = this.chunkMap.get(nkey);
      if (neighbor) {
        neighbor.renderChunk(worldGetBlock);
        if (this.visibleKeys.has(nkey)) {
          rendered.push({ chunkX: nx, chunkZ: nz, chunk: neighbor });
        }
      }
    }

    return this.collectBatch(rendered);
  }

  private collectBatch(entries: ChunkEntry[]): ChunkBatchData {
    const chunks: SingleChunkData[] = [];
    for (const { chunkX, chunkZ, chunk } of entries) {
      const numCubes = chunk.numCubes();
      if (numCubes === 0) continue;
      chunks.push({
        originX: chunkX,
        originZ: chunkZ,
        cubePositions: chunk.cubePositions(),
        cubeColors: chunk.cubeColors(),
        cubeAmbientOcclusion: chunk.cubeAmbientOcclusion(),
        surfaceHeights: chunk.surfaceHeights(),
        surfaceTypes: chunk.surfaceTypes(),
        numCubes,
      });
    }
    return { chunks };
  }
}
