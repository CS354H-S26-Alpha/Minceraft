import { Vec3 } from "gl-matrix";
import { Entity } from "./entity";

export const PLAYER_SPEED = 0.3;

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PlayerInput {
  dx: number;
  dy: number;
  dz: number;
  yaw: number;
  pitch: number;
}

export class Player extends Entity<PlayerState, PlayerInput> {
  get id() {
    return this.state.id;
  }

  get position(): Vec3 {
    return new Vec3([this.state.x, this.state.y, this.state.z]);
  }

  step({ dx, dy, dz, yaw, pitch }: PlayerInput) {
    this.state.yaw = yaw;
    this.state.pitch = pitch;
    const mag2 = dx * dx + dy * dy + dz * dz;
    if (mag2 === 0) return;
    const inv = PLAYER_SPEED / Math.sqrt(mag2);
    this.state.x += dx * inv;
    this.state.y += dy * inv;
    this.state.z += dz * inv;
  }
}

export function playerDistanceSq(a: PlayerState, b: PlayerState): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
