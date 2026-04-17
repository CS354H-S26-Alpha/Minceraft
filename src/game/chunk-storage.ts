import { eq } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { LRUCache } from "lru-cache";
import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, chunkKey, chunkOrigin, decodeBlocks, encodeBlocks } from "@/game/chunk";
import type { ChunkGen } from "@/server/chunk-gen";
import * as schema from "@/server/schema";

export interface BlockMutation {
  action: "place" | "break";
  x: number;
  y: number;
  z: number;
  blockType?: number;
}

export interface BlockMutationResult {
  accepted: boolean;
  previousType: number;
}

export interface ChunkBlob {
  originX: number;
  originZ: number;
  blocks: Uint8Array;
  placedObjects: ReturnType<Chunk["placedObjects"]>;
  placedObjectCounts: ReturnType<Chunk["placedObjectCounts"]>;
}

interface ChunkEntry {
  chunk: Chunk;
  encoded: Uint8Array | undefined;
  encodedFluidLevels: Uint8Array | undefined;
}

/** Cap on in-memory chunks. Each chunk is 512KB (Uint8Array of CHUNK_SIZE²·CHUNK_HEIGHT). */
const MAX_MEMORY_CHUNKS = 121;

/** World-space deltas to the 4 cardinal neighbour chunks. */
const CARDINAL_CHUNK_DELTAS = [
  [CHUNK_SIZE, 0],
  [-CHUNK_SIZE, 0],
  [0, CHUNK_SIZE],
  [0, -CHUNK_SIZE],
] as const;

/** Six axis-aligned neighbour offsets: ±X, ±Y, ±Z. */
const NEIGHBOR_OFFSETS_6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
] as const;

interface ResolvedChunk {
  entry: ChunkEntry;
  key: string;
  lx: number;
  lz: number;
}

/**
 * Wraps an incoming blob (SQLite BLOB or RPC typed array) as a `Uint8Array`
 * view without copying. `new Uint8Array(src)` clones when `src` is already a
 * `Uint8Array`; this guard avoids that double-allocation on the hot path.
 */
function asUint8Array(src: Uint8Array | ArrayBuffer): Uint8Array {
  return src instanceof Uint8Array ? src : new Uint8Array(src);
}

type ChunkGenService = Service<typeof ChunkGen>;
type ChunkDb = DrizzleSqliteDODatabase<typeof schema>;

/**
 * In-memory chunk cache + block mutations + SQLite persistence. Runs inside
 * GameRoom — no DO hop. Cache lookups and block mutations are synchronous;
 * cache misses dispatch to the ChunkGen service binding (separate isolate,
 * so generation runs in parallel with the tick loop).
 *
 * Each cache entry keeps both the raw `blocks` (for mutation/reads) and the
 * RLE-`encoded` broadcast form (lazily populated, cleared on writeBlock).
 * Chunks loaded from SQLite/ChunkGen arrive pre-encoded, so the first cache
 * hit reuses that blob instead of re-running `rleEncodeBlocks`.
 */
export class ChunkStorage {
  private readonly chunks: LRUCache<string, ChunkEntry>;
  // Parallel to `chunks` so `loadedChunks()` is a direct Set walk. lru-cache's
  // `values()` chains three nested generators (`values → #indexes → yield`),
  // which was dominating the fluid-tick hot path at 20 Hz × 240 entries.
  private readonly chunkSet = new Set<Chunk>();
  // Dedupes overlapping `ensureChunk` callers (e.g., preGenerateNeighbors
  // racing a real player's loadChunks), so each origin hits ChunkGen once.
  private readonly inflightEnsure = new Map<string, Promise<boolean>>();
  private dirtyChunks = new Set<string>();
  private readonly db: ChunkDb;
  private readonly chunkGen: ChunkGenService | undefined;
  private seed = 0;

  constructor(db: ChunkDb, chunkGen: ChunkGenService | undefined) {
    this.db = db;
    this.chunkGen = chunkGen;
    this.chunks = new LRUCache<string, ChunkEntry>({
      max: MAX_MEMORY_CHUNKS,
      onInsert: (entry) => {
        this.chunkSet.add(entry.chunk);
      },
      dispose: (entry, key, reason) => {
        this.chunkSet.delete(entry.chunk);
        if (reason !== "evict") return;
        if (this.dirtyChunks.has(key)) {
          this.persist(key, entry);
          this.dirtyChunks.delete(key);
        }
      },
    });
  }

  hydrate(seed: number): void {
    this.seed = seed;
  }

  /**
   * Returns the block type at the world coord. If `playerPos` is supplied and
   * the containing chunk is within 1 chunk (Chebyshev) of the player's chunk
   * but not yet resident, it is loaded (SQLite or ChunkGen) before reading.
   * Returns `undefined` only when the chunk is out of range and not loaded.
   */
  async getBlock(
    wx: number,
    wy: number,
    wz: number,
    playerPos?: { x: number; z: number },
  ): Promise<CubeType | undefined> {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return CubeType.Air;
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    if (!this.chunks.has(key) && playerPos && this.isWithinPlayerChunkRange(originX, originZ, playerPos)) {
      await this.ensureChunk(originX, originZ);
    }
    const entry = this.chunks.peek(key);
    if (!entry) return undefined;
    const lx = wx - (originX - CHUNK_SIZE / 2);
    const lz = wz - (originZ - CHUNK_SIZE / 2);
    return (entry.chunk.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] ?? CubeType.Air) as CubeType;
  }

  private isWithinPlayerChunkRange(originX: number, originZ: number, playerPos: { x: number; z: number }): boolean {
    const [playerOriginX, playerOriginZ] = chunkOrigin(playerPos.x, playerPos.z);
    return Math.abs(originX - playerOriginX) <= CHUNK_SIZE && Math.abs(originZ - playerOriginZ) <= CHUNK_SIZE;
  }

  /** Resolves the cached chunk entry (+ local coords) for a world (wx, wz). */
  private resolveChunk(wx: number, wz: number): ResolvedChunk | null {
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    const entry = this.chunks.peek(key);
    if (!entry) return null;
    return {
      entry,
      key,
      lx: wx - (originX - CHUNK_SIZE / 2),
      lz: wz - (originZ - CHUNK_SIZE / 2),
    };
  }

  /** Returns the cached `Chunk` instance, or `null` if the chunk isn't loaded. */
  getChunk(originX: number, originZ: number): Chunk | null {
    return this.chunks.peek(chunkKey(originX, originZ))?.chunk ?? null;
  }

  /** Iterates loaded `Chunk` instances. Consumers must not retain references past the next eviction. */
  loadedChunks(): ReadonlySet<Chunk> {
    return this.chunkSet;
  }

  /**
   * Applies a block mutation. If `playerPos` is supplied, the target chunk is
   * loaded on demand when within 1 chunk of the player, so a very recent
   * eviction or pre-load miss doesn't silently reject the action. Rejects if
   * the coordinate is out of range, the chunk still isn't loaded, or the
   * mutation violates type rules (can't break Air/Bedrock, can't place into
   * non-Air).
   */
  async applyMutation(action: BlockMutation, playerPos?: { x: number; z: number }): Promise<BlockMutationResult> {
    const { x, y, z } = action;
    if (y < 0 || y >= CHUNK_HEIGHT) {
      return { accepted: false, previousType: CubeType.Air };
    }
    const current = await this.getBlock(x, y, z, playerPos);
    if (current === undefined) {
      return { accepted: false, previousType: CubeType.Air };
    }
    if (action.action === "break") {
      if (current === CubeType.Air || current === CubeType.Bedrock) {
        return { accepted: false, previousType: current };
      }
      this.writeBlock(x, y, z, CubeType.Air);
      this.activateFluidNeighbours(x, y, z);
      return { accepted: true, previousType: current };
    }
    if (current !== CubeType.Air) {
      return { accepted: false, previousType: current };
    }
    const blockType = (action.blockType ?? CubeType.Dirt) as CubeType;
    this.writeBlock(x, y, z, blockType);
    return { accepted: true, previousType: CubeType.Air };
  }

  /**
   * Wakes any fluid cell adjacent to world coord (wx, wy, wz). Each of the six
   * axis-aligned neighbours may live in a different chunk (across boundaries);
   * unloaded chunks are skipped. No block state is mutated — only the owning
   * chunk's `activeFluids` queue is updated — so no cache invalidation needed.
   */
  private activateFluidNeighbours(wx: number, wy: number, wz: number): void {
    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS_6) {
      const ny = wy + dy;
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const resolved = this.resolveChunk(wx + dx, wz + dz);
      if (!resolved) continue;
      resolved.entry.chunk.activateCellIfFluid(resolved.lx, ny, resolved.lz);
    }
  }

  /**
   * Splits origins into cache hits (returned immediately as RLE-encoded blobs)
   * and misses (keys still needing load/generation).
   */
  sliceByCache(origins: Array<{ originX: number; originZ: number }>): {
    hits: ChunkBlob[];
    misses: Array<{ originX: number; originZ: number }>;
  } {
    const hits: ChunkBlob[] = [];
    const misses: Array<{ originX: number; originZ: number }> = [];
    for (const { originX, originZ } of origins) {
      const key = chunkKey(originX, originZ);
      const entry = this.chunks.get(key);
      if (entry) {
        hits.push({
          originX,
          originZ,
          blocks: this.encodedBlocks(entry),
          placedObjects: entry.chunk.placedObjects(),
          placedObjectCounts: entry.chunk.placedObjectCounts(),
        });
      } else {
        misses.push({ originX, originZ });
      }
    }
    return { hits, misses };
  }

  /**
   * Loads misses from SQLite or ChunkGen and returns RLE-encoded blobs for
   * each. Newly generated chunks are speculatively pre-populated with
   * cardinal neighbors; the extra fetches run in the background.
   */
  async loadChunks(origins: Array<{ originX: number; originZ: number }>): Promise<ChunkBlob[]> {
    if (origins.length === 0) return [];
    const generated: Array<{ originX: number; originZ: number }> = [];
    await Promise.all(
      origins.map(async ({ originX, originZ }) => {
        if (this.chunks.has(chunkKey(originX, originZ))) return;
        const loadedFromDisk = await this.ensureChunk(originX, originZ);
        if (!loadedFromDisk) generated.push({ originX, originZ });
      }),
    );
    const result: ChunkBlob[] = [];
    for (const { originX, originZ } of origins) {
      const entry = this.chunks.peek(chunkKey(originX, originZ));
      if (!entry) continue;
      result.push({
        originX,
        originZ,
        blocks: this.encodedBlocks(entry),
        placedObjects: entry.chunk.placedObjects(),
        placedObjectCounts: entry.chunk.placedObjectCounts(),
      });
    }
    this.preGenerateNeighbors(generated);
    return result;
  }

  hasDirty(): boolean {
    return this.dirtyChunks.size > 0;
  }

  /**
   * Marks the chunk containing (wx, wz) as dirty so its next flush persists the
   * current state. Used by systems (e.g., fluid sim) that mutate `chunk.blocks`
   * or `chunk.fluidLevels` directly, bypassing `writeBlock`.
   */
  markDirty(wx: number, wz: number): void {
    const resolved = this.resolveChunk(wx, wz);
    if (!resolved) return;
    resolved.entry.encoded = undefined;
    resolved.entry.encodedFluidLevels = undefined;
    this.dirtyChunks.add(resolved.key);
  }

  /** Persists every dirty chunk to SQLite and clears the dirty set. */
  flush(): void {
    for (const key of this.dirtyChunks) {
      const entry = this.chunks.peek(key);
      if (!entry) continue;
      this.persist(key, entry);
    }
    this.dirtyChunks.clear();
  }

  private persist(key: string, entry: ChunkEntry): void {
    const data = this.encodedBlocks(entry);
    const fluidLevels = this.encodedFluidLevels(entry);
    this.db
      .insert(schema.chunks)
      .values({ key, data, fluidLevels })
      .onConflictDoUpdate({ target: schema.chunks.key, set: { data, fluidLevels } })
      .run();
    console.log(`[ChunkStorage] Flushed chunk ${key} to database`);
  }

  private writeBlock(wx: number, wy: number, wz: number, blockType: CubeType): void {
    const resolved = this.resolveChunk(wx, wz);
    if (!resolved) return;
    const { entry, key, lx, lz } = resolved;
    entry.chunk.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = blockType;
    entry.encoded = undefined;
    this.dirtyChunks.add(key);
  }

  /** Returns true if the chunk came from SQLite; false if it was generated. */
  private ensureChunk(originX: number, originZ: number): Promise<boolean> {
    const key = chunkKey(originX, originZ);
    if (this.chunks.has(key)) return Promise.resolve(true);
    const pending = this.inflightEnsure.get(key);
    if (pending) return pending;
    const promise = this.loadOrGenerate(originX, originZ, key).finally(() => {
      this.inflightEnsure.delete(key);
    });
    this.inflightEnsure.set(key, promise);
    return promise;
  }

  private async loadOrGenerate(originX: number, originZ: number, key: string): Promise<boolean> {
    const row = this.db.select().from(schema.chunks).where(eq(schema.chunks.key, key)).get();
    if (row) {
      try {
        const encoded = asUint8Array(row.data);
        const encodedFluidLevels = row.fluidLevels ? asUint8Array(row.fluidLevels) : undefined;
        const blocks = decodeBlocks(encoded);
        const fluidLevels = encodedFluidLevels ? decodeBlocks(encodedFluidLevels) : undefined;
        const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true, { blocks, fluidLevels });
        this.chunks.set(key, { chunk, encoded, encodedFluidLevels });
        this.primeFluidBoundaries(originX, originZ);
        return true;
      } catch (err) {
        console.error(`Failed to decode chunk (${originX}, ${originZ}) from SQLite, will regenerate:`, err);
        this.db.delete(schema.chunks).where(eq(schema.chunks.key, key)).run();
      }
    }

    if (this.chunkGen) {
      console.log(`[ChunkStorage] Generating chunk at (${originX}, ${originZ}) via ChunkGen`);
      const encoded = await this.chunkGen.generateChunk(originX, originZ, this.seed);
      const blocks = decodeBlocks(encoded);
      const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true, { blocks });
      this.chunks.set(key, { chunk, encoded, encodedFluidLevels: undefined });
    } else {
      // Tests and local fallback: generate inline.
      const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true);
      this.chunks.set(key, { chunk, encoded: undefined, encodedFluidLevels: undefined });
    }
    this.primeFluidBoundaries(originX, originZ);
    this.dirtyChunks.add(key);
    return false;
  }

  /**
   * After a chunk at (originX, originZ) is loaded, activates any boundary
   * fluid cell in it — or in its 4 cardinal neighbours — that has a
   * cross-chunk neighbour of Air or opposing fluid. Complements
   * `Chunk.canFluidAct` (which only sees in-chunk neighbours) so fluids
   * along shared boundaries are correctly woken without keeping every
   * boundary cell permanently active.
   */
  private primeFluidBoundaries(originX: number, originZ: number): void {
    const thisChunk = this.getChunk(originX, originZ);
    if (!thisChunk) return;
    for (const [dwx, dwz] of CARDINAL_CHUNK_DELTAS) {
      const neighbor = this.getChunk(originX + dwx, originZ + dwz);
      if (!neighbor) continue;
      // Skip if neither chunk has any fluid on the shared face — saves the
      // CHUNK_HEIGHT × CHUNK_SIZE scan for dry (e.g. mountain, desert surface)
      // chunk pairs, which dominate initial world exploration.
      if (thisChunk.maxFluidY < 0 && neighbor.maxFluidY < 0) continue;
      const dx = Math.sign(dwx);
      const dz = Math.sign(dwz);
      thisChunk.primeAgainstNeighbor(neighbor, dx, dz);
      neighbor.primeAgainstNeighbor(thisChunk, -dx, -dz);
    }
  }

  private encodedBlocks(entry: ChunkEntry): Uint8Array {
    if (!entry.encoded) entry.encoded = encodeBlocks(entry.chunk.blocks);
    return entry.encoded;
  }

  private encodedFluidLevels(entry: ChunkEntry): Uint8Array {
    if (!entry.encodedFluidLevels) {
      entry.encodedFluidLevels = encodeBlocks(entry.chunk.fluidLevels);
    }
    return entry.encodedFluidLevels;
  }

  /**
   * Speculatively pre-generates the 4 cardinal neighbors of newly generated
   * chunks. Deferred via setTimeout so the RPC calls don't inherit the
   * current invocation's input gate.
   */
  private preGenerateNeighbors(newlyGenerated: Array<{ originX: number; originZ: number }>): void {
    if (newlyGenerated.length === 0) return;
    const toPreGen = new Map<string, { originX: number; originZ: number }>();
    for (const { originX, originZ } of newlyGenerated) {
      for (const [dx, dz] of CARDINAL_CHUNK_DELTAS) {
        const nox = originX + dx;
        const noz = originZ + dz;
        const nkey = chunkKey(nox, noz);
        if (!this.chunks.has(nkey)) toPreGen.set(nkey, { originX: nox, originZ: noz });
      }
    }
    if (toPreGen.size === 0) return;
    setTimeout(() => {
      void Promise.all([...toPreGen.values()].map(({ originX, originZ }) => this.ensureChunk(originX, originZ)));
    }, 0);
  }
}
