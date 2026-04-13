import { Vec3 } from "gl-matrix";
import { Entity } from "./entity";

export const PLAYER_SPEED = 30;
const MAX_DT_SECONDS = 2;
const MAX_COORDINATE = 100_000;

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
  dtSeconds: number;
  yaw: number;
  pitch: number;
}

/** Server/client-shared player entity. The same class runs on both sides. */
export class Player extends Entity<PlayerState, PlayerInput> {
  /** Unique player identifier (alias for `state.id`). */
  get id() {
    return this.state.id;
  }

  /** Current world-space position as a Vec3. */
  get position(): Vec3 {
    return new Vec3([this.state.x, this.state.y, this.state.z]);
  }

  /**
   * Applies one input frame: validates the input, normalises the movement
   * vector to a constant speed, and clamps coordinates within world bounds.
   * TODO: Handle sending new snapshot to client when movement on server is unexpected.
   */
  step({ dx, dy, dz, dtSeconds, yaw, pitch }: PlayerInput) {
    if (
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      !Number.isFinite(dz) ||
      !Number.isFinite(dtSeconds) ||
      !Number.isFinite(yaw) ||
      !Number.isFinite(pitch) ||
      dtSeconds <= 0 ||
      dtSeconds > MAX_DT_SECONDS
    )
      return;

    this.state.yaw = yaw;
    this.state.pitch = pitch;
    const mag2 = dx * dx + dy * dy + dz * dz;
    if (mag2 === 0) return;
    const inv = (PLAYER_SPEED * dtSeconds) / Math.sqrt(mag2);
    this.state.x = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.x + dx * inv));
    this.state.y = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.y + dy * inv));
    this.state.z = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.z + dz * inv));
  }
}
