import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, type Chunk, chunkOrigin } from "@/game/chunk";
import type * as schema from "../server/schema";
import type { ChunkStorage } from "./chunk-storage";
import type { GameSystem, SystemContext } from "./game-system";
import type { ServerPacket } from "./protocol";

/**
 * Water advances every `WATER_TICK_EVERY_N` GameRoom ticks (200 ms at a 50 ms
 * server tick). Lava advances every `LAVA_TICK_EVERY_N` ticks
 */
const WATER_TICK_EVERY_N = 4;
const LAVA_TICK_EVERY_N = 12;

/**
 * Server-side fluid simulation. Iterates every loaded chunk that has pending
 * fluid cells and delegates to `Chunk.tickFluids()`, routing cross-chunk
 * lateral spillover through `ChunkStorage`. Block changes produced by the sim
 * are broadcast to all clients via a `blockChanges` packet
 */
export class FluidSystem implements GameSystem {
  readonly key = "fluids";

  private readonly storage: ChunkStorage;
  private pendingChanges: Array<{ x: number; y: number; z: number; blockType: number }> = [];
  private tickCounter = 0;

  constructor(storage: ChunkStorage) {
    this.storage = storage;
  }

  hydrate(_db: DrizzleSqliteDODatabase<typeof schema>): void {}

  tick(): boolean {
    this.tickCounter++;
    if (this.tickCounter % WATER_TICK_EVERY_N !== 0) return false;
    const tickLava = this.tickCounter % LAVA_TICK_EVERY_N === 0;

    const spillover = (
      wx: number,
      wy: number,
      wz: number,
      type: CubeType.Water | CubeType.Lava,
      level: number,
    ): boolean => {
      const [ox, oz] = chunkOrigin(wx, wz);
      const target = this.storage.getChunk(ox, oz);
      if (!target) return false;
      const lx = wx - (ox - CHUNK_SIZE / 2);
      const lz = wz - (oz - CHUNK_SIZE / 2);
      if (target.applyFluidFlow(lx, wy, lz, type, level)) {
        this.pendingChanges.push({ x: wx, y: wy, z: wz, blockType: type });
        return true;
      }
      return false;
    };
    const onChange = (wx: number, wy: number, wz: number, blockType: CubeType): void => {
      this.pendingChanges.push({ x: wx, y: wy, z: wz, blockType });
    };

    // Snapshot first; Chunk.tickFluids can (via spillover) mutate neighbor
    // activeFluids, and we don't want chunks freshly-activated mid-tick to
    // run this round (they tick next round).
    const candidates: Chunk[] = [];
    for (const chunk of this.storage.loadedChunks()) {
      if (chunk.activeFluidCount > 0) candidates.push(chunk);
    }
    for (const chunk of candidates) chunk.tickFluids(spillover, onChange, tickLava);

    // Mark each touched chunk dirty once; many cell changes typically land in
    // the same chunk (waterfalls, expanding puddles), so deduping avoids
    // redundant Map lookups and RLE-cache invalidations.
    const dirtyKeys = new Set<string>();
    for (const change of this.pendingChanges) {
      const [ox, oz] = chunkOrigin(change.x, change.z);
      const key = `${ox},${oz}`;
      if (dirtyKeys.has(key)) continue;
      dirtyKeys.add(key);
      this.storage.markDirty(change.x, change.z);
    }

    return this.pendingChanges.length > 0;
  }

  packetsFor(_playerId: string, _ctx: SystemContext): ServerPacket[] {
    if (this.pendingChanges.length === 0) return [];
    return [{ type: "blockChanges", changes: [...this.pendingChanges] }];
  }

  clearPending(): void {
    this.pendingChanges = [];
  }

  hasDirty(): boolean {
    return false;
  }

  flush(_db: DrizzleSqliteDODatabase<typeof schema>): void {}
}
