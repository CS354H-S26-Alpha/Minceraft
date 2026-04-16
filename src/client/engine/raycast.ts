import { CubeType } from "@/client/engine/render/cube-types";

export interface RaycastHit {
  /** Integer world-space block position. */
  blockX: number;
  blockY: number;
  blockZ: number;
  /** Axis-aligned face normal of the hit surface (e.g. [0, 1, 0] for the top face). */
  faceNormal: [number, number, number];
  blockType: CubeType;
  distance: number;
}

/**
 * DDA (Digital Differential Analyzer) ray march through a voxel grid.
 *
 * Steps through voxels along the ray until a non-Air block is hit or
 * `maxDistance` is exceeded. Returns the hit block position, face normal,
 * block type, and distance — or `null` if nothing was hit.
 */
export function raycastVoxels(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  getBlock: (wx: number, wy: number, wz: number) => CubeType,
): RaycastHit | null {
  // Current voxel position
  let vx = Math.floor(ox);
  let vy = Math.floor(oy);
  let vz = Math.floor(oz);

  // Step direction per axis (+1 or -1)
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;

  // Distance along the ray to cross one full voxel per axis
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  // Distance to the next voxel boundary per axis
  let tMaxX = dx !== 0 ? (dx > 0 ? vx + 1 - ox : ox - vx) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? vy + 1 - oy : oy - vy) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? vz + 1 - oz : oz - vz) * tDeltaZ : Infinity;

  // Track which axis was last stepped (0=x, 1=y, 2=z)
  let lastAxis = -1;

  // Check the starting voxel (player might be inside a block)
  const startBlock = getBlock(vx, vy, vz);
  if (startBlock !== CubeType.Air) {
    return {
      blockX: vx,
      blockY: vy,
      blockZ: vz,
      faceNormal: [0, 0, 0],
      blockType: startBlock,
      distance: 0,
    };
  }

  while (true) {
    // Advance along the axis with the smallest tMax
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        if (tMaxX > maxDistance) return null;
        vx += stepX;
        tMaxX += tDeltaX;
        lastAxis = 0;
      } else {
        if (tMaxZ > maxDistance) return null;
        vz += stepZ;
        tMaxZ += tDeltaZ;
        lastAxis = 2;
      }
    } else {
      if (tMaxY < tMaxZ) {
        if (tMaxY > maxDistance) return null;
        vy += stepY;
        tMaxY += tDeltaY;
        lastAxis = 1;
      } else {
        if (tMaxZ > maxDistance) return null;
        vz += stepZ;
        tMaxZ += tDeltaZ;
        lastAxis = 2;
      }
    }

    const blockType = getBlock(vx, vy, vz);
    if (blockType !== CubeType.Air) {
      // Compute face normal: opposite of the step direction on the last-stepped axis
      const faceNormal: [number, number, number] = [0, 0, 0];
      if (lastAxis === 0) faceNormal[0] = -stepX;
      else if (lastAxis === 1) faceNormal[1] = -stepY;
      else faceNormal[2] = -stepZ;

      // Distance is the tMax value before the last step
      const distance = lastAxis === 0 ? tMaxX - tDeltaX : lastAxis === 1 ? tMaxY - tDeltaY : tMaxZ - tDeltaZ;

      return { blockX: vx, blockY: vy, blockZ: vz, faceNormal, blockType, distance };
    }
  }
}
