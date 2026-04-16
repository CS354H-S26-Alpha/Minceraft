import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, chunkKey, chunkOrigin } from "@/game/chunk";
import type * as schema from "../server/schema";
import type { BlockMutation, ChunkStore } from "./chunk-store";
import type { GameSystem, SystemContext } from "./game-system";
import type { PlayerSystem } from "./player-system";
import type { BlockActionPacket, ServerPacket } from "./protocol";

const MAX_INTERACT_DISTANCE_SQ = 7 * 7;
const MAX_ACTIONS_PER_TICK = 10;
const CHUNKS_PER_TICK = 9;

export interface BlockSystemOptions {
  /** Chunk radius for the initial load on join (default 5 → 10x10 grid). */
  initialLoadRadius?: number;
  /** Chunk radius for subsequent loads on movement (default 4 → 9x9 grid). */
  loadRadius?: number;
}

export class BlockSystem implements GameSystem {
  readonly key = "blocks";

  private readonly getChunkStore: () => DurableObjectStub<ChunkStore>;
  private playerSystem: PlayerSystem;
  private readonly roomId: string;
  private pendingActions = new Map<string, BlockActionPacket[]>();
  private pendingAcks = new Map<string, Array<{ seq: number; accepted: boolean }>>();
  private pendingChanges: Array<{ x: number; y: number; z: number; blockType: number }> = [];
  private pendingChunkData = new Map<string, Array<{ originX: number; originZ: number; blocks: Uint8Array }>>();
  private playerChunkOrigins = new Map<string, string>();
  private pendingChunkRequests = new Map<string, { origins: Array<{ originX: number; originZ: number }> }>();
  private playerGeneration = new Map<string, number>();
  private readonly initialLoadRadius: number;
  private readonly loadRadius: number;
  private inFlightChunkFetch = false;
  private chunkFetchSeq = 0;
  private chunkFetchStartedAtMs = 0;
  private lastSlowFetchLogAtMs = 0;

  constructor(
    getChunkStore: () => DurableObjectStub<ChunkStore>,
    playerSystem: PlayerSystem,
    opts?: BlockSystemOptions,
    roomId = "unknown",
  ) {
    this.getChunkStore = getChunkStore;
    this.playerSystem = playerSystem;
    this.initialLoadRadius = opts?.initialLoadRadius ?? 5;
    this.loadRadius = opts?.loadRadius ?? 4;
    this.roomId = roomId;
  }

  hydrate(_db: DrizzleSqliteDODatabase<typeof schema>): void {}

  queueAction(playerId: string, action: BlockActionPacket): void {
    let queue = this.pendingActions.get(playerId);
    if (!queue) {
      queue = [];
      this.pendingActions.set(playerId, queue);
    }
    queue.push(action);
  }

  /** Called from GameRoom.join() — queues initial chunk load around spawn. */
  onPlayerJoin(playerId: string): void {
    this.playerGeneration.set(playerId, (this.playerGeneration.get(playerId) ?? 0) + 1);
    this.pendingChunkData.delete(playerId);
    this.inFlightChunkFetch = false;

    const pos = this.playerSystem.getPlayerPosition(playerId);
    if (!pos) return;
    const [ox, oz] = chunkOrigin(pos.x, pos.z);
    this.playerChunkOrigins.set(playerId, chunkKey(ox, oz));
    this.queueChunkLoad(playerId, ox, oz, this.initialLoadRadius);
    this.log("player_join_chunk_load", { playerId, originX: ox, originZ: oz, radius: this.initialLoadRadius });
  }

  /** Called from GameRoom.sendPosition() — checks for chunk boundary crossing. */
  onPlayerPosition(playerId: string, x: number, z: number): void {
    const [ox, oz] = chunkOrigin(x, z);
    const currentKey = chunkKey(ox, oz);
    const lastKey = this.playerChunkOrigins.get(playerId);
    if (currentKey === lastKey) return;
    this.playerGeneration.set(playerId, (this.playerGeneration.get(playerId) ?? 0) + 1);
    this.pendingChunkData.delete(playerId);
    this.playerChunkOrigins.set(playerId, currentKey);
    this.queueChunkLoad(playerId, ox, oz, this.loadRadius);
    this.log("player_crossed_chunk_boundary", {
      playerId,
      originX: ox,
      originZ: oz,
      previousOriginKey: lastKey ?? null,
      generation: this.playerGeneration.get(playerId) ?? 0,
    });
  }

  onPlayerLeave(playerId: string): void {
    this.playerGeneration.delete(playerId);
    this.pendingChunkData.delete(playerId);
    this.playerChunkOrigins.delete(playerId);
    this.pendingChunkRequests.delete(playerId);
  }

  async tick(): Promise<boolean> {
    let changed = this.pendingChunkData.size > 0;

    if (this.inFlightChunkFetch) {
      const now = Date.now();
      const elapsedMs = now - this.chunkFetchStartedAtMs;
      if (elapsedMs >= 2000 && now - this.lastSlowFetchLogAtMs >= 2000) {
        this.lastSlowFetchLogAtMs = now;
        this.log("chunk_fetch_still_in_flight", {
          fetchSeq: this.chunkFetchSeq,
          elapsedMs,
          pendingRequestPlayers: this.pendingChunkRequests.size,
          pendingChunkPlayers: this.pendingChunkData.size,
        });
      }
    }

    if (this.pendingChunkRequests.size > 0 && !this.inFlightChunkFetch) {
      this.startChunkFetch();
    }

    if (this.pendingActions.size > 0) {
      changed = (await this.processBlockActions()) || changed;
    }

    return changed;
  }

  packetsFor(playerId: string, _ctx: SystemContext): ServerPacket[] {
    const packets: ServerPacket[] = [];

    const chunkData = this.pendingChunkData.get(playerId);
    if (chunkData?.length) {
      this.log("deliver_chunk_data", {
        playerId,
        chunkCount: chunkData.length,
        fetchSeq: this.chunkFetchSeq,
      });
      packets.push({ type: "chunkData", chunks: chunkData });
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
    if (this.pendingChunkData.size > 0) {
      const totalChunks = [...this.pendingChunkData.values()].reduce((sum, chunks) => sum + chunks.length, 0);
      this.log("clear_pending_chunk_data", {
        playerCount: this.pendingChunkData.size,
        totalChunks,
      });
    }
    this.pendingAcks.clear();
    this.pendingChanges = [];
    this.pendingChunkData.clear();
  }

  hasDirty(): boolean {
    return false;
  }

  flush(_db: DrizzleSqliteDODatabase<typeof schema>): void {}

  private queueChunkLoad(playerId: string, ox: number, oz: number, radius: number): void {
    const origins: Array<{ originX: number; originZ: number }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        origins.push({ originX: ox + dx * CHUNK_SIZE, originZ: oz + dz * CHUNK_SIZE });
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
      // Replace with new request (player moved again before previous finished)
      existing.origins = origins;
      this.log("replace_pending_chunk_request", {
        playerId,
        originX: ox,
        originZ: oz,
        radius,
        originCount: origins.length,
      });
    } else {
      this.pendingChunkRequests.set(playerId, { origins });
      this.log("queue_chunk_request", { playerId, originX: ox, originZ: oz, radius, originCount: origins.length });
    }
  }

  private startChunkFetch(): void {
    this.inFlightChunkFetch = true;
    this.chunkFetchSeq++;
    this.chunkFetchStartedAtMs = Date.now();

    const allOrigins = new Map<string, { originX: number; originZ: number }>();
    const perPlayer = new Map<string, Array<{ originX: number; originZ: number }>>();

    for (const [playerId, req] of this.pendingChunkRequests) {
      const batch = req.origins.splice(0, CHUNKS_PER_TICK);
      perPlayer.set(playerId, batch);
      for (const o of batch) {
        allOrigins.set(chunkKey(o.originX, o.originZ), o);
      }
      if (req.origins.length === 0) {
        this.pendingChunkRequests.delete(playerId);
      }
    }

    if (allOrigins.size === 0) {
      this.inFlightChunkFetch = false;
      this.log("chunk_fetch_skipped_empty_batch", { fetchSeq: this.chunkFetchSeq });
      return;
    }

    const capturedGens = new Map<string, number>();
    for (const playerId of perPlayer.keys()) {
      capturedGens.set(playerId, this.playerGeneration.get(playerId) ?? 0);
    }

    this.log("chunk_fetch_started", {
      fetchSeq: this.chunkFetchSeq,
      uniqueChunkCount: allOrigins.size,
      playerCount: perPlayer.size,
      pendingRequestPlayers: this.pendingChunkRequests.size,
      sampleChunkKeys: [...allOrigins.keys()].slice(0, 5),
    });

    void this.getChunkStore()
      .getChunks([...allOrigins.values()])
      .then((chunkResults) => {
        const chunkMap = new Map<string, { originX: number; originZ: number; blocks: Uint8Array }>();
        for (const c of chunkResults) {
          chunkMap.set(chunkKey(c.originX, c.originZ), c);
        }

        for (const [playerId, origins] of perPlayer) {
          if ((this.playerGeneration.get(playerId) ?? -1) !== capturedGens.get(playerId)) {
            this.log("drop_stale_chunk_fetch_result", {
              fetchSeq: this.chunkFetchSeq,
              playerId,
              requestedChunkCount: origins.length,
              capturedGeneration: capturedGens.get(playerId) ?? -1,
              currentGeneration: this.playerGeneration.get(playerId) ?? -1,
            });
            continue;
          }

          const chunks: Array<{ originX: number; originZ: number; blocks: Uint8Array }> = [];
          for (const o of origins) {
            const c = chunkMap.get(chunkKey(o.originX, o.originZ));
            if (c) chunks.push(c);
          }
          if (chunks.length > 0) {
            const existing = this.pendingChunkData.get(playerId);
            if (existing) {
              existing.push(...chunks);
            } else {
              this.pendingChunkData.set(playerId, chunks);
            }
            this.log("append_chunk_fetch_result", {
              fetchSeq: this.chunkFetchSeq,
              playerId,
              chunkCount: chunks.length,
              pendingChunksForPlayer: this.pendingChunkData.get(playerId)?.length ?? 0,
            });
          }
        }

        this.log("chunk_fetch_resolved", {
          fetchSeq: this.chunkFetchSeq,
          durationMs: Date.now() - this.chunkFetchStartedAtMs,
          returnedChunkCount: chunkResults.length,
          pendingChunkPlayers: this.pendingChunkData.size,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.requeueFailedChunkBatch(perPlayer, capturedGens);
        this.log("chunk_fetch_failed", {
          fetchSeq: this.chunkFetchSeq,
          durationMs: Date.now() - this.chunkFetchStartedAtMs,
          error: message,
          pendingRequestPlayers: this.pendingChunkRequests.size,
          note: "failed batch was re-queued for players whose chunk generation is unchanged",
        });
      })
      .finally(() => {
        this.inFlightChunkFetch = false;
        this.log("chunk_fetch_finished", {
          fetchSeq: this.chunkFetchSeq,
          durationMs: Date.now() - this.chunkFetchStartedAtMs,
          pendingRequestPlayers: this.pendingChunkRequests.size,
          pendingChunkPlayers: this.pendingChunkData.size,
        });
      });
  }

  private requeueFailedChunkBatch(
    perPlayer: Map<string, Array<{ originX: number; originZ: number }>>,
    capturedGens: Map<string, number>,
  ): void {
    for (const [playerId, origins] of perPlayer) {
      if (origins.length === 0) continue;
      if ((this.playerGeneration.get(playerId) ?? -1) !== capturedGens.get(playerId)) {
        this.log("skip_requeue_stale_chunk_batch", {
          fetchSeq: this.chunkFetchSeq,
          playerId,
          chunkCount: origins.length,
          capturedGeneration: capturedGens.get(playerId) ?? -1,
          currentGeneration: this.playerGeneration.get(playerId) ?? -1,
        });
        continue;
      }

      const existing = this.pendingChunkRequests.get(playerId);
      if (existing) {
        existing.origins = [...origins, ...existing.origins];
      } else {
        this.pendingChunkRequests.set(playerId, { origins: [...origins] });
      }

      this.log("requeue_failed_chunk_batch", {
        fetchSeq: this.chunkFetchSeq,
        playerId,
        chunkCount: origins.length,
        pendingChunkCount: this.pendingChunkRequests.get(playerId)?.origins.length ?? origins.length,
      });
    }
  }

  private log(event: string, data: Record<string, unknown>): void {
    console.info(
      JSON.stringify({
        message: "block_system",
        event,
        roomId: this.roomId,
        inFlightChunkFetch: this.inFlightChunkFetch,
        ...data,
      }),
    );
  }

  private async processBlockActions(): Promise<boolean> {
    const validActions: Array<{ playerId: string; seq: number; mutation: BlockMutation }> = [];

    for (const [playerId, actions] of this.pendingActions) {
      const pos = this.playerSystem.getPlayerPosition(playerId);
      if (!pos) {
        for (const a of actions) this.pushAck(playerId, a.seq, false);
        continue;
      }

      let count = 0;
      for (const action of actions) {
        if (++count > MAX_ACTIONS_PER_TICK) {
          this.pushAck(playerId, action.seq, false);
          continue;
        }

        const dx = pos.x - action.x;
        const dy = pos.y - action.y;
        const dz = pos.z - action.z;
        if (dx * dx + dy * dy + dz * dz > MAX_INTERACT_DISTANCE_SQ) {
          this.pushAck(playerId, action.seq, false);
          continue;
        }

        validActions.push({
          playerId,
          seq: action.seq,
          mutation: {
            action: action.action,
            x: action.x,
            y: action.y,
            z: action.z,
            blockType: action.blockType,
          },
        });
      }
    }
    this.pendingActions.clear();

    if (validActions.length === 0) return this.pendingAcks.size > 0;

    const mutations = validActions.map((a) => a.mutation);
    const results = await this.getChunkStore().processActions(mutations);

    for (let i = 0; i < validActions.length; i++) {
      const { playerId, seq, mutation } = validActions[i]!;
      const result = results[i]!;
      this.pushAck(playerId, seq, result.accepted);
      if (result.accepted) {
        const blockType = mutation.action === "break" ? CubeType.Air : (mutation.blockType ?? CubeType.Dirt);
        this.pendingChanges.push({ x: mutation.x, y: mutation.y, z: mutation.z, blockType });
      }
    }

    return true;
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
