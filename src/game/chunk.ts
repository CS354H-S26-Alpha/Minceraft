/** biome-ignore-all lint/style/noNonNullAssertion: checks are bounded */
import { CUBE_TYPE_INFO, CubeType } from "@/client/engine/render/cube-types";
import { BIOME_INFOS, Biome, sampleColumn, surfaceBlock } from "@/game/biome";
import { perlin3D } from "@/utils/noise";

export const CHUNK_SIZE = 64;
export const CHUNK_HEIGHT = 128;
export const SEA_LEVEL = 50; // water surface in non-desert biomes
export const DESERT_LAVA_LEVEL = 55; // lava surface in desert biome
export const CAVE_LAVA_LEVEL = 8; // deep lava fills cave air pockets at the bottom of the world

// Fluid flow parameters.
// Level 0 = source (never depleted). Level 1..MAX = "flowing" with decreasing
// reach; a block at level N can only spread to level N+1, so FLUID_MAX_LEVEL
// caps horizontal spread distance from the nearest direct drop or source.
export const FLUID_SOURCE_LEVEL = 0;
export const FLUID_MAX_LEVEL = 7;

const LATERAL_FLOW_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Pack a (x, y, z) local chunk coordinate into a single 24-bit index. */
function packPos(lx: number, ly: number, lz: number): number {
  return (ly << 16) | (lz << 8) | lx;
}

type Direction = readonly [number, number, number];

interface FaceAmbientOcclusionSpec {
  normal: Direction;
  corners: readonly (readonly [Direction, Direction])[];
}

// Face order matches Cube geometry: top, left, right, front, back, bottom.
const FACE_AMBIENT_OCCLUSION_SPECS: readonly FaceAmbientOcclusionSpec[] = buildFaceAmbientOcclusionSpecs();

/**
 * Generates AO specs for all 6 axis-aligned cube faces.
 *
 * Each face is defined by its outward normal and two tangent axes (t1, t2).
 * The four corners sample neighbours at (n ± s1*t1, n ± s2*t2); the sign
 * pairs are ordered to match the quad-vertex winding of the cube geometry so
 * that bilinear AO interpolation in the shader maps to the correct corners.
 *
 * Three winding patterns arise from the three tangent-axis families:
 *   XZ (Y-axis normals):  (−,−),(−,+),(+,+),(+,−)
 *   YZ (X-axis normals):  (+,+),(−,+),(−,−),(+,−)
 *   XY (Z-axis normals):  (+,+),(+,−),(−,−),(−,+)
 */
function buildFaceAmbientOcclusionSpecs(): readonly FaceAmbientOcclusionSpec[] {
  // Sign pairs [s1, s2] → sideA = s1*t1, sideB = s2*t2.
  const XZ: readonly (readonly [number, number])[] = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ];
  const YZ: readonly (readonly [number, number])[] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  const XY: readonly (readonly [number, number])[] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];

  const makeFace = (
    normal: Direction,
    t1: Direction,
    t2: Direction,
    signs: readonly (readonly [number, number])[],
  ): FaceAmbientOcclusionSpec => ({
    normal,
    corners: signs.map(([s1, s2]): readonly [Direction, Direction] => [
      [s1 * t1[0], s1 * t1[1], s1 * t1[2]] as Direction,
      [s2 * t2[0], s2 * t2[1], s2 * t2[2]] as Direction,
    ]),
  });

  return [
    makeFace([0, 1, 0], [1, 0, 0], [0, 0, 1], XZ), // top
    makeFace([-1, 0, 0], [0, 1, 0], [0, 0, 1], YZ), // left
    makeFace([1, 0, 0], [0, 1, 0], [0, 0, 1], YZ), // right
    makeFace([0, 0, 1], [1, 0, 0], [0, 1, 0], XY), // front
    makeFace([0, 0, -1], [1, 0, 0], [0, 1, 0], XY), // back
    makeFace([0, -1, 0], [1, 0, 0], [0, 0, 1], XZ), // bottom
  ];
}

function vertexAmbientOcclusion(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - Number(side1) - Number(side2) - Number(corner);
}

export function chunkKey(originX: number, originZ: number): string {
  return `${originX},${originZ}`;
}

export function chunkOrigin(wx: number, wz: number): [number, number] {
  return [
    Math.floor((wx + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
    Math.floor((wz + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
  ];
}

// Shared scratch buffers reused across renderBlockData calls.
let scratchPositions = new Float32Array(0);
let scratchColors = new Float32Array(0);
let scratchAmbientOcclusion = new Uint8Array(0);
// Padded block array: (S+2) × (S+2) × (H+2) with 1-block border for branchless neighbor lookups.
// Air = 0 in the border by default; filled from worldGet when available.
let scratchPadded = new Uint8Array(0);

function ensureScratchCapacity(maxCubes: number, paddedSize: number): void {
  if (scratchPositions.length < 4 * maxCubes) scratchPositions = new Float32Array(4 * maxCubes);
  if (scratchColors.length < 3 * maxCubes) scratchColors = new Float32Array(3 * maxCubes);
  if (scratchAmbientOcclusion.length < 24 * maxCubes) scratchAmbientOcclusion = new Uint8Array(24 * maxCubes);
  if (scratchPadded.length < paddedSize) scratchPadded = new Uint8Array(paddedSize);
}

export const SECTION_SIZE = 16;

/**
 * Derives per-column surface height and block type from raw block data.
 * Returns heightMap and surfaceTypes arrays of length `size × size`.
 */
export function computeHeightData(
  blocks: Uint8Array,
  size: number,
): { heightMap: Uint8Array; surfaceTypes: Uint8Array } {
  const heightMap = new Uint8Array(size * size);
  const surfaceTypes = new Uint8Array(size * size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const colIdx = z * size + x;
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const bt = blocks[y * size * size + z * size + x]!;
        if (bt !== CubeType.Air) {
          heightMap[colIdx] = y;
          surfaceTypes[colIdx] = bt;
          break;
        }
      }
    }
  }
  return { heightMap, surfaceTypes };
}

/**
 * Updates surface height and type for a single column after a block change.
 * `lx`, `lz` are local chunk coordinates; `wy` is the world Y of the changed block.
 */
export function updateColumnSurface(
  blocks: Uint8Array,
  heightMap: Uint8Array,
  surfaceTypes: Uint8Array,
  lx: number,
  lz: number,
  wy: number,
  newBlockType: number,
  size: number,
): void {
  const colIdx = lz * size + lx;
  if (newBlockType === CubeType.Air && wy === heightMap[colIdx]) {
    let newSurfY = 0;
    for (let y = wy - 1; y >= 0; y--) {
      if (blocks[y * size * size + lz * size + lx] !== CubeType.Air) {
        newSurfY = y;
        break;
      }
    }
    heightMap[colIdx] = newSurfY;
    surfaceTypes[colIdx] = blocks[newSurfY * size * size + lz * size + lx] ?? CubeType.Air;
  } else if (newBlockType !== CubeType.Air && wy > (heightMap[colIdx] ?? 0)) {
    heightMap[colIdx] = wy;
    surfaceTypes[colIdx] = newBlockType;
  }
}

export interface RenderBlockResult {
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  cubeAmbientOcclusion: Uint8Array;
  numCubes: number;
}

/** Optional sub-region bounds within a chunk. Limits iteration to a 16x16x16 section. */
export interface RenderRegion {
  /** Local X start within the chunk (0-based). */
  x: number;
  /** Local Z start within the chunk (0-based). */
  z: number;
  /** Y start. */
  y: number;
  /** Region size along X/Z. */
  sizeXZ: number;
  /** Region size along Y. */
  sizeY: number;
}

/**
 * Builds render arrays (positions, colors, AO) from raw block and height data.
 * Environment-agnostic — callable from both the worker and the main thread.
 *
 * Uses a padded (S+2)×(S+2)×(H+2) scratch array for branchless neighbor
 * lookups — eliminates bounds checks and worldGet calls from the hot loop.
 *
 * When `region` is provided, only iterates blocks within that sub-region.
 */
export function renderBlockData(
  blocks: Uint8Array,
  heightMap: Uint8Array,
  originX: number,
  originZ: number,
  size: number,
  worldGet?: (wx: number, wy: number, wz: number) => CubeType,
  region?: RenderRegion,
): RenderBlockResult {
  const topleftx = originX - size / 2;
  const topleftz = originZ - size / 2;
  const S = size;
  const PX = S + 2;
  const PZ = S + 2;
  const PY = CHUNK_HEIGHT + 2;
  const paddedSize = PX * PZ * PY;

  // Iteration bounds
  const x0 = region?.x ?? 0;
  const z0 = region?.z ?? 0;
  const y0 = region?.y ?? 0;
  const x1 = region ? x0 + region.sizeXZ : S;
  const z1 = region ? z0 + region.sizeXZ : S;
  const y1 = region ? y0 + region.sizeY : CHUNK_HEIGHT;

  const maxCubes = (x1 - x0) * (z1 - z0) * (y1 - y0);
  ensureScratchCapacity(maxCubes, paddedSize);

  // Build padded array: index = (ly+1) * PX*PZ + (lz+1) * PX + (lx+1)
  // Default fill is 0 (Air) — borders are Air unless worldGet overrides.
  const padded = scratchPadded;

  // For region renders, only fill the sub-region ± 1-block border in the padded array.
  // For full-chunk renders, fill the entire padded array.
  const strideY = PX * PZ;
  const strideZ = PX;

  if (region) {
    // Padded coords of the region ± 1 border (clamped to padded array bounds)
    const py0 = Math.max(0, y0); // y-1 border: y0+1-1 = y0 in padded coords
    const py1 = Math.min(PY - 1, y1 + 1); // y1+1 border in padded coords
    const pz0 = Math.max(0, z0); // lz-1 border: pz = lz+1-1 = lz
    const pz1 = Math.min(PZ - 1, z1 + 1);
    const px0 = Math.max(0, x0);
    const px1 = Math.min(PX - 1, x1 + 1);
    // Zero only the needed rows
    for (let py = py0; py <= py1; py++) {
      for (let pz = pz0; pz <= pz1; pz++) {
        const base = py * strideY + pz * strideZ + px0;
        padded.fill(0, base, base + (px1 - px0 + 1));
      }
    }
    // Copy interior blocks for the relevant rows only
    const lyMin = Math.max(0, y0 - 1);
    const lyMax = Math.min(CHUNK_HEIGHT - 1, y1);
    const lzMin = Math.max(0, z0 - 1);
    const lzMax = Math.min(S - 1, z1);
    const lxMin = Math.max(0, x0 - 1);
    const lxMax = Math.min(S - 1, x1);
    for (let ly = lyMin; ly <= lyMax; ly++) {
      for (let lz = lzMin; lz <= lzMax; lz++) {
        const srcOff = ly * S * S + lz * S + lxMin;
        const dstOff = (ly + 1) * strideY + (lz + 1) * strideZ + (lxMin + 1);
        padded.set(blocks.subarray(srcOff, srcOff + (lxMax - lxMin + 1)), dstOff);
      }
    }
    // Y=-1 border: mark as solid for columns in the region (prevents false "air" below bedrock floor)
    if (y0 === 0) {
      for (let lz = lzMin; lz <= lzMax; lz++) {
        for (let lx = lxMin; lx <= lxMax; lx++) {
          padded[(lz + 1) * strideZ + (lx + 1)] = CubeType.Bedrock;
        }
      }
    }
    // Fill X/Z borders from worldGet for the region's edges
    if (worldGet) {
      for (let ly = lyMin; ly <= lyMax; ly++) {
        const py = ly + 1;
        if (x0 === 0) {
          for (let lz = lzMin; lz <= lzMax; lz++) {
            padded[py * strideY + (lz + 1) * strideZ + 0] = worldGet(topleftx - 1, ly, topleftz + lz);
          }
        }
        if (x1 === S) {
          for (let lz = lzMin; lz <= lzMax; lz++) {
            padded[py * strideY + (lz + 1) * strideZ + (S + 1)] = worldGet(topleftx + S, ly, topleftz + lz);
          }
        }
        if (z0 === 0) {
          for (let lx = lxMin; lx <= lxMax; lx++) {
            padded[py * strideY + 0 * strideZ + (lx + 1)] = worldGet(topleftx + lx, ly, topleftz - 1);
          }
        }
        if (z1 === S) {
          for (let lx = lxMin; lx <= lxMax; lx++) {
            padded[py * strideY + (S + 1) * strideZ + (lx + 1)] = worldGet(topleftx + lx, ly, topleftz + S);
          }
        }
      }
    }
  } else {
    padded.fill(0, 0, paddedSize);

    // Copy all interior blocks
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lz = 0; lz < S; lz++) {
        const srcOff = ly * S * S + lz * S;
        const dstOff = (ly + 1) * strideY + (lz + 1) * strideZ + 1;
        padded.set(blocks.subarray(srcOff, srcOff + S), dstOff);
      }
    }

    // Fill Y=-1 border as solid (prevents false "air" below bedrock floor)
    padded.fill(CubeType.Bedrock, 0, PX * PZ);

    // Fill X/Z borders from worldGet if available
    if (worldGet) {
      for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
        const py = ly + 1;
        // X borders (lx = -1 and lx = S)
        for (let lz = 0; lz < S; lz++) {
          padded[py * strideY + (lz + 1) * strideZ + 0] = worldGet(topleftx - 1, ly, topleftz + lz);
          padded[py * strideY + (lz + 1) * strideZ + (S + 1)] = worldGet(topleftx + S, ly, topleftz + lz);
        }
        // Z borders (lz = -1 and lz = S)
        for (let lx = 0; lx < S; lx++) {
          padded[py * strideY + 0 * strideZ + (lx + 1)] = worldGet(topleftx + lx, ly, topleftz - 1);
          padded[py * strideY + (S + 1) * strideZ + (lx + 1)] = worldGet(topleftx + lx, ly, topleftz + S);
        }
      }
    }
  }

  const positions = scratchPositions;
  const colors = scratchColors;
  const ambientOcclusion = scratchAmbientOcclusion;
  let count = 0;

  for (let i = z0; i < z1; i++) {
    const pBaseZ = (i + 1) * strideZ;
    for (let j = x0; j < x1; j++) {
      const surfY = region ? Math.min(heightMap[i * S + j] ?? 0, y1 - 1) : (heightMap[i * S + j] ?? 0);
      if (surfY < y0) continue;
      const wx = topleftx + j;
      const wz = topleftz + i;
      const pBaseXZ = pBaseZ + (j + 1);

      for (let y = y0; y <= surfY; y++) {
        const pi = (y + 1) * strideY + pBaseXZ;
        const blockType = padded[pi]!;
        if (blockType === CubeType.Air) continue;

        // Face culling: skip blocks fully surrounded by solid blocks
        if (
          padded[pi + 1] !== CubeType.Air &&
          padded[pi - 1] !== CubeType.Air &&
          padded[pi + strideY] !== CubeType.Air &&
          padded[pi - strideY] !== CubeType.Air &&
          padded[pi + strideZ] !== CubeType.Air &&
          padded[pi - strideZ] !== CubeType.Air
        )
          continue;

        // Write instance data
        const info = CUBE_TYPE_INFO[blockType as CubeType];
        const c = info.baseColor;
        positions[4 * count] = wx;
        positions[4 * count + 1] = y;
        positions[4 * count + 2] = wz;
        positions[4 * count + 3] = blockType;
        colors[3 * count] = c[0];
        colors[3 * count + 1] = c[1];
        colors[3 * count + 2] = c[2];

        // AO: 6 faces × 4 corners — all via padded array with pre-computed offsets
        let aoOffset = 24 * count;
        for (const face of FACE_AMBIENT_OCCLUSION_SPECS) {
          const nOff = face.normal[0] + face.normal[1] * strideY + face.normal[2] * strideZ;
          for (const [sideA, sideB] of face.corners) {
            const aOff = sideA[0] + sideA[1] * strideY + sideA[2] * strideZ;
            const bOff = sideB[0] + sideB[1] * strideY + sideB[2] * strideZ;
            const s1 = padded[pi + nOff + aOff] !== CubeType.Air;
            const s2 = padded[pi + nOff + bOff] !== CubeType.Air;
            const cn = padded[pi + nOff + aOff + bOff] !== CubeType.Air;
            ambientOcclusion[aoOffset++] = vertexAmbientOcclusion(s1, s2, cn);
          }
        }
        count++;
      }
    }
  }

  return {
    cubePositions: positions.slice(0, 4 * count),
    cubeColors: colors.slice(0, 3 * count),
    cubeAmbientOcclusion: ambientOcclusion.slice(0, 24 * count),
    numCubes: count,
  };
}

/** Computes the section index for a block at local coordinates (lx, ly, lz). */
export function sectionIndex(lx: number, ly: number, lz: number): number {
  return (lx >> 4) + ((lz >> 4) << 2) + ((ly >> 4) << 4);
}

/** Returns the RenderRegion for a given section index. */
export function sectionRegion(idx: number): RenderRegion {
  const sx = idx & 3;
  const sz = (idx >> 2) & 3;
  const sy = idx >> 4;
  return {
    x: sx * SECTION_SIZE,
    z: sz * SECTION_SIZE,
    y: sy * SECTION_SIZE,
    sizeXZ: SECTION_SIZE,
    sizeY: SECTION_SIZE,
  };
}

/** Total number of sections in a chunk (4x4x8 = 128). */
export const SECTIONS_PER_CHUNK =
  (CHUNK_SIZE / SECTION_SIZE) * (CHUNK_SIZE / SECTION_SIZE) * (CHUNK_HEIGHT / SECTION_SIZE);

/**
 * Column-major RLE encoding for chunk block data. Iterates each (x,z) column
 * along the Y axis, emitting (blockType, runLength) pairs. Typical chunks
 * compress from 512 KB to ~40-50 KB.
 */
export function rleEncodeBlocks(blocks: Uint8Array, size: number): Uint8Array {
  const maxPairs = size * size * CHUNK_HEIGHT; // absolute worst case
  const buf = new Uint8Array(maxPairs * 2);
  let writeIdx = 0;

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let runType = blocks[0 * size * size + z * size + x]!;
      let runLen = 1;

      for (let y = 1; y < CHUNK_HEIGHT; y++) {
        const bt = blocks[y * size * size + z * size + x]!;
        if (bt === runType && runLen < 255) {
          runLen++;
        } else {
          buf[writeIdx++] = runType;
          buf[writeIdx++] = runLen;
          runType = bt;
          runLen = 1;
        }
      }
      buf[writeIdx++] = runType;
      buf[writeIdx++] = runLen;
    }
  }

  return buf.slice(0, writeIdx);
}

/**
 * Decodes column-major RLE data back into a flat blocks array.
 * Returns the blocks Uint8Array (size × size × CHUNK_HEIGHT).
 */
export function rleDecodeBlocks(encoded: Uint8Array, size: number): Uint8Array {
  const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
  let readIdx = 0;

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let y = 0;
      while (y < CHUNK_HEIGHT) {
        if (readIdx + 1 >= encoded.length) {
          throw new Error(
            `rleDecodeBlocks: unexpected end of encoded data at readIdx=${readIdx} (column x=${x}, z=${z}, y=${y})`,
          );
        }
        const blockType = encoded[readIdx++]!;
        const runLen = encoded[readIdx++]!;
        if (runLen === 0) {
          throw new Error(`rleDecodeBlocks: zero-length run at readIdx=${readIdx - 1} (column x=${x}, z=${z}, y=${y})`);
        }
        if (y + runLen > CHUNK_HEIGHT) {
          throw new Error(
            `rleDecodeBlocks: run of length ${runLen} at y=${y} exceeds CHUNK_HEIGHT=${CHUNK_HEIGHT} (column x=${x}, z=${z})`,
          );
        }
        for (let i = 0; i < runLen; i++) {
          blocks[y * size * size + z * size + x] = blockType;
          y++;
        }
      }
    }
  }

  return blocks;
}

export class Chunk {
  // types where we store the actual block data
  public blocks: Uint8Array; // 3D block grid (CubeType per voxel): x z y // y*(S*S) + z*S + x
  public heightMap: Uint8Array; // surface height per (i,j) column x z // z*S + x
  /** Flow level per voxel; 0 for source/non-fluid, 1..FLUID_MAX_LEVEL for flowing. */
  public fluidLevels: Uint8Array;
  private surfaceTypesMap: Uint8Array; // top-most block type per (x, z) column

  private x: number; // Center of the chunk
  private y: number;
  private size: number; // Number of cubes along each side of the chunk
  private seed: number; // Seed for terrain generation

  // types to update for Rendering
  private cubes: number = 0;
  private cubePositionsF32: Float32Array = new Float32Array(0);
  private cubeColorsF32: Float32Array = new Float32Array(0);
  private cubeAmbientOcclusionU8: Uint8Array = new Uint8Array(0);

  // Packed (y<<16)|(z<<8)|x positions of fluid blocks that may still flow on
  // the next tick. A Set gives O(1) add/remove and natural de-duplication —
  // both important because write-phase helpers (`applyFluidFlow`,
  // `activateFluidNeighbours`) can be triggered from many places in a single
  // tick without risking the list growing unboundedly.
  //
  // Rebuilt each tick so stable (surrounded) cells drop out on their own;
  // source blocks (level 0) are always kept so they remain eligible if an
  // adjacent cell opens up later (e.g. via mining).
  private activeFluids: Set<number> = new Set();

  // Highest Y at which this chunk has ever held a fluid cell (-1 = never).
  // Conservative upper bound: not decremented on decay/harden, so it stays
  // useful even after fluids retreat. Used to cap boundary-priming scans.
  private maxFluidY_: number = -1;

  constructor(
    centerX: number,
    centerY: number,
    size: number,
    seed: number,
    skipRender = false,
    prefilled?: { blocks: Uint8Array; fluidLevels?: Uint8Array },
  ) {
    this.x = centerX;
    this.y = centerY;
    this.size = size;
    this.seed = seed;

    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.surfaceTypesMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

    if (prefilled) {
      this.blocks = prefilled.blocks;
      this.fluidLevels = prefilled.fluidLevels ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
      this.buildHeightMap();
    } else {
      this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT); // with default value 0 = CubeType.Air
      this.fluidLevels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
      this.generateCubes();
    }

    this.seedActiveFluids();
    if (!skipRender && !prefilled) this.renderChunk();
  }

  /** Returns the number of fluid cells queued for the next tick. */
  public get activeFluidCount(): number {
    return this.activeFluids.size;
  }

  /** Upper-bound Y of any fluid ever placed in this chunk (-1 if none). */
  public get maxFluidY(): number {
    return this.maxFluidY_;
  }

  /**
   * Rebuilds heightMap/surfaceTypesMap from the current `blocks` array. Used
   * when hydrating a Chunk from persisted data instead of terrain generation.
   */
  private buildHeightMap(): void {
    const S = this.size;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const hmIdx = z * CHUNK_SIZE + x;
        let topY = -1;
        let topType: CubeType = CubeType.Air;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const t = this.blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x] as CubeType;
          if (t !== CubeType.Air) {
            topY = y;
            topType = t;
            break;
          }
        }
        this.heightMap[hmIdx] = topY < 0 ? 0 : topY;
        this.surfaceTypesMap[hmIdx] = topType;
      }
    }
  }

  /**
   * Collects fluid voxels that could still act (have an adjacent air cell,
   * opposing fluid, or sit on a chunk boundary where spillover may reach a
   * neighbour chunk) into the active-fluid queue. Interior sources that are
   * fully surrounded by same-fluid are left out; they get re-woken by
   * `activateCellIfFluid` / `activateFluidNeighbours` whenever an adjacent
   * cell changes. Generated fluids are all sources (level 0).
   */
  private seedActiveFluids(): void {
    const S = this.size;
    let maxY = -1;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < S; z++) {
        const zOffset = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE;
        for (let x = 0; x < S; x++) {
          const t = this.blocks[zOffset + x];
          if (t !== CubeType.Water && t !== CubeType.Lava) continue;
          if (y > maxY) maxY = y;
          if (this.canFluidAct(x, y, z, t as CubeType.Water | CubeType.Lava)) {
            this.activeFluids.add(packPos(x, y, z));
          }
        }
      }
    }
    this.maxFluidY_ = maxY;
  }

  /**
   * True iff a fluid at (lx, ly, lz) has at least one in-chunk neighbour
   * (below, ±X, ±Z) it could plausibly act on next tick — an Air or
   * opposing-fluid cell. Used to cull stable interior sources from
   * `activeFluids` so per-tick iteration is proportional to the fluid
   * *surface*, not volume. Cells on the chunk boundary whose in-chunk
   * neighbours are all unreactive still return false; the cross-chunk
   * neighbour is handled out-of-band by `primeAgainstNeighbor` (called
   * when a neighbour chunk loads) and `chunk-storage.activateFluidNeighbours`
   * (called on block breaks).
   */
  private canFluidAct(lx: number, ly: number, lz: number, type: CubeType.Water | CubeType.Lava): boolean {
    const S = this.size;
    const stride = CHUNK_SIZE * CHUNK_SIZE;
    const rowStride = CHUNK_SIZE;
    const opp = opposingFluid(type);
    if (ly > 0) {
      const b = this.blocks[(ly - 1) * stride + lz * rowStride + lx];
      if (b === CubeType.Air || b === opp) return true;
    }
    const py = ly * stride;
    if (lx + 1 < S) {
      const bE = this.blocks[py + lz * rowStride + lx + 1];
      if (bE === CubeType.Air || bE === opp) return true;
    }
    if (lx > 0) {
      const bW = this.blocks[py + lz * rowStride + lx - 1];
      if (bW === CubeType.Air || bW === opp) return true;
    }
    if (lz + 1 < S) {
      const bN = this.blocks[py + (lz + 1) * rowStride + lx];
      if (bN === CubeType.Air || bN === opp) return true;
    }
    if (lz > 0) {
      const bS = this.blocks[py + (lz - 1) * rowStride + lx];
      if (bS === CubeType.Air || bS === opp) return true;
    }
    return false;
  }

  public getBlock(lx: number, ly: number, lz: number): CubeType {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return CubeType.Air;
    return this.blocks[ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] as CubeType;
  }

  /** Look up a block by world-space coordinates. Returns Air if outside this chunk. */
  public getBlockWorld(wx: number, wy: number, wz: number): CubeType {
    const lx = wx - (this.x - this.size / 2);
    const lz = wz - (this.y - this.size / 2);
    return this.getBlock(lx, wy, lz);
  }

  private setBlock(lx: number, ly: number, lz: number, type: CubeType): void {
    this.blocks[ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = type;
  }

  // Ore definitions: [cubeType, seedOffset, frequency, threshold, minY, maxY]
  private static readonly ORES: [CubeType, number, number, number, number, number][] = [
    [CubeType.CoalOre, 300, 1 / 8, 0.55, 5, 80],
    [CubeType.IronOre, 400, 1 / 10, 0.6, 5, 60],
    [CubeType.GoldOre, 500, 1 / 12, 0.65, 5, 32],
    [CubeType.DiamondOre, 600, 1 / 14, 0.7, 1, 16],
  ];

  // calculate block types for every position in the chunk
  private generateCubes(): void {
    const topleftx = this.x - this.size / 2;
    const topleftz = this.y - this.size / 2;

    // Local biome map used in Pass 4 to distinguish water vs. lava columns.
    const biomeMap = new Uint8Array(this.size * this.size);

    // --- Pass 1: Base terrain fill ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const globalX = topleftx + j;
        const globalZ = topleftz + i;

        const { biome, surfaceBiome, height: rawHeight } = sampleColumn(this.seed, globalX, globalZ);
        biomeMap[this.size * i + j] = biome; // structural biome drives fluid fill
        const height = Math.max(1, Math.min(CHUNK_HEIGHT - 2, rawHeight));

        this.heightMap[this.size * i + j] = height;

        this.setBlock(j, 0, i, CubeType.Bedrock);
        for (let y = 1; y < height - 3; y++) {
          this.setBlock(j, y, i, CubeType.Stone);
        }
        for (let y = Math.max(1, height - 3); y < height; y++) {
          this.setBlock(j, y, i, BIOME_INFOS[biome].subsurface); // subsurface follows structural biome
        }
        const surfaceType = surfaceBlock(surfaceBiome, height, this.seed, globalX, globalZ);
        if (surfaceType === CubeType.Snow && height + 1 < CHUNK_HEIGHT) {
          // Snow sits on top as its own block — base surface stays as stone/etc.
          this.setBlock(j, height, i, BIOME_INFOS[surfaceBiome].surface);
          this.setBlock(j, height + 1, i, CubeType.Snow);
          this.heightMap[this.size * i + j] = height + 1;
          this.surfaceTypesMap[this.size * i + j] = CubeType.Snow;
        } else {
          this.setBlock(j, height, i, surfaceType);
          this.surfaceTypesMap[this.size * i + j] = surfaceType;
        }
      }
    }

    // --- Pass 2: Spaghetti cave carving (tunnel-like, follows noise zero-crossings) ---
    // Coarse Y-span skipping: sample n1 at span midpoints to eliminate regions
    // where no cave can exist. Uses Lipschitz bound (K=2.0) on perlin3D for
    // correctness: over half a CAVE_STEP span at freq 1/64, noise changes by
    // at most CAVE_SKIP_MARGIN, so if |n1_mid| >= threshold + margin, the
    // entire span is cave-free.
    const CAVE_STEP = 8;
    const CAVE_FREQ = 1 / 64;
    const CAVE_THRESHOLD = 0.12;
    const CAVE_CAP = 8;
    const MOUNTAIN_CAVE_FREQ = 1 / 40;
    const MOUNTAIN_CAVE_CAP = 0;
    const caveSkipThreshold = (freq: number) => CAVE_THRESHOLD + 2.0 * Math.ceil(CAVE_STEP / 2) * freq;

    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;
        const isMountain = (biomeMap[this.size * i + j] as Biome) === Biome.Mountain;
        const caveCap = isMountain ? MOUNTAIN_CAVE_CAP : CAVE_CAP;
        const caveFreq = isMountain ? MOUNTAIN_CAVE_FREQ : CAVE_FREQ;
        const caveTop = (this.heightMap[this.size * i + j] as number) - caveCap;
        const skipThreshold = caveSkipThreshold(caveFreq);

        for (let yBase = 1; yBase <= caveTop; yBase += CAVE_STEP) {
          const yEnd = Math.min(yBase + CAVE_STEP, caveTop + 1);
          const yMid = (yBase + yEnd - 1) >> 1;

          const n1Coarse = perlin3D(this.seed + 100, gx, yMid, gz, caveFreq);
          if (Math.abs(n1Coarse) >= skipThreshold) continue;

          for (let y = yBase; y < yEnd; y++) {
            if (this.getBlock(j, y, i) === CubeType.Air) continue;

            const n1 = perlin3D(this.seed + 100, gx, y, gz, caveFreq);
            if (Math.abs(n1) >= CAVE_THRESHOLD) continue;
            const n2 = perlin3D(this.seed + 200, gx, y, gz, caveFreq);
            if (Math.abs(n2) < CAVE_THRESHOLD) {
              this.setBlock(j, y, i, CubeType.Air);
              if (this.getBlock(j, y + 1, i) === CubeType.Snow) {
                this.setBlock(j, y + 1, i, CubeType.Air);
              }
            }
          }
        }
      }
    }

    // --- Pass 2.5: Collapse floating mountain peak caps ---
    // Cave carving (caveCap=0) can sever a thin peak tip from the main mountain body.
    // Per column: scan down from the actual top, find the first air gap, and remove the
    // cap above it if it is ≤5 blocks tall (thin spires are always floating artefacts).
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        if ((biomeMap[this.size * i + j] as Biome) !== Biome.Mountain) continue;
        const idx = this.size * i + j;

        // Find actual topmost solid block (heightMap is stale after cave carving)
        let topY = this.heightMap[idx] as number;
        while (topY > 0 && this.getBlock(j, topY, i) === CubeType.Air) topY--;

        // Scan down through the top solid section looking for the first air gap
        let gapAt = -1;
        for (let y = topY; y > 1; y--) {
          if (this.getBlock(j, y - 1, i) === CubeType.Air) {
            gapAt = y; // lowest block of the floating cap
            break;
          }
        }
        if (gapAt < 0) {
          this.heightMap[idx] = topY;
          continue; // solid all the way down — stable
        }

        const capHeight = topY - gapAt + 1;
        if (capHeight <= 5) {
          // Thin cap — almost certainly a floating artefact; remove it
          for (let y = gapAt; y <= topY; y++) {
            this.setBlock(j, y, i, CubeType.Air);
          }
          // Find new surface below the removed section and the air gap
          let newTop = gapAt - 1;
          while (newTop > 0 && this.getBlock(j, newTop, i) === CubeType.Air) newTop--;
          this.heightMap[idx] = newTop;
        } else {
          this.heightMap[idx] = topY;
        }
      }
    }

    // --- Pass 3: Ore placement (only in Stone blocks within depth ranges) ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;
        const stoneTop = Math.max(1, this.heightMap[this.size * i + j]! - 3);

        for (let y = 1; y < stoneTop; y++) {
          if (this.getBlock(j, y, i) !== CubeType.Stone) continue;

          for (const [oreType, seedOff, freq, threshold, minY, maxY] of Chunk.ORES) {
            if (y < minY || y > maxY) continue;
            if (perlin3D(this.seed + seedOff, gx, y, gz, freq) > threshold) {
              this.setBlock(j, y, i, oreType);
              break;
            }
          }
        }
      }
    }

    // --- Pass 3.5: Mountain cave wall ore clusters ---
    // Stone blocks adjacent to air (cave surfaces) in mountain biome get extra ore density.
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        if ((biomeMap[this.size * i + j] as Biome) !== Biome.Mountain) continue;
        const gx = topleftx + j;
        const gz = topleftz + i;

        for (let y = 1; y < CHUNK_HEIGHT; y++) {
          if (this.getBlock(j, y, i) !== CubeType.Stone) continue;

          // Only target cave wall blocks — stone that touches at least one air neighbour
          const onCaveWall =
            this.getBlock(j + 1, y, i) === CubeType.Air ||
            this.getBlock(j - 1, y, i) === CubeType.Air ||
            this.getBlock(j, y, i + 1) === CubeType.Air ||
            this.getBlock(j, y, i - 1) === CubeType.Air ||
            this.getBlock(j, y + 1, i) === CubeType.Air ||
            this.getBlock(j, y - 1, i) === CubeType.Air;
          if (!onCaveWall) continue;

          for (const [oreType, seedOff, freq, threshold, minY, maxY] of Chunk.ORES) {
            if (y < minY || y > maxY) continue;
            // Lower threshold = more ore on cave walls
            if (perlin3D(this.seed + seedOff + 700, gx, y, gz, freq) > threshold - 0.15) {
              this.setBlock(j, y, i, oreType);
              break;
            }
          }
        }
      }
    }

    // --- Pass 4: Deep cave lava ---
    // Any air pocket at or below CAVE_LAVA_LEVEL (above bedrock at Y=0) becomes lava,
    // creating natural lava pools at the bottom of caves.
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        for (let y = 1; y <= CAVE_LAVA_LEVEL; y++) {
          if (this.getBlock(j, y, i) === CubeType.Air) {
            this.setBlock(j, y, i, CubeType.Lava);
          }
        }
      }
    }

    // --- Pass 5: Surface fluid fill ---
    // Desert: coat low-lying surface blocks with Lava (follows terrain slope).
    // All other biomes: fill low columns with Water up to SEA_LEVEL.
    // heightMap is updated so renderChunk scans up to the fluid surface.
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const idx = this.size * i + j;
        const terrainY = this.heightMap[idx] as number;
        const biome = biomeMap[idx] as Biome;

        if (biome === Biome.Desert) {
          // Surface-coat low desert terrain with lava — follows the slope naturally.
          // Skip if spillover replaced the surface, or if any adjacent column is a different
          // biome (lava stays interior to the desert, never on biome edges).
          if (terrainY >= DESERT_LAVA_LEVEL) continue;
          if (this.getBlock(j, terrainY, i) !== CubeType.Sand) continue;
          // Require a 5-block interior buffer — lava with physics must not reach biome edges.
          const S = this.size;
          const R = 5;
          let onEdge = false;
          outer: for (let di = -R; di <= R && !onEdge; di++) {
            for (let dj = -R; dj <= R && !onEdge; dj++) {
              if (Math.abs(di) + Math.abs(dj) > R) continue; // diamond/cross shape
              const ni = i + di,
                nj = j + dj;
              if (ni < 0 || ni >= S || nj < 0 || nj >= S) {
                onEdge = true;
                break outer;
              }
              if ((biomeMap[ni * S + nj] as Biome) !== Biome.Desert) {
                onEdge = true;
                break outer;
              }
            }
          }
          if (onEdge) continue;
          // Flood-fill lava up to DESERT_LAVA_LEVEL — flat lake surface, sand stays as floor
          for (let y = terrainY + 1; y <= DESERT_LAVA_LEVEL; y++) {
            this.setBlock(j, y, i, CubeType.Lava);
          }
          this.heightMap[idx] = DESERT_LAVA_LEVEL;
          this.surfaceTypesMap[idx] = CubeType.Lava;
        } else if (biome === Biome.Tundra || biome === Biome.Mountain) {
          // Tundra is dry/frozen; Mountain valleys are rocky, not flooded
        } else {
          if (terrainY >= SEA_LEVEL) continue;
          for (let y = terrainY + 1; y <= SEA_LEVEL; y++) {
            this.setBlock(j, y, i, CubeType.Water);
          }
          this.heightMap[idx] = SEA_LEVEL;
          this.surfaceTypesMap[idx] = CubeType.Water;
        }
      }
    }
  }

  /**
   * Places a fluid block and registers it as active so it will flow on the
   * next tick. Used by both terrain generation (indirectly, via
   * `seedActiveFluids`) and any runtime caller that opens terrain at a
   * cell that should re-flood from a source (e.g. mining). No-op if
   * (x, y, z) is outside the chunk.
   */
  public addFluid(lx: number, ly: number, lz: number, type: CubeType.Water | CubeType.Lava, level = 0): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return;
    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    this.blocks[idx] = type;
    this.fluidLevels[idx] = level;
    this.activeFluids.add(packPos(lx, ly, lz));
    if (ly > this.maxFluidY_) this.maxFluidY_ = ly;
    const hmIdx = lz * CHUNK_SIZE + lx;
    if (ly > this.heightMap[hmIdx]!) {
      this.heightMap[hmIdx] = ly;
      this.surfaceTypesMap[hmIdx] = type;
    }
  }

  /**
   * Applies an incoming fluid flow to a single cell. Used both by intra-
   * chunk flow (tickFluids) and by cross-chunk spillover from neighbouring
   * chunks. Returns true if the target cell was modified.
   *
   *   - Target is air: place the fluid and register as active.
   *   - Target is the opposite fluid: both harden into Stone (a very
   *     simple stand-in for Minecraft's cobblestone/obsidian). The cell
   *     becomes solid so fluids can no longer traverse it.
   *   - Target is anything else (solid, same-fluid, bedrock, …): no-op.
   */
  public applyFluidFlow(
    lx: number,
    ly: number,
    lz: number,
    type: CubeType.Water | CubeType.Lava,
    level: number,
  ): boolean {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return false;
    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    const target = this.blocks[idx] as CubeType;
    if (target === CubeType.Air) {
      this.blocks[idx] = type;
      this.fluidLevels[idx] = level;
      this.activeFluids.add(packPos(lx, ly, lz));
      if (ly > this.maxFluidY_) this.maxFluidY_ = ly;
      const hmIdx = lz * CHUNK_SIZE + lx;
      if (ly > this.heightMap[hmIdx]!) {
        this.heightMap[hmIdx] = ly;
        this.surfaceTypesMap[hmIdx] = type;
      }
      return true;
    }
    if (target === opposingFluid(type)) {
      this.blocks[idx] = CubeType.Stone;
      this.fluidLevels[idx] = 0;
      const hmIdx = lz * CHUNK_SIZE + lx;
      if (ly >= this.heightMap[hmIdx]!) {
        this.refreshSurfaceCacheForColumn(lx, lz);
      }
      this.activateFluidNeighbours(lx, ly, lz);
      return true;
    }
    return false;
  }

  /**
   * Removes a fluid voxel (turns it into air) and re-activates adjacent
   * fluid cells so they can decide whether to flow into the new gap or
   * decay. Intended for use by the decay pass and by future mining code.
   */
  public removeFluidAt(lx: number, ly: number, lz: number): boolean {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return false;
    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    const t = this.blocks[idx] as CubeType;
    if (t !== CubeType.Water && t !== CubeType.Lava) return false;
    this.blocks[idx] = CubeType.Air;
    this.fluidLevels[idx] = 0;
    const hmIdx = lz * CHUNK_SIZE + lx;
    if (ly >= this.heightMap[hmIdx]!) {
      this.refreshSurfaceCacheForColumn(lx, lz);
    }
    this.activateFluidNeighbours(lx, ly, lz);
    return true;
  }

  private refreshSurfaceCacheForColumn(lx: number, lz: number): void {
    const hmIdx = lz * CHUNK_SIZE + lx;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const idx = y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
      const t = this.blocks[idx] as CubeType;
      if (t !== CubeType.Air) {
        this.heightMap[hmIdx] = y;
        this.surfaceTypesMap[hmIdx] = t;
        return;
      }
    }
    this.heightMap[hmIdx] = -1;
    this.surfaceTypesMap[hmIdx] = CubeType.Air;
  }
  /**
   * Scans the face of this chunk adjacent to `neighbor` (specified by a
   * unit step `(dx, dz)` from `this` to `neighbor` in world space) and
   * activates any fluid cell whose cross-chunk neighbour in `neighbor`
   * is Air or opposing fluid — i.e. cells that could flow out on the
   * next tick. Called by `ChunkStorage` after a chunk is loaded so
   * boundary sources that weren't seeded by local `canFluidAct` get
   * woken once the adjacent chunk is present.
   */
  public primeAgainstNeighbor(neighbor: Chunk, dx: number, dz: number): void {
    const maxY = Math.min(CHUNK_HEIGHT - 1, Math.max(this.maxFluidY_, neighbor.maxFluidY_));
    if (maxY < 0) return;
    const S = this.size;
    const stride = CHUNK_SIZE * CHUNK_SIZE;
    const rowStride = CHUNK_SIZE;

    if (dx !== 0) {
      const thisLx = dx === 1 ? S - 1 : 0;
      const otherLx = dx === 1 ? 0 : S - 1;
      for (let y = 0; y <= maxY; y++) {
        const rowBase = y * stride;
        for (let z = 0; z < S; z++) {
          const t = this.blocks[rowBase + z * rowStride + thisLx];
          if (t !== CubeType.Water && t !== CubeType.Lava) continue;
          const o = neighbor.blocks[rowBase + z * rowStride + otherLx];
          const opp = t === CubeType.Water ? CubeType.Lava : CubeType.Water;
          if (o === CubeType.Air || o === opp) {
            this.activeFluids.add(packPos(thisLx, y, z));
          }
        }
      }
    } else {
      const thisLz = dz === 1 ? S - 1 : 0;
      const otherLz = dz === 1 ? 0 : S - 1;
      for (let y = 0; y <= maxY; y++) {
        const rowBase = y * stride;
        for (let x = 0; x < S; x++) {
          const t = this.blocks[rowBase + thisLz * rowStride + x];
          if (t !== CubeType.Water && t !== CubeType.Lava) continue;
          const o = neighbor.blocks[rowBase + otherLz * rowStride + x];
          const opp = t === CubeType.Water ? CubeType.Lava : CubeType.Water;
          if (o === CubeType.Air || o === opp) {
            this.activeFluids.add(packPos(x, y, thisLz));
          }
        }
      }
    }
  }

  /** Adds (lx, ly, lz) to the active-fluids queue if it contains Water/Lava. No-op otherwise. */
  public activateCellIfFluid(lx: number, ly: number, lz: number): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return;
    const t = this.blocks[ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx];
    if (t === CubeType.Water || t === CubeType.Lava) {
      this.activeFluids.add(packPos(lx, ly, lz));
    }
  }

  private activateFluidNeighbours(lx: number, ly: number, lz: number): void {
    const candidates: readonly [number, number, number][] = [
      [lx + 1, ly, lz],
      [lx - 1, ly, lz],
      [lx, ly, lz + 1],
      [lx, ly, lz - 1],
      [lx, ly + 1, lz],
      [lx, ly - 1, lz],
    ];
    for (const [nx, ny, nz] of candidates) {
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const t = this.blocks[ny * CHUNK_SIZE * CHUNK_SIZE + nz * CHUNK_SIZE + nx];
      if (t === CubeType.Water || t === CubeType.Lava) {
        this.activeFluids.add(packPos(nx, ny, nz));
      }
    }
  }

  /**
   * True iff a flowing fluid at (lx, ly, lz) with the given level has at
   * least one "supporter" neighbour feeding it — i.e. a same-fluid cell
   * either directly above (waterfall) or laterally at a lower level
   * (closer to a source). Sources are themselves trivially supported.
   *
   * Cells on the chunk's XZ boundary are treated as supported regardless,
   * since we can't cheaply see into the adjacent chunk from here. This is
   * a conservative over-estimate — a boundary fluid might fail to decay
   * when its cross-chunk supporter was removed — but it never causes
   * spurious decay.
   */
  private isFluidSupported(lx: number, ly: number, lz: number, type: CubeType, level: number): boolean {
    if (level === FLUID_SOURCE_LEVEL) return true;
    const S = this.size;
    if (lx === 0 || lx === S - 1 || lz === 0 || lz === S - 1) return true;
    const stride = CHUNK_SIZE * CHUNK_SIZE;
    const rowStride = CHUNK_SIZE;

    if (ly + 1 < CHUNK_HEIGHT) {
      const aboveIdx = (ly + 1) * stride + lz * rowStride + lx;
      if (this.blocks[aboveIdx] === type) return true; // waterfall column
    }

    for (let o = 0; o < LATERAL_FLOW_OFFSETS.length; o++) {
      const [dx, dz] = LATERAL_FLOW_OFFSETS[o]!;
      const nx = lx + dx;
      const nz = lz + dz;
      if (nx < 0 || nx >= S || nz < 0 || nz >= S) continue;
      const nIdx = ly * stride + nz * rowStride + nx;
      if (this.blocks[nIdx] !== type) continue;
      if (this.fluidLevels[nIdx]! < level) return true;
    }
    return false;
  }

  /**
   * Advances fluid simulation by one tick. Ordered as:
   *
   *   1. Decay pass — any flowing fluid with no supporter evaporates
   *      (becomes air) and re-activates its neighbours so cascading decay
   *      propagates one cell per tick.
   *   2. Flow pass — surviving fluids try to flow straight down, falling
   *      back to lateral spread up to `FLUID_MAX_LEVEL` cells from the
   *      nearest drop or source.
   *
   * Lateral flows that leave the chunk are routed through the optional
   * `spillover` callback, which the queue uses to reach the owning
   * neighbour chunk's `applyFluidFlow`. Vertical flow can't cross a chunk
   * boundary.
   *
   * Mixed-fluid contact (water meeting lava) hardens the target cell
   * into Stone, which matches how Minecraft handles the same collision
   * with cobblestone/obsidian without needing new block types.
   *
   * Returns true iff any block changed.
   */
  public tickFluids(
    spillover?: (wx: number, wy: number, wz: number, type: CubeType.Water | CubeType.Lava, level: number) => boolean,
    onChange?: (wx: number, wy: number, wz: number, blockType: CubeType) => void,
    tickLava = true,
  ): boolean {
    if (this.activeFluids.size === 0) return false;
    const S = this.size;
    const stride = CHUNK_SIZE * CHUNK_SIZE;
    const rowStride = CHUNK_SIZE;
    const topleftx = this.x - this.size / 2;
    const topleftz = this.y - this.size / 2;
    const emit = onChange
      ? (lx: number, ly: number, lz: number) => {
          const bt = this.blocks[ly * stride + lz * rowStride + lx] as CubeType;
          onChange(topleftx + lx, ly, topleftz + lz, bt);
        }
      : undefined;

    const current = this.activeFluids;
    const nextActive: Set<number> = new Set();
    let anyChange = false;

    // --- Pass 1: decay — collect unsupported flows and clear them. We do
    // this before the flow read-phase so supporters that would themselves
    // decay this tick still count as supporters for cells above them. The
    // cascade advances one layer per subsequent tick.
    const decayX: number[] = [];
    const decayY: number[] = [];
    const decayZ: number[] = [];

    // Pending placements applied after the read pass so a freshly-placed
    // fluid can't chain-react within the same tick.
    const changeX: number[] = [];
    const changeY: number[] = [];
    const changeZ: number[] = [];
    const changeType: (CubeType.Water | CubeType.Lava)[] = [];
    const changeLevel: number[] = [];

    for (const pos of current) {
      const x = pos & 0xff;
      const z = (pos >> 8) & 0xff;
      const y = pos >> 16;
      const idx = y * stride + z * rowStride + x;
      const type = this.blocks[idx] as CubeType;
      if (type !== CubeType.Water && type !== CubeType.Lava) continue; // stale entry (removed since last tick)
      if (!tickLava && type === CubeType.Lava) {
        // Lava runs on a slower cadence than water; keep the cell active so it
        // processes on the next lava tick.
        nextActive.add(pos);
        continue;
      }
      const level = this.fluidLevels[idx]!;
      const opp = type === CubeType.Water ? CubeType.Lava : CubeType.Water;

      if (level !== FLUID_SOURCE_LEVEL && !this.isFluidSupported(x, y, z, type, level)) {
        decayX.push(x);
        decayY.push(y);
        decayZ.push(z);
        continue; // skip flow on decaying cells
      }

      let flowedDown = false;
      if (y > 0) {
        const belowIdx = (y - 1) * stride + z * rowStride + x;
        if (this.blocks[belowIdx] === CubeType.Air) {
          changeX.push(x);
          changeY.push(y - 1);
          changeZ.push(z);
          changeType.push(type);
          changeLevel.push(1);
          flowedDown = true;
        } else if (this.blocks[belowIdx] === opp) {
          // Falling onto the opposite fluid hardens it directly; the flow
          // stops as if it had hit solid ground.
          this.blocks[belowIdx] = CubeType.Stone;
          this.fluidLevels[belowIdx] = 0;
          this.activateFluidNeighbours(x, y - 1, z);
          emit?.(x, y - 1, z);
          anyChange = true;
        }
      }

      let spreadLaterally = false;
      if (!flowedDown && level < FLUID_MAX_LEVEL) {
        const nextLevel = level + 1;
        for (let o = 0; o < LATERAL_FLOW_OFFSETS.length; o++) {
          const [dx, dz] = LATERAL_FLOW_OFFSETS[o]!;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nx >= S || nz < 0 || nz >= S) {
            if (spillover?.(topleftx + nx, y, topleftz + nz, type, nextLevel)) {
              spreadLaterally = true;
            }
            continue;
          }
          const nIdx = y * stride + nz * rowStride + nx;
          const nType = this.blocks[nIdx];
          if (nType === CubeType.Air) {
            changeX.push(nx);
            changeY.push(y);
            changeZ.push(nz);
            changeType.push(type);
            changeLevel.push(nextLevel);
            spreadLaterally = true;
          } else if (nType === opp) {
            this.blocks[nIdx] = CubeType.Stone;
            this.fluidLevels[nIdx] = 0;
            this.activateFluidNeighbours(nx, y, nz);
            emit?.(nx, y, nz);
            anyChange = true;
          }
        }
      }

      // Fully-surrounded sources drop out; re-woken by `activateCellIfFluid`
      // / `activateFluidNeighbours` on any neighbouring cell change.
      if (flowedDown || spreadLaterally) {
        nextActive.add(pos);
      } else if (level === FLUID_SOURCE_LEVEL && this.canFluidAct(x, y, z, type)) {
        nextActive.add(pos);
      }
    }

    // Swap in the filtered-for-next-tick active list FIRST so the write-phase
    // helpers (`applyFluidFlow`, `activateFluidNeighbours`) push into the new
    // list rather than the one we just iterated and are about to discard.
    this.activeFluids = nextActive;

    // Apply decay
    for (let n = 0; n < decayX.length; n++) {
      const x = decayX[n]!;
      const y = decayY[n]!;
      const z = decayZ[n]!;
      const idx = y * stride + z * rowStride + x;
      this.blocks[idx] = CubeType.Air;
      this.fluidLevels[idx] = 0;
      this.activateFluidNeighbours(x, y, z);
      emit?.(x, y, z);
      anyChange = true;
    }

    // Apply placements (respects air check + water/lava interaction rules)
    for (let n = 0; n < changeX.length; n++) {
      const x = changeX[n]!;
      const y = changeY[n]!;
      const z = changeZ[n]!;
      if (this.applyFluidFlow(x, y, z, changeType[n]!, changeLevel[n]!)) {
        emit?.(x, y, z);
        anyChange = true;
      }
    }

    return anyChange;
  }

  public renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void {
    const result = renderBlockData(this.blocks, this.heightMap, this.x, this.y, this.size, worldGet);
    this.cubes = result.numCubes;
    this.cubePositionsF32 = result.cubePositions;
    this.cubeColorsF32 = result.cubeColors;
    this.cubeAmbientOcclusionU8 = result.cubeAmbientOcclusion;
  }

  /** Returns the flat `Float32Array` of cube positions `[x, y, z, 0]` per cube. */
  public cubePositions(): Float32Array {
    return this.cubePositionsF32;
  }

  public cubeColors(): Float32Array {
    return this.cubeColorsF32;
  }

  public cubeAmbientOcclusion(): Uint8Array {
    return this.cubeAmbientOcclusionU8;
  }

  /** Returns a detached copy of the chunk's surface heights for minimap rendering. */
  public surfaceHeights(): Uint8Array {
    return this.heightMap.slice();
  }

  /** Returns a detached copy of the chunk's top-most block types for minimap rendering. */
  public surfaceTypes(): Uint8Array {
    return this.surfaceTypesMap.slice();
  }

  /** Returns the number of cubes to render this frame. */
  public numCubes(): number {
    return this.cubes;
  }
}

function opposingFluid(type: CubeType): CubeType.Water | CubeType.Lava | undefined {
  if (type === CubeType.Water) return CubeType.Lava;
  if (type === CubeType.Lava) return CubeType.Water;
  return undefined;
}
