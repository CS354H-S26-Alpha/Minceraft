import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { CubeType } from "@/client/engine/render/cube-types";
import type * as schema from "../server/schema";
import type { BlockMutation, ChunkStore } from "./chunk-store";
import type { GameSystem, SystemContext } from "./game-system";
import type { PlayerSystem } from "./player-system";
import type { BlockActionPacket, ServerPacket } from "./protocol";

const MAX_INTERACT_DISTANCE_SQ = 7 * 7;
const MAX_ACTIONS_PER_TICK = 10;

export class BlockSystem implements GameSystem {
  readonly key = "blocks";

  private chunkStore: DurableObjectStub<ChunkStore>;
  private playerSystem: PlayerSystem;
  private pendingActions = new Map<string, BlockActionPacket[]>();
  private pendingAcks = new Map<string, Array<{ seq: number; accepted: boolean }>>();
  private pendingChanges: Array<{ x: number; y: number; z: number; blockType: number }> = [];

  constructor(chunkStore: DurableObjectStub<ChunkStore>, playerSystem: PlayerSystem) {
    this.chunkStore = chunkStore;
    this.playerSystem = playerSystem;
  }

  hydrate(_db: DrizzleSqliteDODatabase<typeof schema>): void {
    // No-op — ChunkStore owns its own persistence
  }

  queueAction(playerId: string, action: BlockActionPacket): void {
    let queue = this.pendingActions.get(playerId);
    if (!queue) {
      queue = [];
      this.pendingActions.set(playerId, queue);
    }
    queue.push(action);
  }

  async tick(): Promise<boolean> {
    if (this.pendingActions.size === 0) return false;

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
    const results = await this.chunkStore.processActions(mutations);

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

  packetsFor(playerId: string, _ctx: SystemContext): ServerPacket[] {
    const packets: ServerPacket[] = [];
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
    return false;
  }

  flush(_db: DrizzleSqliteDODatabase<typeof schema>): void {
    // No-op — ChunkStore manages its own persistence
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
