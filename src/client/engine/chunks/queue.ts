import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "@/game/chunk";
import type { ChunkBatchData, ChunkOrigin, ChunkQueueArgs, SingleChunkData } from "./client";

interface ChunkLike {
  renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void;
  getBlockWorld(wx: number, wy: number, wz: number): CubeType;
  cubePositions(): Float32Array;
  cubeColors(): Float32Array;
  blocks: Uint8Array;
  cubeAmbientOcclusion(): Uint8Array;
  surfaceHeights(): Uint8Array;
  surfaceTypes(): Uint8Array;
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
  private readonly cache: LRUCache;
  private visibleKeys = new Set<string>();
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
    this.visibleKeys = new Set(args.chunkOrigins.map((o) => chunkKey(o.originX, o.originZ)));
    this.queuedChunks = this.buildQueue(args.chunkOrigins);
    this.evictDistantChunks(args);
    return this.renderAllVisible(args);
  }

  /** Generates one queued chunk and returns only the changed chunks, or `null` if done or stale. */
  generateNext(args: ChunkQueueArgs): ChunkBatchData | null {
    this.ensureSeed(args.seed);
    if (args.generationId !== this.activeGenerationId) return null;

    while (this.queuedChunks.length > 0) {
      const next = this.queuedChunks.shift();
      if (!next) return null;
      if (this.cache.has(next.key)) continue;
      this.cache.set(next.key, this.chunkFactory(next.originX, next.originZ, CHUNK_SIZE, args.seed));
      return this.renderIncremental(next.originX, next.originZ);
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
    this.visibleKeys = new Set();
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

  private buildWorldGetBlock(): (wx: number, wy: number, wz: number) => CubeType {
    return (wx, wy, wz) => {
      const [ox, oz] = chunkOrigin(wx, wz);
      const chunk = this.cache.get(chunkKey(ox, oz));
      return chunk ? chunk.getBlockWorld(wx, wy, wz) : CubeType.Stone;
    };
  }

  /** Render all visible cached chunks — used on initial setVisibleChunks. */
  private renderAllVisible({ originX, originZ, renderDistance }: ChunkQueueArgs): ChunkBatchData {
    const entries: ChunkEntry[] = [];

    for (let cx = -renderDistance; cx <= renderDistance; cx++) {
      for (let cz = -renderDistance; cz <= renderDistance; cz++) {
        const chunkX = originX + cx * CHUNK_SIZE;
        const chunkZ = originZ + cz * CHUNK_SIZE;
        const chunk = this.cache.get(chunkKey(chunkX, chunkZ));
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
    const newChunk = this.cache.get(newKey);
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
      const neighbor = this.cache.get(nkey);
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
        blocks: chunk.blocks,
        cubeAmbientOcclusion: chunk.cubeAmbientOcclusion(),
        surfaceHeights: chunk.surfaceHeights(),
        surfaceTypes: chunk.surfaceTypes(),
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
