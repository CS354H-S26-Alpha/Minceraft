import { Entity } from "./entity";

export const ENEMY_MAX_HEALTH = 6;

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
