import type { Mat4 } from "gl-matrix";
import robotDaeUrl from "@/assets/models/robot.dae?url";
import type { EnemyDrawState } from "../render/enemy-pass";
import { CLoader } from "../skinning/AnimationFileLoader";
import { Quat } from "../skinning/lib/TSM";
import type { Mesh } from "../skinning/Mesh";

/** Single-enemy runtime state. */
export interface EnemyState {
  x: number;
  y: number;
  z: number;
  /** Facing direction in radians (around Y). 0 = natural mesh facing. */
  yaw: number;
  /** Walk cycle progress in [0, 1). */
  phase: number;
  /**
   * Seconds remaining in "wander" mode. > 0 means the enemy is walking in a
   * random direction chosen when it last got stuck, instead of seeking the
   * player.
   */
  wanderTimer: number;
}

export interface EnemyFrameInputs {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  lightPosition: Float32Array;
  ambientColor: Float32Array;
  sunColor: Float32Array;
  /** Seconds elapsed since last frame. */
  dtSeconds: number;
  /** Player horizontal position; enemies steer toward this each frame. */
  playerX: number;
  playerZ: number;
  /** World-space surface sampler; used to snap enemies to the ground. */
  sampleSurface: (x: number, z: number) => number | undefined;
}

/**
 * Hardcoded bone indices for `robot.dae`.
 */
const RIG = {
  root: 52,
  leftLeg: 44,
  rightLeg: 48,
  leftArm: 7,
  rightArm: 26,
} as const;

/** One walk-cycle keyframe: swing angles (radians) for the four limb bones. */
interface WalkPose {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
}

/**
 * Four-pose walk cycle. Arms swing opposite to legs on the same side.
 */
const WALK_KEYFRAMES: WalkPose[] = [
  { legL: +0.6, legR: -0.6, armL: -0.5, armR: +0.5 }, // contact A
  { legL: 0.0, legR: 0.0, armL: 0.0, armR: 0.0 }, //    passing A
  { legL: -0.6, legR: +0.6, armL: +0.5, armR: -0.5 }, // contact B
  { legL: 0.0, legR: 0.0, armL: 0.0, armR: 0.0 }, //    passing B
];

/** Complete walk cycles per second. */
const WALK_CYCLE_HZ = 1.2;
/** World-space walk speed (blocks per second). */
const WALK_SPEED = 2.0;
/** Within this distance of the player, the enemy stops advancing (avoids jitter). */
const MIN_SEEK_DISTANCE = 1.5;
/**
 * Distance (blocks) from the player at which a new enemy materializes.
 */
const SPAWN_MIN_OFFSET = 50;
const SPAWN_MAX_OFFSET = 350;
/** When an enemy hits a wall, it picks a random direction and walks that way
 * for a short while before trying to resume seeking the player. */
const WANDER_MIN_S = 1.0;
const WANDER_MAX_S = 2.5;
/** Max concurrent enemies the manager will keep alive. */
const MAX_ENEMIES = 5;
/** Seconds between periodic spawns, once under the cap. */
const SPAWN_INTERVAL_S = 10;
/** Seconds to wait after mesh load before the very first spawn. */
const INITIAL_SPAWN_DELAY_S = 3;

/**
 * Walks the mesh's rest-pose vertices and returns the distance from the
 * mesh origin down to its lowest point. Used to snap feet to the terrain.
 */
function computeFootOffset(mesh: Mesh): number {
  const pos = mesh.geometry.position.values;
  let minY = Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    const y = pos[i] ?? 0;
    if (y < minY) minY = y;
  }
  return Number.isFinite(minY) ? -minY : 0;
}

/** Build a unit quaternion for rotation `angle` radians around the X axis. */
function quatAroundX(angle: number): Quat {
  const half = angle * 0.5;
  return new Quat([Math.sin(half), 0, 0, Math.cos(half)]);
}

/** Build a unit quaternion for rotation `angle` radians around the Z axis. */
function quatAroundZ(angle: number): Quat {
  const half = angle * 0.5;
  return new Quat([0, 0, Math.sin(half), Math.cos(half)]);
}

/**
 * Base rest rotations that bring each arm from the authored T-pose (along
 * ±X) down to hang along -Y. 
 */
const REST_ARM_L = quatAroundZ(+Math.PI / 2); // -X → -Y
const REST_ARM_R = quatAroundZ(-Math.PI / 2); // +X → -Y

/**
 * Owns the enemy mesh lifecycle and per-frame draw-state generation.
 *
 * Each frame `frame()` advances the walk cycle, poses the skeleton, moves the
 * enemy forward, and produces `EnemyDrawState[]` for the Renderer.
 */
export class EnemyManager {
  private mesh: Mesh | undefined;
  private meshHandedOff = false;
  /** Distance from mesh origin down to its lowest vertex. Set on load. */
  private footOffset = 0;
  /** Seconds until the next periodic spawn fires. Ticked in `frame()`. */
  private spawnCooldown = INITIAL_SPAWN_DELAY_S;
  private readonly enemies: EnemyState[] = [];

  load(): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = new CLoader(robotDaeUrl);
      loader.load(() => {
        const mesh = loader.meshes[0] as Mesh | undefined;
        if (!mesh) {
          reject(new Error("robot.dae loaded but contained no skinned mesh"));
          return;
        }
        this.mesh = mesh;
        this.footOffset = computeFootOffset(mesh);
        resolve();
      });
    });
  }

  takePendingMesh(): Mesh | undefined {
    if (!this.mesh || this.meshHandedOff) return undefined;
    this.meshHandedOff = true;
    return this.mesh;
  }

  /**
   * Spawn one enemy at a random angle, somewhere between SPAWN_MIN_OFFSET
   * and SPAWN_MAX_OFFSET blocks from the given center. Phase is randomized
   * so multiple enemies don't walk in lockstep. Reusable for future respawn
   * logic — caller just re-invokes after a death/removal.
   */
  spawn(centerX: number, centerZ: number): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = SPAWN_MIN_OFFSET + Math.random() * (SPAWN_MAX_OFFSET - SPAWN_MIN_OFFSET);
    this.enemies.push({
      x: centerX + Math.cos(angle) * distance,
      y: 0,
      z: centerZ + Math.sin(angle) * distance,
      yaw: 0,
      phase: Math.random(),
      wanderTimer: 0,
    });
  }

  /**
   * Periodic-spawn driver. Ticks the cooldown only while below the cap, so
   * a removed enemy can be replaced promptly (the timer picks up where it
   * froze). Called once per frame with the player position as the center.
   */
  private tickSpawning(dtSeconds: number, playerX: number, playerZ: number): void {
    if (this.enemies.length >= MAX_ENEMIES) return; // at cap — freeze cooldown
    this.spawnCooldown -= dtSeconds;
    if (this.spawnCooldown > 0) return;
    this.spawn(playerX, playerZ);
    this.spawnCooldown = SPAWN_INTERVAL_S;
  }

  frame(inputs: EnemyFrameInputs): EnemyDrawState[] | undefined {
    if (!this.mesh || !this.meshHandedOff) return undefined;
    const mesh = this.mesh;

    this.tickSpawning(inputs.dtSeconds, inputs.playerX, inputs.playerZ);

    const states: EnemyDrawState[] = [];
    for (const enemy of this.enemies) {
      // --- 1. Advance walk phase + wander timer ---
      enemy.phase = (enemy.phase + WALK_CYCLE_HZ * inputs.dtSeconds) % 1;
      if (enemy.wanderTimer > 0) enemy.wanderTimer -= inputs.dtSeconds;

      // --- 2. Choose yaw: wander-override, else seek player ---
      const toPlayerX = inputs.playerX - enemy.x;
      const toPlayerZ = inputs.playerZ - enemy.z;
      const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerZ * toPlayerZ);
      const wandering = enemy.wanderTimer > 0;
      const seeking = !wandering && distToPlayer > MIN_SEEK_DISTANCE;
      if (seeking) {
        // Mesh's natural forward is -Z. fwd = (-sin(yaw), -cos(yaw)) should
        // align with the normalized direction to the player.
        enemy.yaw = Math.atan2(-toPlayerX, -toPlayerZ);
      }
      // In wander mode, enemy.yaw was set when wandering started and is
      // preserved across frames (neither branch here touches it).


      // Sample terrain at both current and proposed-next position. If the
      // next ground is more than one block taller than the current ground,
      // the enemy can't climb the wall: reject the move. Otherwise advance
      // and snap Y to the new terrain height.
      const fwdX = -Math.sin(enemy.yaw);
      const fwdZ = -Math.cos(enemy.yaw);
      const moving = seeking || wandering;
      const speed = moving ? WALK_SPEED : 0;
      const stepX = fwdX * speed * inputs.dtSeconds;
      const stepZ = fwdZ * speed * inputs.dtSeconds;

      // sampleSurface indexes typed arrays directly and requires integer
      // block coordinates (fractional indices on a Uint8Array silently
      // return undefined). Round to the nearest block — cubes are centered
      // at integer positions spanning [N-0.5, N+0.5].
      const curSample = inputs.sampleSurface(Math.round(enemy.x), Math.round(enemy.z));
      const nextSample = inputs.sampleSurface(Math.round(enemy.x + stepX), Math.round(enemy.z + stepZ));
      const curBlock = curSample !== undefined ? curSample & 0xff : 64;
      const nextBlock = nextSample !== undefined ? nextSample & 0xff : curBlock;

      if (!moving || nextBlock - curBlock <= 1) {
        // Move accepted (or skipped because speed was 0): advance and snap Y.
        enemy.x += stepX;
        enemy.z += stepZ;
        enemy.y = nextBlock + 0.5;
      } else {
        // Blocked by a wall > 1 block tall. Stay in place, snap Y to current
        // ground, and pick a random side-direction to walk in for a bit so
        // we don't stand at the wall forever. If we were already wandering,
        // re-randomize — we've hit another obstacle, try a new direction.
        enemy.y = curBlock + 0.5;
        enemy.wanderTimer = WANDER_MIN_S + Math.random() * (WANDER_MAX_S - WANDER_MIN_S);
        const offset = Math.PI * 0.5 + Math.random() * Math.PI * 0.5; // 90–180°
        const sign = Math.random() < 0.5 ? -1 : 1;
        enemy.yaw += sign * offset;
      }

      poseSkeletonForPhase(mesh, enemy.phase);

      // Offset must be per-enemy; a shared scratch buffer would collapse all
      // draw states onto the last enemy's position since they'd reference
      // the same memory.
      const offset = new Float32Array([enemy.x, enemy.y + this.footOffset, enemy.z]);

      states.push({
        viewMatrix: inputs.viewMatrix,
        projMatrix: inputs.projMatrix,
        lightPosition: inputs.lightPosition,
        ambientColor: inputs.ambientColor,
        sunColor: inputs.sunColor,
        offset,
        yaw: enemy.yaw,
        boneTranslations: mesh.getBoneTranslations(),
        boneRotations: mesh.getBoneRotations(),
      });
    }
    return states;
  }
}

/**
 * Interpolates the 4 keyframes by `phase`, writes per-bone `localRotation`s
 * onto the four limb bones, then recomputes world-space transforms via
 * `Mesh.updateBoneTransform` from the root.
 */
function poseSkeletonForPhase(mesh: Mesh, phase: number): void {
  const scaled = phase * WALK_KEYFRAMES.length;
  const idx = Math.floor(scaled) % WALK_KEYFRAMES.length;
  const next = (idx + 1) % WALK_KEYFRAMES.length;
  const t = scaled - Math.floor(scaled);

  const a = WALK_KEYFRAMES[idx]!;
  const b = WALK_KEYFRAMES[next]!;
  const legL = a.legL + (b.legL - a.legL) * t;
  const legR = a.legR + (b.legR - a.legR) * t;
  const armL = a.armL + (b.armL - a.armL) * t;
  const armR = a.armR + (b.armR - a.armR) * t;

  // biome-ignore lint/suspicious/noExplicitAny: vendored Mesh type
  const bones = (mesh as any).bones;

  // Legs extend along -Y, so forward swing = rotation around X axis.
  bones[RIG.leftLeg].localRotation = quatAroundX(legL);
  bones[RIG.rightLeg].localRotation = quatAroundX(legR);
  // Arms: apply the "hang down" rest rotation first, then the walk swing on
  // top. Quat.product(a, b) composes as "first b, then a".
  bones[RIG.leftArm].localRotation = Quat.product(quatAroundX(armL), REST_ARM_L);
  bones[RIG.rightArm].localRotation = Quat.product(quatAroundX(armR), REST_ARM_R);

  // updateBoneTransform is private on Mesh; cast past it. It recurses into
  // all children so one call from the root rebuilds the whole skeleton.
  // biome-ignore lint/suspicious/noExplicitAny: calling private method on vendored class
  (mesh as any).updateBoneTransform(RIG.root);
}
