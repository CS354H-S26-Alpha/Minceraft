import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type * as schema from "../server/schema";
import type { GameSystem, SystemContext } from "./game-system";
import { Enemy, createEnemyState, type EnemyPublicState } from "./enemy";
import type { ServerPacket } from "./protocol";

const DEFAULT_ENEMY_LAYOUT = [
  { id: "enemy-1", x: 6, y: 70, z: 14, yaw: Math.PI, health: 6 },
  { id: "enemy-2", x: -8, y: 70, z: 18, yaw: Math.PI / 2, health: 6 },
  { id: "enemy-3", x: 4, y: 70, z: 28, yaw: -Math.PI / 2, health: 6 },
] as const satisfies readonly EnemyPublicState[];

/**
 * Server-authoritative enemy state.
 *
 * This first pass keeps enemies static and non-persistent so the room can
 * broadcast a stable authoritative enemy snapshot before movement / combat are
 * layered in.
 */
export class EnemySystem implements GameSystem {
  readonly key = "enemies";

  private enemies = new Map<string, Enemy>();

  hydrate(_db: DrizzleSqliteDODatabase<typeof schema>): void {
    this.ensureSeedEnemies();
  }

  tick(): boolean {
    return false;
  }

  packetsFor(_playerId: string, _ctx: SystemContext): ServerPacket[] {
    return [
      {
        type: "enemies",
        enemies: this.publicStates(),
      },
    ];
  }

  clearPending(): void {}

  hasDirty(): boolean {
    return false;
  }

  flush(_db: DrizzleSqliteDODatabase<typeof schema>): void {}

  private ensureSeedEnemies(): void {
    if (this.enemies.size > 0) return;
    for (const enemy of DEFAULT_ENEMY_LAYOUT) {
      this.enemies.set(enemy.id, new Enemy(createEnemyState(enemy)));
    }
  }

  private publicStates(): Record<string, EnemyPublicState> {
    const result: Record<string, EnemyPublicState> = {};
    for (const [id, enemy] of this.enemies) {
      result[id] = enemy.publicState();
    }
    return result;
  }
}
