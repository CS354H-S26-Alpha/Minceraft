/** biome-ignore-all lint/style/noNonNullAssertion: checks are bounded */
import { CUBE_TYPE_INFO, CubeType } from "@/client/engine/render/cube-types";
import { BIOME_INFOS, sampleColumn, surfaceBlock } from "@/game/biome";
import { perlin3D } from "@/utils/noise";

export const CHUNK_SIZE = 64;
export const CHUNK_HEIGHT = 128;

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

export class Chunk {
  // types where we store the actual block data
  public blocks: Uint8Array; // 3D block grid (CubeType per voxel): x z y // y*(S*S) + z*S + x
  public heightMap: Uint8Array; // surface height per (i,j) column x z // z*S + x
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

  constructor(centerX: number, centerY: number, size: number, seed: number) {
    this.x = centerX;
    this.y = centerY;
    this.size = size;
    this.seed = seed;

    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT); // with default value 0 = CubeType.Air
    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.surfaceTypesMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

    this.generateCubes();
    this.renderChunk(); // render on creation, might not be necessary
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

    // --- Pass 1: Base terrain fill ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const globalX = topleftx + j;
        const globalZ = topleftz + i;

        const { biome, height: rawHeight } = sampleColumn(this.seed, globalX, globalZ);
        const height = Math.max(1, Math.min(CHUNK_HEIGHT - 2, rawHeight));

        this.heightMap[this.size * i + j] = height;

        this.setBlock(j, 0, i, CubeType.Bedrock);
        for (let y = 1; y < height - 3; y++) {
          this.setBlock(j, y, i, CubeType.Stone);
        }
        for (let y = Math.max(1, height - 3); y < height; y++) {
          this.setBlock(j, y, i, BIOME_INFOS[biome].subsurface);
        }
        const surfaceType = surfaceBlock(biome, height);
        this.setBlock(j, height, i, surfaceType);
        this.surfaceTypesMap[this.size * i + j] = surfaceType;
      }
    }

    // --- Pass 2: Spaghetti cave carving (tunnel-like, follows noise zero-crossings) ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;
        const surfaceY = this.heightMap[this.size * i + j] as number;

        for (let y = 1; y <= surfaceY - 2; y++) {
          if (this.getBlock(j, y, i) === CubeType.Air) continue;

          const threshold = 0.12;

          const n1 = perlin3D(this.seed + 100, gx, y, gz, 1 / 64);
          if (Math.abs(n1) >= threshold) continue;
          const n2 = perlin3D(this.seed + 200, gx, y, gz, 1 / 64);
          if (Math.abs(n2) < threshold) {
            this.setBlock(j, y, i, CubeType.Air);
          }
        }
      }
    }

    // --- Pass 3: Ore placement (only in Stone blocks within depth ranges) ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;

        for (let y = 1; y < CHUNK_HEIGHT; y++) {
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
  }

  // worldGet: optional cross-chunk block lookup for accurate edge culling.
  // Without it, chunk-boundary faces are always treated as exposed (safe but over-renders).
  public renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void {
    const topleftx = this.x - this.size / 2;
    const topleftz = this.y - this.size / 2;
    const S = this.size;
    const hm = this.heightMap;

    // Cross-chunk aware air check for edge culling
    const isAir = (nlx: number, nly: number, nlz: number): boolean => {
      if (nly < 0) return false;
      if (nlx >= 0 && nlx < S && nlz >= 0 && nlz < S) {
        return this.getBlock(nlx, nly, nlz) === CubeType.Air;
      }
      if (worldGet) {
        return worldGet(topleftx + nlx, nly, topleftz + nlz) === CubeType.Air;
      }
      return true; // no neighbor data — treat edge as exposed
    };

    const touchesAir = (lx: number, ly: number, lz: number): boolean =>
      isAir(lx + 1, ly, lz) ||
      isAir(lx - 1, ly, lz) ||
      isAir(lx, ly + 1, lz) ||
      isAir(lx, ly - 1, lz) ||
      isAir(lx, ly, lz + 1) ||
      isAir(lx, ly, lz - 1);

    // Upper-bound count: surfaceY+1 blocks per column
    let total = 0;
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        total += hm[i * S + j]! + 1;
      }
    }

    const positions = new Float32Array(4 * total);
    const colors = new Float32Array(3 * total);
    const ambientOcclusion = new Uint8Array(24 * total);
    let count = 0;

    const isSolid = (nlx: number, nly: number, nlz: number): boolean => !isAir(nlx, nly, nlz);

    const writeCube = (blockType: CubeType, lx: number, y: number, lz: number, wx: number, wz: number): void => {
      const info = CUBE_TYPE_INFO[blockType];
      const c = info.baseColor;

      positions[4 * count] = wx;
      positions[4 * count + 1] = y;
      positions[4 * count + 2] = wz;
      positions[4 * count + 3] = blockType;

      colors[3 * count] = c[0];
      colors[3 * count + 1] = c[1];
      colors[3 * count + 2] = c[2];

      let aoOffset = 24 * count;
      for (const face of FACE_AMBIENT_OCCLUSION_SPECS) {
        const n = face.normal;
        for (const [sideA, sideB] of face.corners) {
          const side1 = isSolid(lx + n[0] + sideA[0], y + n[1] + sideA[1], lz + n[2] + sideA[2]);
          const side2 = isSolid(lx + n[0] + sideB[0], y + n[1] + sideB[1], lz + n[2] + sideB[2]);
          const corner = isSolid(
            lx + n[0] + sideA[0] + sideB[0],
            y + n[1] + sideA[1] + sideB[1],
            lz + n[2] + sideA[2] + sideB[2],
          );
          ambientOcclusion[aoOffset++] = vertexAmbientOcclusion(side1, side2, corner);
        }
      }

      count++;
    };

    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const idx = i * S + j;
        const surfY = hm[idx]!;
        const wx = topleftx + j;
        const wz = topleftz + i;

        for (let y = 0; y <= surfY; y++) {
          const blockType = this.getBlock(j, y, i);
          if (blockType === CubeType.Air || !touchesAir(j, y, i)) continue;
          writeCube(blockType, j, y, i, wx, wz);
        }
      }
    }

    this.cubes = count;
    // Edge culling may reduce count below total; subarray trims to exact size
    this.cubePositionsF32 = positions.subarray(0, 4 * count);
    this.cubeColorsF32 = colors.subarray(0, 3 * count);
    this.cubeAmbientOcclusionU8 = ambientOcclusion.subarray(0, 24 * count);
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
