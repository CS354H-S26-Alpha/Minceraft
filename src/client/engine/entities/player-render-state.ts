import { PLAYER_EYE_OFFSET, PLAYER_SPEED, type PlayerPublicState } from "@/game/player";
import { lerp, lerpAngle } from "@/utils/interpolations";
import type { GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";

const TICK_SECONDS = 0.05;
const MAX_ANIMATED_WALK_SPEED = PLAYER_SPEED * 1.35;

export interface PlayerRenderState extends PlayerPublicState {
  walkSpeed: number;
  phaseOffset: number;
}

export function interpolatePlayerRenderState(
  prev: PlayerPublicState,
  curr: PlayerPublicState,
  t: number,
): PlayerRenderState {
  return {
    id: curr.id,
    name: curr.name,
    x: lerp(prev.x, curr.x, t),
    y: lerp(prev.y, curr.y, t),
    z: lerp(prev.z, curr.z, t),
    yaw: lerpAngle(prev.yaw, curr.yaw, t),
    pitch: lerp(prev.pitch, curr.pitch, t),
    walkSpeed: Math.min(Math.hypot(curr.x - prev.x, curr.z - prev.z) / TICK_SECONDS, MAX_ANIMATED_WALK_SPEED),
    phaseOffset: hashToPhase(curr.id),
  };
}

export function packPlayerRenderStates(players: PlayerRenderState[], buffers: GpuBuffers): number {
  const count = players.length;
  const positions = ensureBuffer(buffers, "aOffset", count * 4);
  const pitches = ensureBuffer(buffers, "aPitch", count);
  const motion = ensureBuffer(buffers, "aMotion", count * 2);
  for (let i = 0; i < count; i++) {
    const p = players[i];
    if (!p) continue;
    positions[i * 4] = p.x;
    // Player state is tracked at eye height; the mesh is authored from the feet up.
    positions[i * 4 + 1] = p.y - PLAYER_EYE_OFFSET;
    positions[i * 4 + 2] = p.z;
    positions[i * 4 + 3] = p.yaw;
    pitches[i] = p.pitch;
    motion[i * 2] = p.walkSpeed;
    motion[i * 2 + 1] = p.phaseOffset;
  }
  return count;
}

function hashToPhase(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}
