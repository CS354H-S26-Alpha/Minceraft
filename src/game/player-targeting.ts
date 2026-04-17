import { getLookDirection } from "../utils/look-direction";
import { getPlayerEyePosition, Player, type PlayerPublicState, type PlayerState } from "./player";

const RAY_EPSILON = 1e-6;
export const MELEE_RANGE = 3;

type AimState = Pick<PlayerState, "x" | "y" | "z" | "yaw" | "pitch">;
type TargetCandidate = Pick<PlayerPublicState, "id" | "x" | "y" | "z">;

export function findTargetedPlayerId(
  attacker: AimState,
  candidates: Iterable<TargetCandidate>,
  maxDistance = MELEE_RANGE,
): string | undefined {
  const origin = getPlayerEyePosition(attacker);
  const direction = getLookDirection(attacker.yaw, attacker.pitch);
  let nearestDistance = maxDistance;
  let nearestTargetId: string | undefined;

  for (const candidate of candidates) {
    const hitDistance = intersectRayWithPlayerBounds(origin, direction, candidate, maxDistance);
    if (hitDistance === undefined || hitDistance > nearestDistance) continue;

    nearestDistance = hitDistance;
    nearestTargetId = candidate.id;
  }

  return nearestTargetId;
}

export function canTargetPlayer(
  attacker: AimState,
  target: Pick<PlayerPublicState, "x" | "y" | "z">,
  maxDistance = MELEE_RANGE,
) {
  const origin = getPlayerEyePosition(attacker);
  const direction = getLookDirection(attacker.yaw, attacker.pitch);
  return intersectRayWithPlayerBounds(origin, direction, target, maxDistance) !== undefined;
}

function intersectRayWithPlayerBounds(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  target: Pick<PlayerPublicState, "x" | "y" | "z">,
  maxDistance: number,
): number | undefined {
  return intersectRayWithAabb(
    origin,
    direction,
    {
      minX: target.x - Player.CYLINDER_RADIUS,
      maxX: target.x + Player.CYLINDER_RADIUS,
      minY: target.y,
      maxY: target.y + Player.CYLINDER_HEIGHT,
      minZ: target.z - Player.CYLINDER_RADIUS,
      maxZ: target.z + Player.CYLINDER_RADIUS,
    },
    maxDistance,
  );
}

function intersectRayWithAabb(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  },
  maxDistance: number,
): number | undefined {
  let entry = 0;
  let exit = maxDistance;

  const xHit = intersectAxis(origin.x, direction.x, bounds.minX, bounds.maxX);
  if (!xHit) return undefined;
  entry = Math.max(entry, xHit.entry);
  exit = Math.min(exit, xHit.exit);

  const yHit = intersectAxis(origin.y, direction.y, bounds.minY, bounds.maxY);
  if (!yHit) return undefined;
  entry = Math.max(entry, yHit.entry);
  exit = Math.min(exit, yHit.exit);

  const zHit = intersectAxis(origin.z, direction.z, bounds.minZ, bounds.maxZ);
  if (!zHit) return undefined;
  entry = Math.max(entry, zHit.entry);
  exit = Math.min(exit, zHit.exit);

  if (entry > exit || exit < 0 || entry > maxDistance) return undefined;
  return Math.max(0, entry);
}

function intersectAxis(origin: number, direction: number, min: number, max: number) {
  if (Math.abs(direction) < RAY_EPSILON) {
    if (origin < min || origin > max) return undefined;
    return { entry: -Infinity, exit: Infinity };
  }

  let entry = (min - origin) / direction;
  let exit = (max - origin) / direction;
  if (entry > exit) {
    const swap = entry;
    entry = exit;
    exit = swap;
  }

  return { entry, exit };
}
