import { DurableObject } from "cloudflare:workers";
import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, chunkKey, chunkOrigin, rleDecodeBlocks, rleEncodeBlocks } from "@/game/chunk";
import type { ChunkGen } from "@/server/chunk-gen";

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

const FLUSH_DELAY_MS = 5000;
const META_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)";
const CHUNK_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS chunks (key TEXT PRIMARY KEY, data BLOB NOT NULL)";
const SEED_META_KEY = "seed";

export class ChunkStore extends DurableObject<Env> {
  private chunks = new Map<string, Chunk>();
  private dirtyChunks = new Set<string>();
  private seed = 0;
  private initialized = false;

  initialize(seed: number): void {
    this.ensureInitialized(seed);
  }

  async processActions(actions: BlockMutation[]): Promise<BlockMutationResult[]> {
    this.ensureInitialized();

    // Collect unique chunk keys that need to be loaded
    const neededKeys = new Set<string>();
    for (const action of actions) {
      if (action.y < 0 || action.y >= CHUNK_HEIGHT) continue;
      const [ox, oz] = chunkOrigin(action.x, action.z);
      const key = chunkKey(ox, oz);
      if (!this.chunks.has(key)) neededKeys.add(key);
    }

    // Load/generate all needed chunks in parallel
    if (neededKeys.size > 0) {
      await Promise.all([...neededKeys].map((key) => this.ensureChunk(key)));
    }

    // Process actions — all chunks are now in memory
    const results: BlockMutationResult[] = [];
    for (const action of actions) {
      const { x, y, z } = action;

      if (y < 0 || y >= CHUNK_HEIGHT) {
        results.push({ accepted: false, previousType: CubeType.Air });
        continue;
      }

      const currentType = this.getBlockInternal(x, y, z);

      if (action.action === "break") {
        if (currentType === CubeType.Air || currentType === CubeType.Bedrock) {
          results.push({ accepted: false, previousType: currentType });
          continue;
        }
        this.setBlockInternal(x, y, z, CubeType.Air);
        results.push({ accepted: true, previousType: currentType });
      } else {
        if (currentType !== CubeType.Air) {
          results.push({ accepted: false, previousType: currentType });
          continue;
        }
        const blockType = (action.blockType ?? CubeType.Dirt) as CubeType;
        this.setBlockInternal(x, y, z, blockType);
        results.push({ accepted: true, previousType: CubeType.Air });
      }
    }

    if (this.dirtyChunks.size > 0) {
      this.schedulePersist();
    }

    // Speculatively pre-generate adjacent chunks for recently touched chunks
    this.preGenerateNeighbors(neededKeys);

    return results;
  }

  async getChunks(
    origins: Array<{ originX: number; originZ: number }>,
  ): Promise<Array<{ originX: number; originZ: number; blocks: Uint8Array }>> {
    this.ensureInitialized();

    const neededKeys = new Set<string>();
    for (const { originX, originZ } of origins) {
      const key = chunkKey(originX, originZ);
      if (!this.chunks.has(key)) neededKeys.add(key);
    }
    const startedAt = Date.now();
    this.log("get_chunks_started", {
      requestChunkCount: origins.length,
      missingChunkCount: neededKeys.size,
      sampleMissingChunkKeys: [...neededKeys].slice(0, 5),
    });
    try {
      if (neededKeys.size > 0) {
        await Promise.all([...neededKeys].map((key) => this.ensureChunk(key)));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("get_chunks_failed", {
        durationMs: Date.now() - startedAt,
        requestChunkCount: origins.length,
        missingChunkCount: neededKeys.size,
        error: message,
      });
      throw error;
    }
    const result = origins.map(({ originX, originZ }) => {
      const chunk = this.chunks.get(chunkKey(originX, originZ));
      if (!chunk) return { originX, originZ, blocks: new Uint8Array(0) };
      return { originX, originZ, blocks: rleEncodeBlocks(chunk.blocks, CHUNK_SIZE) };
    });
    this.log("get_chunks_finished", {
      durationMs: Date.now() - startedAt,
      requestChunkCount: origins.length,
      missingChunkCount: neededKeys.size,
      returnedChunkCount: result.length,
    });
    return result;
  }

  getBlock(wx: number, wy: number, wz: number): number {
    return this.getBlockInternal(wx, wy, wz);
  }

  override async alarm(): Promise<void> {
    this.flushDirty();
  }

  /**
   * Ensures a chunk is loaded into memory. Checks the in-memory cache first,
   * then SQLite, then dispatches to the ChunkGen service worker for parallel
   * generation on a separate isolate.
   */
  private ensureInitialized(seed?: number): void {
    if (this.initialized) {
      if (seed !== undefined) this.seed = seed;
      return;
    }

    this.ctx.storage.sql.exec(META_SCHEMA_SQL);
    this.ctx.storage.sql.exec(CHUNK_SCHEMA_SQL);

    if (seed !== undefined) {
      this.seed = seed;
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
        SEED_META_KEY,
        String(seed),
      );
    } else {
      const rows = this.ctx.storage.sql
        .exec("SELECT value FROM meta WHERE key = ?", SEED_META_KEY)
        .toArray() as Array<{ value: string }>;
      if (rows.length > 0) {
        this.seed = Number(rows[0]!.value);
      }
    }

    this.initialized = true;
    this.log("chunk_store_initialized", {
      seed: this.seed,
      restoredFromMetadata: seed === undefined,
    });
  }

  private async ensureChunk(key: string): Promise<void> {
    if (this.chunks.has(key)) return;

    const [oxStr, ozStr] = key.split(",");
    const originX = Number(oxStr);
    const originZ = Number(ozStr);

    // Check SQLite for a previously persisted chunk
    const rows = this.ctx.storage.sql.exec("SELECT data FROM chunks WHERE key = ?", key).toArray() as Array<{
      data: ArrayBuffer;
    }>;

    if (rows.length > 0) {
      const encoded = new Uint8Array(rows[0]!.data);
      const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true);
      chunk.blocks.set(rleDecodeBlocks(encoded, CHUNK_SIZE));
      this.chunks.set(key, chunk);
      return;
    }

    // Dispatch to ChunkGen service worker for generation on a separate isolate
    const chunkGen = this.env.ChunkGen;
    if (chunkGen) {
      const startedAt = Date.now();
      this.log("generate_chunk_started", { chunkKey: key, originX, originZ });
      const encoded = await chunkGen.generateChunk(originX, originZ, this.seed);
      const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true);
      chunk.blocks.set(rleDecodeBlocks(new Uint8Array(encoded), CHUNK_SIZE));
      this.chunks.set(key, chunk);
      this.log("generate_chunk_finished", {
        chunkKey: key,
        originX,
        originZ,
        durationMs: Date.now() - startedAt,
      });
    } else {
      // Fallback: generate inline (no service binding available, e.g. in tests)
      const chunk = new Chunk(originX, originZ, CHUNK_SIZE, this.seed, true);
      this.chunks.set(key, chunk);
    }
  }

  private log(event: string, data: Record<string, unknown>): void {
    console.info(
      JSON.stringify({
        message: "chunk_store",
        event,
        chunkStoreId: this.ctx.id.toString(),
        cachedChunkCount: this.chunks.size,
        ...data,
      }),
    );
  }

  /**
   * Speculatively pre-generates the 4 cardinal neighbors of newly generated
   * chunks. Runs in the background without blocking processActions.
   */
  private preGenerateNeighbors(newlyGenerated: Set<string>): void {
    if (newlyGenerated.size === 0) return;

    const toPreGen = new Set<string>();
    for (const key of newlyGenerated) {
      const [oxStr, ozStr] = key.split(",");
      const ox = Number(oxStr);
      const oz = Number(ozStr);
      for (const [dx, dz] of [
        [CHUNK_SIZE, 0],
        [-CHUNK_SIZE, 0],
        [0, CHUNK_SIZE],
        [0, -CHUNK_SIZE],
      ] as const) {
        const neighborKey = chunkKey(ox + dx, oz + dz);
        if (!this.chunks.has(neighborKey)) toPreGen.add(neighborKey);
      }
    }

    if (toPreGen.size > 0) {
      // Fire-and-forget — don't block the current tick
      void Promise.all([...toPreGen].map((key) => this.ensureChunk(key)));
    }
  }

  private getBlockInternal(wx: number, wy: number, wz: number): CubeType {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return CubeType.Air;
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    const chunk = this.chunks.get(key);
    if (!chunk) return CubeType.Air;
    return chunk.getBlockWorld(wx, wy, wz);
  }

  private setBlockInternal(wx: number, wy: number, wz: number, blockType: CubeType): void {
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    const lx = wx - (originX - CHUNK_SIZE / 2);
    const lz = wz - (originZ - CHUNK_SIZE / 2);
    chunk.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = blockType;
    this.dirtyChunks.add(key);
  }

  private schedulePersist(): void {
    void this.ctx.storage.getAlarm().then((existing) => {
      if (!existing) {
        void this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY_MS);
      }
    });
  }

  private flushDirty(): void {
    for (const key of this.dirtyChunks) {
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      const encoded = rleEncodeBlocks(chunk.blocks, CHUNK_SIZE);
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO chunks (key, data) VALUES (?, ?)", key, encoded.buffer);
    }
    this.dirtyChunks.clear();
  }
}
