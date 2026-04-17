import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type * as schema from "../server/schema";
import { sampleColumn } from "./biome";
import { createEnemyState, Enemy, type EnemyPublicState } from "./enemy";
import type { GameSystem, SystemContext } from "./game-system";
import { getHeldItemDamage, type Player, type PlayerPublicState } from "./player";
import { canTargetEnemy } from "./player-targeting";
import type { ServerPacket } from "./protocol";

const WORLD_SEED = 123;
const TICK_SECONDS = 0.05;
const WALK_SPEED = 2.0;
const MIN_SEEK_DISTANCE = 1.5;
const ENEMY_ATTACK_RANGE = 1.75;
const ENEMY_ATTACK_DAMAGE = 1;
const ENEMY_ATTACK_COOLDOWN_MS = 750;
const ENEMY_RESPAWN_DELAY_S = 5;
const MAX_STEP_UP = 1;
const WANDER_MIN_S = 1.0;
const WANDER_MAX_S = 2.5;

const DEFAULT_ENEMY_LAYOUT = [
  { id: "enemy-1", x: 6, y: 70, z: 14, yaw: Math.PI, health: 6 },
  { id: "enemy-2", x: -8, y: 70, z: 18, yaw: Math.PI / 2, health: 6 },
  { id: "enemy-3", x: 4, y: 70, z: 28, yaw: -Math.PI / 2, health: 6 },
] as const satisfies readonly EnemyPublicState[];

const ENEMY_LAYOUT_BY_ID = Object.fromEntries(DEFAULT_ENEMY_LAYOUT.map((enemy) => [enemy.id, enemy])) as Record<
  string,
  (typeof DEFAULT_ENEMY_LAYOUT)[number]
>;

/**
 * Server-authoritative enemy state.
 *
 * This first pass keeps enemies static and non-persistent so the room can
 * broadcast a stable authoritative enemy snapshot before combat is layered in.
 */
export class EnemySystem implements GameSystem {
  readonly key = "enemies";

  private enemies = new Map<string, Enemy>();
  private respawnTimers = new Map<string, number>();

  constructor(
    private readonly getOnlinePlayers: () => readonly PlayerPublicState[],
    private readonly damagePlayer: (playerId: string, amount: number) => boolean,
  ) {}

  hydrate(_db: DrizzleSqliteDODatabase<typeof schema>): void {
    this.ensureSeedEnemies();
  }

  tick(): boolean {
    let changed = false;
    const onlinePlayers = this.getOnlinePlayers();
    for (const enemy of this.enemies.values()) {
      if (this.updateEnemy(enemy, onlinePlayers)) changed = true;
    }
    if (this.tickRespawns()) changed = true;
    return changed;
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
      this.enemies.set(
        enemy.id,
        new Enemy(
          createEnemyState({
            ...enemy,
            y: sampleSurfaceY(enemy.x, enemy.z),
          }),
        ),
      );
    }
  }

  private publicStates(): Record<string, EnemyPublicState> {
    const result: Record<string, EnemyPublicState> = {};
    for (const [id, enemy] of this.enemies) {
      result[id] = enemy.publicState();
    }
    return result;
  }

  attack(
    attacker: Player,
    packet: { targetEnemyId?: string; x: number; y: number; z: number; yaw: number; pitch: number },
  ): boolean {
    const targetEnemyId = packet.targetEnemyId;
    if (!targetEnemyId) return false;
    const enemy = this.enemies.get(targetEnemyId);
    if (!enemy || enemy.state.health <= 0) return false;
    if (!canTargetEnemy(packet, enemy.state)) return false;
    if (!enemy.takeDamage(getHeldItemDamage(attacker.state))) return false;
    if (enemy.state.health <= 0) {
      this.enemies.delete(targetEnemyId);
      this.respawnTimers.set(targetEnemyId, ENEMY_RESPAWN_DELAY_S);
    }
    return true;
  }

  private updateEnemy(enemy: Enemy, onlinePlayers: readonly PlayerPublicState[]): boolean {
    const prevX = enemy.state.x;
    const prevY = enemy.state.y;
    const prevZ = enemy.state.z;
    const prevYaw = enemy.state.yaw;

    if (enemy.state.wanderTimer > 0) {
      enemy.state.wanderTimer = Math.max(0, enemy.state.wanderTimer - TICK_SECONDS);
    }
    if (enemy.state.attackCooldownMs > 0) {
      enemy.state.attackCooldownMs = Math.max(0, enemy.state.attackCooldownMs - Math.round(TICK_SECONDS * 1000));
    }

    const target = nearestPlayer(enemy.state.x, enemy.state.z, onlinePlayers);
    const wandering = enemy.state.wanderTimer > 0;

    if (target) {
      const toPlayerX = target.x - enemy.state.x;
      const toPlayerZ = target.z - enemy.state.z;
      const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);
      if (!wandering && distToPlayer > MIN_SEEK_DISTANCE) {
        enemy.state.yaw = Math.atan2(-toPlayerX, -toPlayerZ);
      }
    } else if (!wandering) {
      enemy.state.wanderTimer = randomWanderDuration();
      enemy.state.yaw = Math.random() * Math.PI * 2;
    }

    const fwdX = -Math.sin(enemy.state.yaw);
    const fwdZ = -Math.cos(enemy.state.yaw);
    const targetDistance = target ? distanceTo(enemy.state.x, enemy.state.z, target.x, target.z) : Infinity;
    const shouldMove = target ? targetDistance > MIN_SEEK_DISTANCE : true;
    const stepX = shouldMove ? fwdX * WALK_SPEED * TICK_SECONDS : 0;
    const stepZ = shouldMove ? fwdZ * WALK_SPEED * TICK_SECONDS : 0;

    const curY = sampleSurfaceY(enemy.state.x, enemy.state.z);
    const nextY = sampleSurfaceY(enemy.state.x + stepX, enemy.state.z + stepZ);

    if (!shouldMove || nextY - curY <= MAX_STEP_UP) {
      enemy.state.x += stepX;
      enemy.state.z += stepZ;
      enemy.state.y = nextY;
    } else {
      enemy.state.y = curY;
      enemy.state.wanderTimer = randomWanderDuration();
      enemy.state.yaw += (Math.random() < 0.5 ? -1 : 1) * (Math.PI * 0.5 + Math.random() * Math.PI * 0.5);
    }

    let attacked = false;
    if (target && targetDistance <= ENEMY_ATTACK_RANGE && enemy.state.attackCooldownMs <= 0) {
      attacked = this.damagePlayer(target.id, ENEMY_ATTACK_DAMAGE);
      if (attacked) {
        enemy.state.attackCooldownMs = ENEMY_ATTACK_COOLDOWN_MS;
      }
    }

    return (
      attacked ||
      enemy.state.x !== prevX ||
      enemy.state.y !== prevY ||
      enemy.state.z !== prevZ ||
      enemy.state.yaw !== prevYaw
    );
  }

  private tickRespawns(): boolean {
    let changed = false;
    for (const [enemyId, remainingS] of [...this.respawnTimers]) {
      const nextRemainingS = remainingS - TICK_SECONDS;
      if (nextRemainingS > 0) {
        this.respawnTimers.set(enemyId, nextRemainingS);
        continue;
      }

      this.respawnTimers.delete(enemyId);
      const layout = ENEMY_LAYOUT_BY_ID[enemyId];
      if (!layout || this.enemies.has(enemyId)) continue;
      this.enemies.set(
        enemyId,
        new Enemy(
          createEnemyState({
            ...layout,
            y: sampleSurfaceY(layout.x, layout.z),
          }),
        ),
      );
      changed = true;
    }
    return changed;
  }
}

function sampleSurfaceY(x: number, z: number): number {
  const { height } = sampleColumn(WORLD_SEED, Math.round(x), Math.round(z));
  return height;
}

function nearestPlayer(x: number, z: number, players: readonly PlayerPublicState[]): PlayerPublicState | undefined {
  let nearest: PlayerPublicState | undefined;
  let nearestDistance = Infinity;
  for (const player of players) {
    const distance = distanceTo(x, z, player.x, player.z);
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearest = player;
  }
  return nearest;
}

function distanceTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

function randomWanderDuration(): number {
  return WANDER_MIN_S + Math.random() * (WANDER_MAX_S - WANDER_MIN_S);
}
