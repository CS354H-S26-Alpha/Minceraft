import { eq } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type * as schema from "../server/schema";
import * as playerSchema from "../server/schema";
import type { ChunkMaster } from "./chunk-master";
import type { EntityCollection } from "./entity-collection";
import { Player, type PlayerInput, type PlayerState } from "./player";

const SPAWN_POSITION = { x: 0, y: 10000, z: 20, yaw: 0, pitch: 0 };
const MAX_QUEUED_INPUTS = 20;
const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 2.0;

/**
 * Manages the set of players in a room — their in-memory state, pending input
 * queues, ack counters, and dirty tracking for SQLite persistence.
 */
export class PlayerCollection implements EntityCollection {
  readonly key = "players";
  private chunkMaster: ChunkMaster;

  private players = new Map<string, Player>();
  private inputQueues = new Map<string, PlayerInput[]>();
  private acks = new Map<string, number>();
  private dirty = new Set<string>();

  constructor(chunkMaster: ChunkMaster) {
    this.chunkMaster = chunkMaster;
  }

  /** Restores all players from SQLite on DO startup. */
  hydrate(db: DrizzleSqliteDODatabase<typeof schema>): void {
    for (const row of db.select().from(playerSchema.players).all()) {
      const player = new Player(
        {
          id: row.id,
          name: row.name,
          x: row.x,
          y: row.y,
          z: row.z,
          yaw: row.yaw,
          pitch: row.pitch,
        },
        this.chunkMaster,
      );

      // Clamp persisted Y above terrain in case I had some bugs before and I walked trough wall
      this.chunkMaster.updateChunksAroundPos(row.x, row.z);
      const minY = this.chunkMaster.getMinYForCylinder(row.x, row.z, PLAYER_RADIUS);
      if (player.state.y - PLAYER_HEIGHT < minY) {
        player.state.y = minY + PLAYER_HEIGHT;
      }

      this.players.set(row.id, player);
    }
  }

  /** Adds a new player at the spawn position if they aren't already tracked. */
  join(playerId: string, name: string): void {
    if (!this.players.has(playerId)) {
      this.players.set(playerId, new Player({ id: playerId, name, ...SPAWN_POSITION }, this.chunkMaster));
      this.dirty.add(playerId);
    }
  }

  /** Clears the departing player's input queue; their state remains for persistence. */
  leave(playerId: string): void {
    this.inputQueues.delete(playerId);
  }

  /**
   * Appends inputs to a player's queue, capped at `MAX_QUEUED_INPUTS` to
   * bound memory usage and prevent lag exploitation.
   */
  queueInputs(playerId: string, inputs: PlayerInput[]): void {
    const queue = this.inputQueues.get(playerId);
    const remaining = MAX_QUEUED_INPUTS - (queue?.length ?? 0);
    if (remaining <= 0) return;
    const toAdd = inputs.slice(0, remaining);
    if (queue) {
      queue.push(...toAdd);
    } else {
      this.inputQueues.set(playerId, [...toAdd]);
    }
  }

  /**
   * Drains all input queues, steps each player, increments ack counters, and
   * marks changed players as dirty. Returns `true` if any player moved.
   */
  tick(): boolean {
    let changed = false;
    for (const [id, queue] of this.inputQueues) {
      if (queue.length === 0) continue;
      const player = this.players.get(id);
      if (!player) continue;
      this.chunkMaster.updateChunksAroundPos(player.state.x, player.state.z);
      const prev = { ...player.state };
      for (const input of queue) {
        player.step(input);
      }
      // console.log(`ticking player ${id} at y=${player.state.y}, queue=${queue.length}`);
      this.acks.set(id, (this.acks.get(id) ?? 0) + queue.length);
      queue.length = 0;
      if (Object.keys(prev).some((k) => prev[k as keyof typeof prev] !== player.state[k as keyof typeof prev])) {
        this.dirty.add(id);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Returns a state snapshot of all players. When `visiblePlayerIds` is
   * provided, only those players are included (used to hide offline players).
   */
  snapshot(visiblePlayerIds?: ReadonlySet<string>): Record<string, PlayerState> {
    const result: Record<string, PlayerState> = {};
    for (const [id, player] of this.players) {
      if (visiblePlayerIds && !visiblePlayerIds.has(id)) continue;
      result[id] = player.state;
    }
    return result;
  }

  /**
   * Returns per-player ack counters, optionally filtered to online players.
   * The client uses these to trim its input history.
   */
  getAcks(visiblePlayerIds?: ReadonlySet<string>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id] of this.players) {
      if (visiblePlayerIds && !visiblePlayerIds.has(id)) continue;
      result[id] = this.acks.get(id) ?? 0;
    }
    return result;
  }

  /** Returns `true` if any player has unsaved changes. */
  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /** UPSERTs all dirty players to SQLite and clears the dirty set. */
  flush(db: DrizzleSqliteDODatabase<typeof schema>): void {
    for (const id of this.dirty) {
      const player = this.players.get(id);
      if (player) {
        db.insert(playerSchema.players)
          .values(player.state)
          .onConflictDoUpdate({
            target: playerSchema.players.id,
            set: {
              name: player.state.name,
              x: player.state.x,
              y: player.state.y,
              z: player.state.z,
              yaw: player.state.yaw,
              pitch: player.state.pitch,
            },
          })
          .run();
      } else {
        db.delete(playerSchema.players).where(eq(playerSchema.players.id, id)).run();
      }
    }
    this.dirty.clear();
  }
}
