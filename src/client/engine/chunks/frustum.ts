import type { Mat4Like } from "gl-matrix";
import { CHUNK_HEIGHT, CHUNK_SIZE } from "@/game/chunk";

interface Plane {
  a: number;
  b: number;
  c: number;
  d: number;
}

interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function makePlane(a: number, b: number, c: number, d: number): Plane {
  const len = Math.sqrt(a * a + b * b + c * c);
  return { a: a / len, b: b / len, c: c / len, d: d / len };
}

/** Extract 6 frustum planes from a view-projection matrix (Gribb/Hartmann). */
export function extractFrustumPlanes(vp: Readonly<Mat4Like>): Plane[] {
  // Column-major: row i, col j => vp[j*4 + i]
  // biome-ignore lint/style/noNonNullAssertion: exists
  const r = (i: number, j: number) => vp[j * 4 + i]!;

  return [
    makePlane(r(3, 0) + r(0, 0), r(3, 1) + r(0, 1), r(3, 2) + r(0, 2), r(3, 3) + r(0, 3)),
    makePlane(r(3, 0) - r(0, 0), r(3, 1) - r(0, 1), r(3, 2) - r(0, 2), r(3, 3) - r(0, 3)),
    makePlane(r(3, 0) + r(1, 0), r(3, 1) + r(1, 1), r(3, 2) + r(1, 2), r(3, 3) + r(1, 3)),
    makePlane(r(3, 0) - r(1, 0), r(3, 1) - r(1, 1), r(3, 2) - r(1, 2), r(3, 3) - r(1, 3)),
    makePlane(r(3, 0) + r(2, 0), r(3, 1) + r(2, 1), r(3, 2) + r(2, 2), r(3, 3) + r(2, 3)),
    makePlane(r(3, 0) - r(2, 0), r(3, 1) - r(2, 1), r(3, 2) - r(2, 2), r(3, 3) - r(2, 3)),
  ];
}

/** Build a world-space AABB for a chunk given its center origin. */
export function chunkAABB(originX: number, originZ: number): AABB {
  const half = CHUNK_SIZE / 2;
  return {
    minX: originX - half,
    maxX: originX + half,
    minY: 0,
    maxY: CHUNK_HEIGHT,
    minZ: originZ - half,
    maxZ: originZ + half,
  };
}

/** Test whether an AABB is at least partially inside the frustum (p-vertex method). */
export function aabbInFrustum(aabb: AABB, planes: Plane[]): boolean {
  for (const p of planes) {
    const px = p.a >= 0 ? aabb.maxX : aabb.minX;
    const py = p.b >= 0 ? aabb.maxY : aabb.minY;
    const pz = p.c >= 0 ? aabb.maxZ : aabb.minZ;
    if (p.a * px + p.b * py + p.c * pz + p.d < 0) return false;
  }
  return true;
}
