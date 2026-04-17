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
  const baseWalkSpeed = Math.min(Math.hypot(curr.x - prev.x, curr.z - prev.z) / TICK_SECONDS, MAX_ANIMATED_WALK_SPEED);
  // Remote players should stop animating once we've fully reached the latest snapshot.
  const walkSpeed = t < 1 ? baseWalkSpeed : 0;
  return {
    id: curr.id,
    name: curr.name,
    x: lerp(prev.x, curr.x, t),
    y: lerp(prev.y, curr.y, t),
    z: lerp(prev.z, curr.z, t),
    yaw: lerpAngle(prev.yaw, curr.yaw, t),
    pitch: lerp(prev.pitch, curr.pitch, t),
    walkSpeed,
    phaseOffset: hashToPhase(curr.id),
  };
}

export function packPlayerRenderStates(players: PlayerRenderState[], buffers: GpuBuffers): number {
  const count = players.length;
  const positions = ensureBuffer(buffers, "aOffset", count * 4);
  const pitches = ensureBuffer(buffers, "aPitch", count);
  const motion = ensureBuffer(buffers, "aMotion", count * 2);
  const shirtColors = ensureBuffer(buffers, "aShirtColor", count * 3);
  for (let i = 0; i < count; i++) {
    const p = players[i];
    if (!p) continue;
    const [shirtR, shirtG, shirtB] = shirtColorFromName(p.name);
    positions[i * 4] = p.x;
    // Player state is tracked at eye height; the mesh is authored from the feet up.
    positions[i * 4 + 1] = p.y - PLAYER_EYE_OFFSET;
    positions[i * 4 + 2] = p.z;
    positions[i * 4 + 3] = p.yaw;
    pitches[i] = p.pitch;
    motion[i * 2] = p.walkSpeed;
    motion[i * 2 + 1] = p.phaseOffset;
    shirtColors[i * 3] = shirtR;
    shirtColors[i * 3 + 1] = shirtG;
    shirtColors[i * 3 + 2] = shirtB;
  }
  return count;
}

export function shirtColorFromName(name: string): [number, number, number] {
  const hash = hashString32(name.trim() || "player");
  const hue = ((hash >>> 0) & 0xffff) / 0xffff;
  const saturation = 0.55 + (((hash >>> 16) & 0xff) / 255) * 0.22;
  const lightness = 0.42 + (((hash >>> 24) & 0xff) / 255) * 0.14;
  return hslToRgb(hue, saturation, lightness);
}

function hashToPhase(value: string): number {
  return ((hashString32(value) >>> 0) / 0xffffffff) * Math.PI * 2;
}

function hashString32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation <= 0) {
    return [lightness, lightness, lightness];
  }

  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [hueChannel(p, q, hue + 1 / 3), hueChannel(p, q, hue), hueChannel(p, q, hue - 1 / 3)];
}

function hueChannel(p: number, q: number, t: number): number {
  let wrapped = t;
  if (wrapped < 0) wrapped += 1;
  if (wrapped > 1) wrapped -= 1;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
}
