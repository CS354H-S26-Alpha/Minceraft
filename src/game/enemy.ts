import { Entity } from "./entity";

export const ENEMY_MAX_HEALTH = 6;
export const ENEMY_HIT_RADIUS = 0.5;
export const ENEMY_HEIGHT = 3.0;
export const ENEMY_HALF_HEIGHT = ENEMY_HEIGHT / 2;

export interface EnemyPublicState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
}

export interface EnemyState extends EnemyPublicState {
  wanderTimer: number;
  attackCooldownMs: number;
}

export function createEnemyState(args: EnemyPublicState & { wanderTimer?: number; attackCooldownMs?: number }): EnemyState {
  return {
    ...args,
    health: normalizeHealth(args.health),
    wanderTimer: normalizeMilliseconds(args.wanderTimer),
    attackCooldownMs: normalizeMilliseconds(args.attackCooldownMs),
  };
}

export function cloneEnemyState(state: EnemyState): EnemyState {
  return { ...state };
}

export function toPublicEnemyState(state: EnemyState): EnemyPublicState {
  const { wanderTimer: _wanderTimer, attackCooldownMs: _attackCooldownMs, ...publicState } = state;
  return publicState;
}

export class Enemy extends Entity<EnemyState, never> {
  get id() {
    return this.state.id;
  }

  takeDamage(amount: number): boolean {
    if (!Number.isFinite(amount)) return false;
    const damage = Math.max(0, Math.trunc(amount));
    if (damage <= 0 || this.state.health <= 0) return false;
    const nextHealth = Math.max(0, this.state.health - damage);
    if (nextHealth === this.state.health) return false;
    this.state.health = nextHealth;
    return true;
  }

  publicState(): EnemyPublicState {
    return toPublicEnemyState(this.state);
  }

  step(_: never): void {}
}

function normalizeHealth(health: number): number {
  if (!Number.isFinite(health)) return ENEMY_MAX_HEALTH;
  return Math.max(0, Math.min(ENEMY_MAX_HEALTH, Math.trunc(health)));
}

function normalizeMilliseconds(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
