import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, chunkKey, chunkOrigin } from "@/game/chunk";
import type * as schema from "../server/schema";
import type { ChunkBlob, ChunkStorage } from "./chunk-storage";
import type { GameSystem, SystemContext } from "./game-system";
import { blockIntersectsPlayer } from "./player";
import type { PlayerSystem } from "./player-system";
import type { BlockActionPacket, ServerPacket } from "./protocol";

const MAX_INTERACT_DISTANCE_SQ = 7 * 7;
const MAX_ACTIONS_PER_TICK = 20;
const CHUNKS_PER_TICK = 2;

export interface BlockSystemOptions {
  /** Chunk radius for the initial load on join (default 5 → 10x10 grid). */
  initialLoadRadius?: number;
  /** Chunk radius for subsequent loads on movement (default 4 → 9x9 grid). */
  loadRadius?: number;
}

export class BlockSystem implements GameSystem {
  readonly key = "blocks";

  private readonly storage: ChunkStorage;
  private readonly playerSystem: PlayerSystem;
  private pendingAcks = new Map<string, Array<{ seq: number; accepted: boolean }>>();
  private pendingChanges: Array<{ x: number; y: number; z: number; blockType: number }> = [];
  private pendingChunkData = new Map<string, ChunkBlob[]>();
  private playerChunkOrigins = new Map<string, string>();
  private pendingChunkRequests = new Map<string, { origins: Array<{ originX: number; originZ: number }> }>();
  /** Per-player set of chunk keys already queued/sent in this session. Skips re-queuing unchanged overlap on boundary crossings. */
  private playerSentChunks = new Map<string, Set<string>>();
  private playerGeneration = new Map<string, number>();
  private readonly initialLoadRadius: number;
  private readonly loadRadius: number;
  private inFlightChunkFetch = false;
  private chunkFetchStartedAtMs = 0;
  private lastSlowFetchLogAtMs = 0;

  constructor(storage: ChunkStorage, playerSystem: PlayerSystem, opts?: BlockSystemOptions) {
    this.storage = storage;
    this.playerSystem = playerSystem;
    this.initialLoadRadius = opts?.initialLoadRadius ?? 9;
    this.loadRadius = opts?.loadRadius ?? 8;
  }

  hydrate(_db: DrizzleSqliteDODatabase<typeof schema>): void {}

  /**
   * Validates and applies a block action synchronously. Accepted mutations
   * are broadcast to everyone; the ack (accepted or not) is returned only to
   * the acting player.
   */
  async queueAction(playerId: string, action: BlockActionPacket): Promise<void> {
    const pos = this.playerSystem.getPlayerPosition(playerId);
    if (!pos) {
      this.pushAck(playerId, action.seq, false);
      return;
    }
    const acks = this.pendingAcks.get(playerId);
    if (acks && acks.length >= MAX_ACTIONS_PER_TICK) {
      this.pushAck(playerId, action.seq, false);
      return;
    }
    const dx = pos.x - action.x;
    const dy = pos.y - action.y;
    const dz = pos.z - action.z;
    if (dx * dx + dy * dy + dz * dz > MAX_INTERACT_DISTANCE_SQ) {
      this.pushAck(playerId, action.seq, false);
      return;
    }
    if (action.action === "place" && blockIntersectsPlayer(action.x, action.y, action.z, pos)) {
      this.pushAck(playerId, action.seq, false);
      return;
    }

    const result = await this.storage.applyMutation(
      {
        action: action.action,
        x: action.x,
        y: action.y,
        z: action.z,
        blockType: action.blockType,
      },
      { x: pos.x, z: pos.z },
    );
    this.pushAck(playerId, action.seq, result.accepted);
    if (result.accepted) {
      const blockType = action.action === "break" ? CubeType.Air : (action.blockType ?? CubeType.Dirt);
      this.pendingChanges.push({ x: action.x, y: action.y, z: action.z, blockType });
    }
  }

  /** Called from GameRoom.join() — queues initial chunk load around spawn. */
  onPlayerJoin(playerId: string): void {
    this.playerGeneration.set(playerId, (this.playerGeneration.get(playerId) ?? 0) + 1);
    this.pendingChunkData.delete(playerId);
    this.playerSentChunks.set(playerId, new Set());

    const pos = this.playerSystem.getPlayerPosition(playerId);
    if (!pos) return;
    const [ox, oz] = chunkOrigin(pos.x, pos.z);
    this.playerChunkOrigins.set(playerId, chunkKey(ox, oz));
    this.queueChunkLoad(playerId, ox, oz, this.initialLoadRadius);
  }

  /**
   * Called from GameRoom.sendPosition() — checks for chunk boundary crossing.
   * Bumps generation to invalidate in-flight miss fetches, but preserves
   * `pendingChunkData` and `playerSentChunks` since the client already holds
   * any chunks previously broadcast.
   */
  onPlayerPosition(playerId: string, x: number, z: number): void {
    const [ox, oz] = chunkOrigin(x, z);
    const currentKey = chunkKey(ox, oz);
    const lastKey = this.playerChunkOrigins.get(playerId);
    if (currentKey === lastKey) return;
    this.playerGeneration.set(playerId, (this.playerGeneration.get(playerId) ?? 0) + 1);
    this.playerChunkOrigins.set(playerId, currentKey);
    this.queueChunkLoad(playerId, ox, oz, this.loadRadius);
  }

  onPlayerLeave(playerId: string): void {
    this.playerGeneration.delete(playerId);
    this.pendingChunkData.delete(playerId);
    this.playerChunkOrigins.delete(playerId);
    this.pendingChunkRequests.delete(playerId);
    this.playerSentChunks.delete(playerId);
  }

  tick(): boolean {
    if (this.inFlightChunkFetch) {
      const now = Date.now();
      const elapsedMs = now - this.chunkFetchStartedAtMs;
      if (elapsedMs >= 5000 && now - this.lastSlowFetchLogAtMs >= 5000) {
        this.lastSlowFetchLogAtMs = now;
        console.warn(`[BlockSystem] chunk fetch still in flight after ${elapsedMs}ms`);
      }
    } else if (this.pendingChunkRequests.size > 0) {
      this.drainChunkRequests();
    }

    return this.pendingChunkData.size > 0 || this.pendingAcks.size > 0 || this.pendingChanges.length > 0;
  }

  packetsFor(playerId: string, _ctx: SystemContext): ServerPacket[] {
    const packets: ServerPacket[] = [];

    const chunkData = this.pendingChunkData.get(playerId);
    if (chunkData?.length) {
      packets.push({ type: "chunkData", chunks: chunkData });
      this.pendingChunkData.delete(playerId);
    }

    const acks = this.pendingAcks.get(playerId);
    if (acks?.length) {
      packets.push({ type: "blockAck", acks });
    }

    if (this.pendingChanges.length > 0) {
      packets.push({ type: "blockChanges", changes: [...this.pendingChanges] });
    }

    return packets;
  }

  clearPending(): void {
    this.pendingAcks.clear();
    this.pendingChanges = [];
  }

  hasDirty(): boolean {
    return this.storage.hasDirty();
  }

  flush(_db: DrizzleSqliteDODatabase<typeof schema>): void {
    this.storage.flush();
  }

  private queueChunkLoad(playerId: string, ox: number, oz: number, radius: number): void {
    const sent = this.playerSentChunks.get(playerId);
    const origins: Array<{ originX: number; originZ: number }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const originX = ox + dx * CHUNK_SIZE;
        const originZ = oz + dz * CHUNK_SIZE;
        if (sent?.has(chunkKey(originX, originZ))) continue;
        origins.push({ originX, originZ });
      }
    }
    // Sort by Chebyshev distance so closest chunks are processed first
    origins.sort((a, b) => {
      const da = Math.max(Math.abs(a.originX - ox), Math.abs(a.originZ - oz));
      const db = Math.max(Math.abs(b.originX - ox), Math.abs(b.originZ - oz));
      return da - db;
    });
    const existing = this.pendingChunkRequests.get(playerId);
    if (existing) {
      existing.origins = origins;
    } else if (origins.length > 0) {
      this.pendingChunkRequests.set(playerId, { origins });
    }
  }

  /**
   * Pulls the next batch off each player's request queue. Cache hits ship
   * immediately in the current tick's broadcast; misses dispatch to
   * `ChunkStorage.loadChunks` and are picked up on a later tick. Only called
   * when no fetch is in flight.
   */
  private drainChunkRequests(): void {
    const missBatches = new Map<string, Array<{ originX: number; originZ: number }>>();
    const allMisses = new Map<string, { originX: number; originZ: number }>();

    for (const [playerId, req] of this.pendingChunkRequests) {
      const batch = req.origins.splice(0, CHUNKS_PER_TICK);
      if (batch.length === 0) continue;
      if (req.origins.length === 0) this.pendingChunkRequests.delete(playerId);

      const { hits, misses } = this.storage.sliceByCache(batch);
      if (hits.length > 0) this.appendPending(playerId, hits);
      if (misses.length > 0) {
        missBatches.set(playerId, misses);
        for (const o of misses) allMisses.set(chunkKey(o.originX, o.originZ), o);
      }
    }

    if (allMisses.size === 0) return;

    this.inFlightChunkFetch = true;
    this.chunkFetchStartedAtMs = Date.now();

    const capturedGens = new Map<string, number>();
    for (const playerId of missBatches.keys()) {
      capturedGens.set(playerId, this.playerGeneration.get(playerId) ?? 0);
    }

    // Defer the fetch into a fresh event via setTimeout(0) so the ChunkGen
    // service-binding RPCs don't sit in the current invocation's input gate
    // (which would block subsequent DO method calls until generation completes).
    setTimeout(() => {
      this.storage
        .loadChunks([...allMisses.values()])
        .then((loaded) => {
          const loadedMap = new Map<string, ChunkBlob>();
          for (const blob of loaded) loadedMap.set(chunkKey(blob.originX, blob.originZ), blob);
          for (const [playerId, origins] of missBatches) {
            if ((this.playerGeneration.get(playerId) ?? -1) !== capturedGens.get(playerId)) continue;
            const chunks: ChunkBlob[] = [];
            for (const o of origins) {
              const blob = loadedMap.get(chunkKey(o.originX, o.originZ));
              if (blob) chunks.push(blob);
            }
            if (chunks.length > 0) this.appendPending(playerId, chunks);
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[BlockSystem] chunk load failed: ${message}`);
          this.requeueMisses(missBatches, capturedGens);
        })
        .finally(() => {
          this.inFlightChunkFetch = false;
        });
    }, 0);
  }

  private appendPending(playerId: string, chunks: ChunkBlob[]): void {
    const existing = this.pendingChunkData.get(playerId);
    if (existing) {
      existing.push(...chunks);
    } else {
      this.pendingChunkData.set(playerId, chunks);
    }
    const sent = this.playerSentChunks.get(playerId);
    if (sent) {
      for (const blob of chunks) sent.add(chunkKey(blob.originX, blob.originZ));
    }
  }

  private requeueMisses(
    missBatches: Map<string, Array<{ originX: number; originZ: number }>>,
    capturedGens: Map<string, number>,
  ): void {
    for (const [playerId, origins] of missBatches) {
      if (origins.length === 0) continue;
      if ((this.playerGeneration.get(playerId) ?? -1) !== capturedGens.get(playerId)) continue;
      const existing = this.pendingChunkRequests.get(playerId);
      if (existing) {
        existing.origins = [...origins, ...existing.origins];
      } else {
        this.pendingChunkRequests.set(playerId, { origins: [...origins] });
      }
    }
  }

  private pushAck(playerId: string, seq: number, accepted: boolean): void {
    let acks = this.pendingAcks.get(playerId);
    if (!acks) {
      acks = [];
      this.pendingAcks.set(playerId, acks);
    }
    acks.push({ seq, accepted });
  }
}
