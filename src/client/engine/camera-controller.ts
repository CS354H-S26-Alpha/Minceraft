import { type Mat4, Vec3 } from "gl-matrix";
import { Camera } from "@/lib/webglutils/Camera";
import type { WalkKeys } from "./input";

const ROTATION_SPEED = 0.01;
const MAX_PITCH = Math.PI / 2 - 0.01;

export interface CameraOptions {
  width: number;
  height: number;
  fov?: number;
  zNear?: number;
  zFar?: number;
  eye?: Vec3;
  target?: Vec3;
}

/**
 * First-person camera built on top of the vendor `Camera` class. Tracks yaw
 * and pitch from pointer-lock mouse input, and converts WASD/Space/Shift key
 * states into a world-space walk vector.
 */
export class CameraController {
  private camera: Camera;
  private readonly opts: Required<CameraOptions>;

  constructor(opts: CameraOptions) {
    this.opts = {
      fov: 45,
      zNear: 0.1,
      zFar: 1000,
      eye: new Vec3([0, 70, 20]),
      target: new Vec3([0, 70, 19]),
      ...opts,
    };
    this.camera = this.createCamera();
  }

  /** Resets the camera to its initial position and orientation. */
  reset(): void {
    this.camera = this.createCamera();
  }

  /** Updates the projection matrix when the canvas is resized. */
  resize(width: number, height: number): void {
    this.opts.width = width;
    this.opts.height = height;
    this.camera.setAspect(width / height);
  }

  /**
   * Rotates the camera by a mouse delta. Yaw is unbounded; pitch is clamped
   * to ±90° to prevent gimbal flip.
   */
  rotate(mouseDx: number, mouseDy: number): void {
    if (mouseDx === 0 && mouseDy === 0) return;
    this.camera.rotate(new Vec3([0, 1, 0]), -ROTATION_SPEED * mouseDx);

    const lookDir = this.camera.forward().negate();
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, lookDir.y)));
    const nextPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, currentPitch - ROTATION_SPEED * mouseDy));
    const pitchDelta = nextPitch - currentPitch;
    if (pitchDelta !== 0) {
      this.camera.rotate(this.camera.right(), pitchDelta);
    }
  }

  /** Convert movement flags into a world-space walk vector using camera basis. */
  walkDir(keys: Readonly<WalkKeys>): Vec3 {
    const out = new Vec3();
    if (keys.w) out.add(this.camera.forward().negate());
    if (keys.a) out.add(this.camera.right().negate());
    if (keys.s) out.add(this.camera.forward());
    if (keys.d) out.add(this.camera.right());
    if (keys.space) out.add(new Vec3([0, 1, 0]));
    if (keys.shift) out.add(new Vec3([0, -1, 0]));
    return out;
  }

  /** Returns the current camera yaw in radians (atan2 of the look direction). */
  yaw(): number {
    const lookDir = this.camera.forward().negate();
    return Math.atan2(lookDir.x, -lookDir.z);
  }

  /** Returns the current camera pitch in radians (asin of the look direction). */
  pitch(): number {
    const lookDir = this.camera.forward().negate();
    return Math.asin(Math.max(-1, Math.min(1, lookDir.y)));
  }

  /**
   * Rebuilds the camera to match an exact yaw/pitch. Used to sync orientation
   * from a server-authoritative reconciliation.
   */
  setOrientation(yaw: number, pitch: number): void {
    const eye = this.camera.pos();
    const cp = Math.cos(pitch);
    const lookDir = new Vec3([cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw)]);
    const target = Vec3.clone(eye).add(lookDir);
    this.camera = new Camera(
      eye,
      target,
      new Vec3([0, 1, 0]),
      this.opts.fov,
      this.opts.width / this.opts.height,
      this.opts.zNear,
      this.opts.zFar,
    );
  }

  /** Moves the camera eye to `pos` without changing the look direction. */
  setPosition(pos: Vec3): void {
    this.camera.setPos(pos);
  }

  /** Returns the current view matrix. */
  viewMatrix(): Mat4 {
    return this.camera.viewMatrix();
  }

  /** Returns the current projection matrix. */
  projMatrix(): Mat4 {
    return this.camera.projMatrix();
  }

  private createCamera(): Camera {
    const { eye, target, fov, width, height, zNear, zFar } = this.opts;
    return new Camera(Vec3.clone(eye), Vec3.clone(target), new Vec3([0, 1, 0]), fov, width / height, zNear, zFar);
  }
}
