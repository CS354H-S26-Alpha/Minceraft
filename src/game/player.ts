import { Vec3 } from "gl-matrix";
import type { ChunkMaster } from "./chunk-master";
import { Entity } from "./entity";

export const PLAYER_SPEED = 10;
const MAX_DT_SECONDS = 2;
const MAX_COORDINATE = 100_000;

const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 2.0;
const GRAVITY = -15;
const JUMP_SPEED = 10;
const MICROSTEPS = 20;

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

export class Player extends Entity<PlayerState, PlayerInput> {
  private chunkMaster?: ChunkMaster;
  private vy: number = 0;
  private grounded: boolean = false;

  constructor(state: PlayerState, chunkMaster?: ChunkMaster) {
    super(state);
    this.chunkMaster = chunkMaster;
  }

  get id() {
    return this.state.id;
  }

  get position(): Vec3 {
    return new Vec3([this.state.x, this.state.y, this.state.z]);
  }

  step({ dx, dy, dz, dtSeconds, yaw, pitch }: PlayerInput) {
    // this.chunkMaster?.updateChunksAroundPos(this.state.x, this.state.z);
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

    const cm = this.chunkMaster;

    // horizontal
    const horizMag2 = dx * dx + dz * dz;
    if (horizMag2 > 0) {
      const inv = (PLAYER_SPEED * dtSeconds) / Math.sqrt(horizMag2);
      const totalDX = dx * inv;
      const totalDZ = dz * inv;

      if (cm) {
        const stepDX = totalDX / MICROSTEPS;
        const stepDZ = totalDZ / MICROSTEPS;
        const feetY = this.state.y - PLAYER_HEIGHT;

        for (let i = 0; i < MICROSTEPS; i++) {
          const candidateX = this.state.x + stepDX;
          const candidateZ = this.state.z + stepDZ;

          if (cm.isCylinderClear(candidateX, candidateZ, feetY, PLAYER_HEIGHT, PLAYER_RADIUS)) {
            this.state.x = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, candidateX));
            this.state.z = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, candidateZ));
          } else {
            // Hit a wall
            break;
          }
        }
      } else {
        this.state.x = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.x + totalDX));
        this.state.z = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.z + totalDZ));
      }
    }

    // vertical
    if (cm) {
      if (dy > 0 && this.grounded) {
        this.vy = JUMP_SPEED;
        this.grounded = false;
      }

      this.vy += GRAVITY * dtSeconds;
      const totalDY = this.vy * dtSeconds;

      const VERT_STEPS = 30;
      const stepDY = totalDY / VERT_STEPS;

      for (let i = 0; i < VERT_STEPS; i++) {
        const candidateFeetY = this.state.y - PLAYER_HEIGHT + stepDY;
        const candidateY = this.state.y + stepDY;

        if (cm.isCylinderClear(this.state.x, this.state.z, candidateFeetY, PLAYER_HEIGHT, PLAYER_RADIUS)) {
          this.state.y = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, candidateY));
        } else {
          if (stepDY < 0) {
            // Moving downward and hit something, ground
            const groundY = cm.getMinYForCylinder(this.state.x, this.state.z, PLAYER_RADIUS);
            this.state.y = groundY + PLAYER_HEIGHT;
            this.vy = 0;
            this.grounded = true;
          } else {
            // Moving upward and hit a ceiling
            this.vy = 0;
          }
          break;
        }
      }

      // Final ground snap
      const groundY = cm.getMinYForCylinder(this.state.x, this.state.z, PLAYER_RADIUS);
      if (this.state.y - PLAYER_HEIGHT <= groundY) {
        this.state.y = groundY + PLAYER_HEIGHT;
        this.vy = 0;
        this.grounded = true;
      } else if (this.state.y - PLAYER_HEIGHT > groundY + 0.01) {
        this.grounded = false;
      }
    } else {
      const mag2 = dx * dx + dy * dy + dz * dz;
      if (mag2 > 0) {
        const inv = (PLAYER_SPEED * dtSeconds) / Math.sqrt(mag2);
        this.state.y = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.y + dy * inv));
      }
    }
  }
}
