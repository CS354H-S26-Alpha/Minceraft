import { getLookDirection } from "../utils/look-direction";

export interface ForceVector {
  x: number;
  y: number;
  z: number;
}

export interface KnockbackSource {
  x: number;
  z: number;
  yaw: number;
}

export interface KnockbackTarget {
  x: number;
  z: number;
}

export const MELEE_KNOCKBACK_HORIZONTAL_SPEED = 6;
export const MELEE_KNOCKBACK_VERTICAL_SPEED = 4;

export function createForceVector(x = 0, y = 0, z = 0): ForceVector {
  return { x, y, z };
}

export function isForceVector(value: ForceVector): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function computeMeleeKnockback(source: KnockbackSource, target: KnockbackTarget): ForceVector {
  let dx = target.x - source.x;
  let dz = target.z - source.z;
  const magnitude = Math.hypot(dx, dz);
  if (magnitude > 1e-6) {
    dx /= magnitude;
    dz /= magnitude;
  } else {
    const look = getLookDirection(source.yaw, 0);
    const lookMagnitude = Math.hypot(look.x, look.z) || 1;
    dx = look.x / lookMagnitude;
    dz = look.z / lookMagnitude;
  }

  return {
    x: dx * MELEE_KNOCKBACK_HORIZONTAL_SPEED,
    y: MELEE_KNOCKBACK_VERTICAL_SPEED,
    z: dz * MELEE_KNOCKBACK_HORIZONTAL_SPEED,
  };
}
