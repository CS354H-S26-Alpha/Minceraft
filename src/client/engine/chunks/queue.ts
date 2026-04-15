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
// Chunk persistence
interface LRUNode {
  key: string;
  chunk: ChunkLike;
  prev: LRUNode | null;
  next: LRUNode | null;
}

class LRUCache {
  private readonly map = new Map<string, LRUNode>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): ChunkLike | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.chunk;
  }

  set(key: string, chunk: ChunkLike): void {
    if (this.map.has(key)) {
      const node = this.map.get(key);
      if (node) {
        node.chunk = chunk;
        this.moveToHead(node);
        return;
      }
    }

    const node: LRUNode = { key, chunk, prev: null, next: this.head };
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
    this.map.set(key, node);

    if (this.map.size > this.capacity) this.evictTail();
  }

  delete(key: string): void {
    const node = this.map.get(key);
    if (!node) return;
    this.unlink(node);
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  get size(): number {
    return this.map.size;
  }

  private moveToHead(node: LRUNode): void {
    if (node === this.head) return;
    this.unlink(node);
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private evictTail(): void {
    if (!this.tail) return;
    const key = this.tail.key;
    this.unlink(this.tail);
    this.map.delete(key);
  }

  private unlink(node: LRUNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }
}

/** Manages chunk caching and incremental terrain generation. */
export class ChunkGenerationQueue {
  private readonly cache: LRUCache;
  private activeSeed: number | undefined;
  private activeGenerationId = -1;
  private queuedChunks: QueuedChunk[] = [];

  constructor(
    private readonly chunkFactory: ChunkFactory = (cx, cz, size, seed) => new Chunk(cx, cz, size, seed),
    cacheCapacity = 512,
  ) {
    this.cache = new LRUCache(cacheCapacity);
  }

  /** Replaces the desired visible set and returns a render from already-cached chunks. */
  setVisibleChunks(args: ChunkQueueArgs): ChunkBatchData {
    this.ensureSeed(args.seed);
    this.activeGenerationId = args.generationId;
    this.queuedChunks = this.buildQueue(args.chunkOrigins);
    this.evictDistantChunks(args);
    return this.renderVisible(args);
  }

  /** Generates one queued chunk and returns an updated render, or `null` if done or stale. */
  generateNext(args: ChunkQueueArgs): ChunkBatchData | null {
    this.ensureSeed(args.seed);
    if (args.generationId !== this.activeGenerationId) return null;

    while (this.queuedChunks.length > 0) {
      const next = this.queuedChunks.shift();
      if (!next) return null;
      if (this.cache.has(next.key)) continue;
      this.cache.set(next.key, this.chunkFactory(next.originX, next.originZ, CHUNK_SIZE, args.seed));
      return this.renderVisible(args);
    }

    return null;
  }

  clearCache(): void {
    this.cache.clear();
    this.queuedChunks = [];
    this.activeGenerationId = -1;
  }

  private ensureSeed(seed: number): void {
    if (this.activeSeed === seed) return;
    this.cache.clear();
    this.queuedChunks = [];
    this.activeSeed = seed;
    this.activeGenerationId = -1;
  }

  private evictDistantChunks(args: ChunkQueueArgs): void {
    const evictDist = args.evictDistance ?? args.renderDistance + 3;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      const [ox, oz] = key.split(",").map(Number) as [number, number];
      const dx = Math.abs(ox - args.originX) / CHUNK_SIZE;
      const dz = Math.abs(oz - args.originZ) / CHUNK_SIZE;
      if (Math.max(dx, dz) > evictDist) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) this.cache.delete(key);
  }

  private buildQueue(chunkOrigins: ChunkOrigin[]): QueuedChunk[] {
    const queue: QueuedChunk[] = [];
    const seenKeys = new Set<string>();

    for (const origin of chunkOrigins) {
      const key = chunkKey(origin.originX, origin.originZ);
      if (seenKeys.has(key) || this.cache.has(key)) continue;
      seenKeys.add(key);
      queue.push({ ...origin, key });
    }

    return queue;
  }

  private renderVisible({ originX, originZ, renderDistance }: ChunkQueueArgs): ChunkBatchData {
    const entries: { chunkX: number; chunkZ: number; chunk: ChunkLike }[] = [];

    for (let cx = -renderDistance; cx <= renderDistance; cx++) {
      for (let cz = -renderDistance; cz <= renderDistance; cz++) {
        const chunkX = originX + cx * CHUNK_SIZE;
        const chunkZ = originZ + cz * CHUNK_SIZE;
        const chunk = this.cache.get(chunkKey(chunkX, chunkZ));
        if (!chunk) continue;
        entries.push({ chunkX, chunkZ, chunk });
      }
    }

    const worldGetBlock = (wx: number, wy: number, wz: number): CubeType => {
      const [ox, oz] = chunkOrigin(wx, wz);
      const chunk = this.cache.get(chunkKey(ox, oz));
      return chunk ? chunk.getBlockWorld(wx, wy, wz) : CubeType.Stone;
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

  public getBlockWorld(wx: number, wy: number, wz: number): CubeType {
    const [ox, oz] = chunkOrigin(wx, wz);
    const chunk = this.cache.get(chunkKey(ox, oz));
    return chunk ? chunk.getBlockWorld(wx, wy, wz) : CubeType.Stone; // THIS LINE IS FINE
  }
}
