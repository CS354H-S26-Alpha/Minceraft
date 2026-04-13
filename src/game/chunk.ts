import { CUBE_TYPE_INFO, CubeType } from "@/client/engine/render/cube-types";
import { terrainHeight } from "@/lib/noise";

export const CHUNK_SIZE = 64;

export function chunkKey(originX: number, originZ: number): string {
  return `${originX},${originZ}`;
}

export function chunkOrigin(wx: number, wz: number): [number, number] {
  return [
    Math.floor((wx + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
    Math.floor((wz + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
  ];
}

/**
 * A square patch of terrain. Generates cube positions procedurally using
 * multi-octave value noise and exposes them as a flat `Float32Array` for the GPU.
 */
export class Chunk {
  private cubes: number; // Number of cubes that should be *drawn* each frame
  private cubePositionsF32!: Float32Array; // (4 x cubes) array of cube translations, in homogeneous coordinates
  private cubeColorsF32!: Float32Array;
  private x: number; // Center of the chunk
  private y: number;
  private size: number; // Number of cubes along each side of the chunk
  private seed: number; // Seed for terrain generation

  constructor(centerX: number, centerY: number, size: number, seed: number) {
    this.x = centerX;
    this.y = centerY;
    this.size = size;
    this.cubes = size * size;
    this.seed = seed;
    this.generateCubes();
  }

  private generateCubes() {
    const topleftx = this.x - this.size / 2;
    const toplefty = this.y - this.size / 2;

    this.cubes = this.size * this.size;
    this.cubePositionsF32 = new Float32Array(4 * this.cubes);
    this.cubeColorsF32 = new Float32Array(3 * this.cubes);

    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        // Use global coordinates for seamless chunks
        const globalX = topleftx + j;
        const globalZ = toplefty + i;

        // Get height using 3 octaves [0, 100]
        const height = terrainHeight(this.seed, globalX, globalZ);

        const idx = this.size * i + j;
        this.cubePositionsF32[4 * idx + 0] = globalX;
        this.cubePositionsF32[4 * idx + 1] = height;
        this.cubePositionsF32[4 * idx + 2] = globalZ;
        this.cubePositionsF32[4 * idx + 3] = 0;

        // edge cubes are black for debugging chunk boundaries
        let type: CubeType = height < 50 ? CubeType.White : CubeType.Grass;
        if (i === 0 || j === 0 || i === this.size - 1 || j === this.size - 1) {
          type = CubeType.Black;
        }
        const color = CUBE_TYPE_INFO[type].baseColor ?? [1.0, 1.0, 1.0];
        this.cubeColorsF32[3 * idx + 0] = color[0];
        this.cubeColorsF32[3 * idx + 1] = color[1];
        this.cubeColorsF32[3 * idx + 2] = color[2];
      }
    }
  }

  /** Returns the flat `Float32Array` of cube positions `[x, y, z, 0]` per cube. */
  public cubePositions(): Float32Array {
    return this.cubePositionsF32;
  }

  public cubeColors(): Float32Array {
    return this.cubeColorsF32;
  }

  /** Returns the number of cubes to render this frame. */
  public numCubes(): number {
    return this.cubes;
  }
}
