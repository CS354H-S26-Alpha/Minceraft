import robotDaeUrl from "@/assets/models/robot.dae?url";
import { CLoader } from "../skinning/AnimationFileLoader";
import { Quat } from "../skinning/lib/TSM";
import type { Mesh } from "../skinning/Mesh";

/** Hardcoded bone indices for `robot.dae`. */
const RIG = {
  root: 52,
  leftLeg: 44,
  rightLeg: 48,
  leftArm: 7,
  rightArm: 26,
  leftElbow: 8,
  rightElbow: 27,
} as const;

interface WalkPose {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
}

const WALK_KEYFRAMES: WalkPose[] = [
  { legL: +0.6, legR: -0.6, armL: -0.5, armR: +0.5 },
  { legL: 0.0, legR: 0.0, armL: 0.0, armR: 0.0 },
  { legL: -0.6, legR: +0.6, armL: +0.5, armR: -0.5 },
  { legL: 0.0, legR: 0.0, armL: 0.0, armR: 0.0 },
];

export const WALK_CYCLE_HZ = 1.2;
/** Distance (blocks) within which we show the attack animation on the client. */
export const ATTACK_ANIM_RANGE = 2.0;
/** Duration of one attack swing cycle in milliseconds. */
export const ATTACK_CYCLE_MS = 500;

function quatAroundX(angle: number): Quat {
  const half = angle * 0.5;
  return new Quat([Math.sin(half), 0, 0, Math.cos(half)]);
}

function quatAroundY(angle: number): Quat {
  const half = angle * 0.5;
  return new Quat([0, Math.sin(half), 0, Math.cos(half)]);
}

function quatAroundZ(angle: number): Quat {
  const half = angle * 0.5;
  return new Quat([0, 0, Math.sin(half), Math.cos(half)]);
}

const REST_ARM_L = quatAroundZ(+Math.PI / 2);
const REST_ARM_R = quatAroundZ(-Math.PI / 2);

export function loadRobotMesh(): Promise<Mesh> {
  return new Promise((resolve, reject) => {
    const loader = new CLoader(robotDaeUrl);
    loader.load(() => {
      const mesh = loader.meshes[0] as Mesh | undefined;
      if (!mesh) {
        reject(new Error("robot.dae loaded but contained no skinned mesh"));
        return;
      }
      // biome-ignore lint/suspicious/noExplicitAny: vendored Mesh type
      const bones = (mesh as any).bones;
      const childrenOf = (idx: number) =>
        bones.filter((_: unknown, i: number) => bones[i].parent === idx).map((_: unknown, i: number) => i);
      console.log(`[enemy-skinning] leftArm(${RIG.leftArm}) children:`, childrenOf(RIG.leftArm));
      console.log(`[enemy-skinning] rightArm(${RIG.rightArm}) children:`, childrenOf(RIG.rightArm));
      resolve(mesh);
    });
  });
}

export function computeFootOffset(mesh: Mesh): number {
  const pos = mesh.geometry.position.values;
  let minY = Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    const y = pos[i] ?? 0;
    if (y < minY) minY = y;
  }
  return Number.isFinite(minY) ? -minY : 0;
}

export function poseSkeletonForPhase(mesh: Mesh, phase: number): void {
  const scaled = phase * WALK_KEYFRAMES.length;
  const idx = Math.floor(scaled) % WALK_KEYFRAMES.length;
  const next = (idx + 1) % WALK_KEYFRAMES.length;
  const t = scaled - Math.floor(scaled);

  const a = WALK_KEYFRAMES[idx];
  const b = WALK_KEYFRAMES[next];
  if (!a || !b) return;

  const legL = a.legL + (b.legL - a.legL) * t;
  const legR = a.legR + (b.legR - a.legR) * t;
  const armL = a.armL + (b.armL - a.armL) * t;
  const armR = a.armR + (b.armR - a.armR) * t;

  // biome-ignore lint/suspicious/noExplicitAny: vendored Mesh type
  const bones = (mesh as any).bones;

  bones[RIG.leftLeg].localRotation = quatAroundX(legL);
  bones[RIG.rightLeg].localRotation = quatAroundX(legR);
  bones[RIG.leftArm].localRotation = Quat.product(quatAroundX(armL), REST_ARM_L);
  bones[RIG.rightArm].localRotation = Quat.product(quatAroundX(armR), REST_ARM_R);
  bones[RIG.leftElbow].localRotation = new Quat().setIdentity();
  bones[RIG.rightElbow].localRotation = new Quat().setIdentity();

  // biome-ignore lint/suspicious/noExplicitAny: calling private method on vendored class
  (mesh as any).updateBoneTransform(RIG.root);
}

/**
 * Override arm bones with a punch/jab. Call AFTER `poseSkeletonForPhase` so
 * legs keep their walk cycle; only arms + elbows change.
 *
 * `attackPhase` is in [0, 1): 0→0.5 extends the punch, 0.5→1 retracts.
 * The shoulder raises slightly while the forearm snaps forward at the elbow.
 */
export function poseAttackArms(mesh: Mesh, attackPhase: number): void {
  const SHOULDER_PULLBACK = 0.3; // how far the arm cocks behind the body
  const SHOULDER_FORWARD = 0.5; // how far forward at the peak of the strike
  const ELBOW_EXTEND = 1.5;
  // Triangle wave: ramp up 0→1 over first half, ramp down 1→0 over second.
  const t = attackPhase < 0.5 ? attackPhase * 2 : 2 - attackPhase * 2;

  // biome-ignore lint/suspicious/noExplicitAny: vendored Mesh type
  const bones = (mesh as any).bones;

  // Shoulders: swing from pulled-back (-PULLBACK) to punched-forward (+FORWARD).
  // At t=0 the arm is cocked behind; at t=1 it's fully extended.
  const shoulderAngle = -SHOULDER_PULLBACK + t * (SHOULDER_FORWARD + SHOULDER_PULLBACK);
  bones[RIG.leftArm].localRotation = Quat.product(quatAroundX(shoulderAngle), REST_ARM_L);
  bones[RIG.rightArm].localRotation = Quat.product(quatAroundX(shoulderAngle), REST_ARM_R);

  // Elbows: bend forward from the upper-arm's frame. Forearm vertices
  // extend along ±X in rest pose, so rotation around Y swings them toward
  // -Z (forward). Left and right need opposite signs since the arms point
  // in opposite X directions.
  const elbowBend = t * ELBOW_EXTEND;
  bones[RIG.leftElbow].localRotation = quatAroundY(-elbowBend);
  bones[RIG.rightElbow].localRotation = quatAroundY(elbowBend);

  // biome-ignore lint/suspicious/noExplicitAny: calling private method on vendored class
  (mesh as any).updateBoneTransform(RIG.root);
}
