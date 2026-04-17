import { eq } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { CubeType, isFluidCubeType } from "@/client/engine/render/cube-types";
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, chunkKey, chunkOrigin, rleDecodeBlocks, rleEncodeBlocks } from "@/game/chunk";
import type { ChunkGen } from "@/server/chunk-gen";
import * as schema from "@/server/schema";

export interface BlockMutation {
  action: "place" | "break";
  x: number;
  y: number;
  z: number;
  blockType?: number;
  // Opt-in: when true, placing into unsupported air should immediately settle
  // downward so players cannot create floating blocks from side placement.
  settleOnPlace?: boolean;
}

export interface BlockChange {
  // World-space block cell update emitted to clients and tests.
  x: number;
  y: number;
  z: number;
  blockType: number;
}

export interface BlockMutationResult {
  accepted: boolean;
  previousType: number;
  // Full list of resulting cell updates (primary mutation + side effects).
  // Needed for features like undermining where one break can move many blocks.
  changes: BlockChange[];
}

export interface ChunkBlob {
  originX: number;
  originZ: number;
  blocks: Uint8Array;
}

interface ChunkEntry {
  chunk: Chunk;
  encoded: Uint8Array | undefined;
  encodedFluidLevels: Uint8Array | undefined;
}

/** Cap on in-memory chunks. Each chunk is 512KB (Uint8Array of CHUNK_SIZE²·CHUNK_HEIGHT). */
const MAX_MEMORY_CHUNKS = 160;

/** World-space deltas to the 4 cardinal neighbour chunks. */
const CARDINAL_CHUNK_DELTAS = [
  [CHUNK_SIZE, 0],
  [-CHUNK_SIZE, 0],
  [0, CHUNK_SIZE],
  [0, -CHUNK_SIZE],
] as const;

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
  // Insertion order = LRU ordering for eviction.
  private chunks = new Map<string, ChunkEntry>();
  private dirtyChunks = new Set<string>();
  private readonly db: ChunkDb;
  private readonly chunkGen: ChunkGenService | undefined;
  private seed = 0;

  constructor(db: ChunkDb, chunkGen: ChunkGenService | undefined) {
    this.db = db;
    this.chunkGen = chunkGen;
  }

  hydrate(seed: number): void {
    this.seed = seed;
  }

  /** Returns the cached block type, or `undefined` if the chunk isn't loaded. */
  getBlock(wx: number, wy: number, wz: number): CubeType | undefined {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return CubeType.Air;
    const [originX, originZ] = chunkOrigin(wx, wz);
    const entry = this.chunks.get(chunkKey(originX, originZ));
    if (!entry) return undefined;
    const lx = wx - (originX - CHUNK_SIZE / 2);
    const lz = wz - (originZ - CHUNK_SIZE / 2);
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return CubeType.Air;
    return (entry.chunk.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] ?? CubeType.Air) as CubeType;
  }

  /** Returns the cached `Chunk` instance, or `null` if the chunk isn't loaded. */
  getChunk(originX: number, originZ: number): Chunk | null {
    return this.chunks.get(chunkKey(originX, originZ))?.chunk ?? null;
  }

  /** Iterates loaded `Chunk` instances. Consumers must not retain references past the next eviction. */
  *loadedChunks(): IterableIterator<Chunk> {
    for (const entry of this.chunks.values()) yield entry.chunk;
  }

  /**
   * Applies a block mutation synchronously. Rejects if the chunk isn't loaded,
   * if the coordinate is out of range, or if the mutation violates the type
   * rules (can't break Air/Bedrock, can't place into non-Air). Returns the
   * previous block type and full resulting block changes for accepted
   * mutations; otherwise `accepted: false`.
   */
  applyMutation(action: BlockMutation): BlockMutationResult {
    const { x, y, z } = action;
    if (y < 0 || y >= CHUNK_HEIGHT) {
      return { accepted: false, previousType: CubeType.Air, changes: [] };
    }
    const current = this.getBlock(x, y, z);
    if (current === undefined) {
      return { accepted: false, previousType: CubeType.Air, changes: [] };
    }
    if (action.action === "break") {
      if (current === CubeType.Air || current === CubeType.Bedrock || isFluidCubeType(current)) {
        return { accepted: false, previousType: current, changes: [] };
      }
      // Breaking support can trigger cascading vertical settling in this
      // column, so compute and return all resulting updates.
      const changes = this.applyBreakWithFallingBlocks(x, y, z);
      return { accepted: true, previousType: current, changes };
    }
    if (current !== CubeType.Air && !isFluidCubeType(current)) {
      return { accepted: false, previousType: current, changes: [] };
    }
    const blockType = (action.blockType ?? CubeType.Dirt) as CubeType;
    // Only apply anti-floating settle on explicit player place actions into
    // Air. This avoids changing direct setup mutations in tests/tools and
    // avoids affecting fluid-replacement paths.
    const shouldSettlePlacedBlock = action.settleOnPlace === true && current === CubeType.Air;
    if (!shouldSettlePlacedBlock) {
      this.writeBlock(x, y, z, blockType);
      return {
        accepted: true,
        previousType: CubeType.Air,
        changes: [{ x, y, z, blockType }],
      };
    }

    const changes = this.applyPlaceWithFallingBlocks(x, y, z, blockType);
    return { accepted: true, previousType: CubeType.Air, changes };
  }

  private applyBreakWithFallingBlocks(wx: number, wy: number, wz: number): BlockChange[] {
    // Deduplicate by world coordinate so if a cell is touched more than once
    // during cascade, clients receive only the final state for that cell.
    const changesByCoord = new Map<string, BlockChange>();
    const recordChange = (x: number, y: number, z: number, blockType: number) => {
      changesByCoord.set(`${x},${y},${z}`, { x, y, z, blockType });
    };

    this.writeBlock(wx, wy, wz, CubeType.Air);
    this.activateFluidNeighbours(wx, wy, wz);
    recordChange(wx, wy, wz, CubeType.Air);

    // Start above the broken cell: only blocks that lost support can move.
    this.settleUnsupportedColumn(wx, wy + 1, wz, recordChange);

    return [...changesByCoord.values()];
  }

  private applyPlaceWithFallingBlocks(wx: number, wy: number, wz: number, blockType: CubeType): BlockChange[] {
    const changesByCoord = new Map<string, BlockChange>();
    const recordChange = (x: number, y: number, z: number, type: number) => {
      changesByCoord.set(`${x},${y},${z}`, { x, y, z, blockType: type });
    };

    this.writeBlock(wx, wy, wz, blockType);
    recordChange(wx, wy, wz, blockType);

    // If the newly placed block (or stack above it) has no support beneath,
    // settle it immediately so players cannot create floating structures.
    this.settleUnsupportedColumn(wx, wy, wz, recordChange);

    return [...changesByCoord.values()];
  }

  private settleUnsupportedColumn(
    wx: number,
    startY: number,
    wz: number,
    recordChange: (x: number, y: number, z: number, blockType: number) => void,
  ): void {
    // Bottom-up scan allows higher blocks to correctly settle onto blocks that
    // have already moved lower in this same pass.
    for (let scanY = Math.max(1, startY); scanY < CHUNK_HEIGHT; scanY++) {
      const blockType = this.getBlock(wx, scanY, wz);
      if (!this.shouldFallWhenUnsupported(blockType)) continue;
      if (this.getBlock(wx, scanY - 1, wz) !== CubeType.Air) continue;

      let destinationY = scanY;
      // Move directly to final supported Y in one authoritative update.
      while (destinationY > 0 && this.getBlock(wx, destinationY - 1, wz) === CubeType.Air) {
        destinationY--;
      }
      if (destinationY === scanY) continue;

      this.writeBlock(wx, scanY, wz, CubeType.Air);
      this.writeBlock(wx, destinationY, wz, blockType);
      this.activateFluidNeighbours(wx, scanY, wz);
      this.activateFluidNeighbours(wx, destinationY, wz);
      recordChange(wx, scanY, wz, CubeType.Air);
      recordChange(wx, destinationY, wz, blockType);
    }
  }

  private shouldFallWhenUnsupported(blockType: CubeType | undefined): blockType is CubeType {
    // Current rule: every non-fluid, non-bedrock solid participates in
    // undermining gravity. This intentionally mirrors the requested behavior
    // for "normal" blocks without affecting fluids.
    return (
      blockType !== undefined &&
      blockType !== CubeType.Air &&
      blockType !== CubeType.Bedrock &&
      !isFluidCubeType(blockType)
    );
  }

  /**
   * Wakes any fluid cell adjacent to world coord (wx, wy, wz). Each of the six
   * axis-aligned neighbours may live in a different chunk (across boundaries);
   * unloaded chunks are skipped. No block state is mutated — only the owning
   * chunk's `activeFluids` queue is updated — so no cache invalidation needed.
   */
  private activateFluidNeighbours(wx: number, wy: number, wz: number): void {
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0, -1, 0],
    ] as const) {
      const nx = wx + dx;
      const ny = wy + dy;
      const nz = wz + dz;
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const [ox, oz] = chunkOrigin(nx, nz);
      const entry = this.chunks.get(chunkKey(ox, oz));
      if (!entry) continue;
      const lx = nx - (ox - CHUNK_SIZE / 2);
      const lz = nz - (oz - CHUNK_SIZE / 2);
      entry.chunk.activateCellIfFluid(lx, ny, lz);
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
        this.touch(key);
        hits.push({ originX, originZ, blocks: this.encodedBlocks(entry) });
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
    const generated = new Set<string>();
    await Promise.all(
      origins.map(async ({ originX, originZ }) => {
        const key = chunkKey(originX, originZ);
        if (this.chunks.has(key)) return;
        const loadedFromDisk = await this.ensureChunk(originX, originZ);
        if (!loadedFromDisk) generated.add(key);
      }),
    );
    const result: ChunkBlob[] = [];
    for (const { originX, originZ } of origins) {
      const key = chunkKey(originX, originZ);
      const entry = this.chunks.get(key);
      if (!entry) continue;
      result.push({ originX, originZ, blocks: this.encodedBlocks(entry) });
    }
    this.preGenerateNeighbors(generated);
    this.maybeEvict();
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
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    const entry = this.chunks.get(key);
    if (!entry) return;
    entry.encoded = undefined;
    entry.encodedFluidLevels = undefined;
    this.dirtyChunks.add(key);
  }

  /** Persists every dirty chunk to SQLite and clears the dirty set. */
  flush(): void {
    for (const key of this.dirtyChunks) {
      const entry = this.chunks.get(key);
      if (!entry) continue;
      const data = this.encodedBlocks(entry);
      const fluidLevels = this.encodedFluidLevels(entry);
      this.db
        .insert(schema.chunks)
        .values({ key, data, fluidLevels })
        .onConflictDoUpdate({ target: schema.chunks.key, set: { data, fluidLevels } })
        .run();
    }
    this.dirtyChunks.clear();
  }

  private writeBlock(wx: number, wy: number, wz: number, blockType: CubeType): void {
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    const entry = this.chunks.get(key);
    if (!entry) return;
    const lx = wx - (originX - CHUNK_SIZE / 2);
    const lz = wz - (originZ - CHUNK_SIZE / 2);
    entry.chunk.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = blockType;
    entry.encoded = undefined;
    this.dirtyChunks.add(key);
  }

  /** Returns true if the chunk came from SQLite; false if it was generated. */
  private async ensureChunk(originX: number, originZ: number): Promise<boolean> {
    const key = chunkKey(originX, originZ);
    if (this.chunks.has(key)) return true;

    const row = this.db.select().from(schema.chunks).where(eq(schema.chunks.key, key)).get();
    if (row) {
      try {
        const encoded = new Uint8Array(row.data);
        const encodedFluidLevels = row.fluidLevels ? new Uint8Array(row.fluidLevels) : undefined;
        const blocks = rleDecodeBlocks(encoded, CHUNK_SIZE);
        const fluidLevels = encodedFluidLevels ? rleDecodeBlocks(encodedFluidLevels, CHUNK_SIZE) : undefined;
        const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true, { blocks, fluidLevels });
        this.chunks.set(key, { chunk, encoded, encodedFluidLevels });
        this.primeFluidBoundaries(originX, originZ);
        return true;
      } catch (err) {
        console.error(`Failed to decode chunk (${originX}, ${originZ}) from SQLite, will regenerate:`, err);
      }
    }

    if (this.chunkGen) {
      const encoded = new Uint8Array(await this.chunkGen.generateChunk(originX, originZ, this.seed));
      const blocks = rleDecodeBlocks(encoded, CHUNK_SIZE);
      const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true, { blocks });
      this.chunks.set(key, { chunk, encoded, encodedFluidLevels: undefined });
    } else {
      // Tests and local fallback: generate inline.
      const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true);
      this.chunks.set(key, { chunk, encoded: undefined, encodedFluidLevels: undefined });
    }
    this.primeFluidBoundaries(originX, originZ);
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
    if (!entry.encoded) entry.encoded = rleEncodeBlocks(entry.chunk.blocks, CHUNK_SIZE);
    return entry.encoded;
  }

  private encodedFluidLevels(entry: ChunkEntry): Uint8Array {
    if (!entry.encodedFluidLevels) {
      entry.encodedFluidLevels = rleEncodeBlocks(entry.chunk.fluidLevels, CHUNK_SIZE);
    }
    return entry.encodedFluidLevels;
  }

  private touch(key: string): void {
    const entry = this.chunks.get(key);
    if (!entry) return;
    this.chunks.delete(key);
    this.chunks.set(key, entry);
  }

  private maybeEvict(): void {
    if (this.chunks.size <= MAX_MEMORY_CHUNKS) return;
    if (this.dirtyChunks.size > 0) this.flush();
    const toRemove = this.chunks.size - MAX_MEMORY_CHUNKS;
    let removed = 0;
    for (const key of this.chunks.keys()) {
      if (removed >= toRemove) break;
      this.chunks.delete(key);
      removed++;
    }
  }

  /**
   * Speculatively pre-generates the 4 cardinal neighbors of newly generated
   * chunks. Deferred via setTimeout so the RPC calls don't inherit the
   * current invocation's input gate.
   */
  private preGenerateNeighbors(newlyGenerated: Set<string>): void {
    if (newlyGenerated.size === 0) return;
    const toPreGen = new Set<string>();
    for (const key of newlyGenerated) {
      const [oxStr, ozStr] = key.split(",");
      const ox = Number(oxStr);
      const oz = Number(ozStr);
      for (const [dx, dz] of CARDINAL_CHUNK_DELTAS) {
        const neighborKey = chunkKey(ox + dx, oz + dz);
        if (!this.chunks.has(neighborKey)) toPreGen.add(neighborKey);
      }
    }
    if (toPreGen.size === 0) return;
    setTimeout(() => {
      void Promise.all(
        [...toPreGen].map((key) => {
          const [oxStr, ozStr] = key.split(",");
          return this.ensureChunk(Number(oxStr), Number(ozStr));
        }),
      ).then(() => this.maybeEvict());
    }, 0);
  }
}
