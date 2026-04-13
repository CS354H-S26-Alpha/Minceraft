import { CUBE_TYPE_INFO, CubeType } from "@/client/engine/render/cube-types";
import { BIOME_INFOS, sampleColumn, surfaceBlock } from "@/game/biome";

export const CHUNK_SIZE = 64;
export const CHUNK_HEIGHT = 128;

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

  private x: number; // Center of the chunk
  private y: number;
  private size: number; // Number of cubes along each side of the chunk
  private seed: number; // Seed for terrain generation

  // types to update for Rendering
  private cubes: number = 0;
  private cubePositionsF32: Float32Array = new Float32Array(0);
  private cubeColorsF32: Float32Array = new Float32Array(0);

  constructor(centerX: number, centerY: number, size: number, seed: number) {
    this.x = centerX;
    this.y = centerY;
    this.size = size;
    this.seed = seed;

    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT); // with default value 0 = CubeType.Air
    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

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

  // calculate block types for every position in the chunk
  private generateCubes(): void {
    const topleftx = this.x - this.size / 2;
    const toplefty = this.y - this.size / 2;

    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const globalX = topleftx + j;
        const globalZ = toplefty + i;

        const { biome, height: rawHeight } = sampleColumn(this.seed, globalX, globalZ);
        const height = Math.max(1, Math.min(CHUNK_HEIGHT - 2, rawHeight));

        this.heightMap[this.size * i + j] = height;

        // TODO replace by perlin noise for block variation and features
        this.setBlock(j, 0, i, CubeType.Bedrock);
        for (let y = 1; y < height - 3; y++) {
          this.setBlock(j, y, i, CubeType.Stone);
        }
        for (let y = Math.max(1, height - 3); y < height; y++) {
          this.setBlock(j, y, i, BIOME_INFOS[biome].subsurface);
        }
        this.setBlock(j, height, i, surfaceBlock(biome, height));
      }
    }
  }

  // basic rendering for blocks touching air
  // worldGet: optional cross-chunk block lookup for accurate edge culling.
  // Without it, chunk-boundary faces are always treated as exposed (safe but over-renders).
  public renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void {
    const topleftx = this.x - this.size / 2;
    const toplefty = this.y - this.size / 2;

    const isAir = (nlx: number, nly: number, nlz: number): boolean => {
      if (nlx >= 0 && nlx < this.size && nlz >= 0 && nlz < this.size) {
        return this.getBlock(nlx, nly, nlz) === CubeType.Air;
      }
      if (worldGet) {
        return worldGet(topleftx + nlx, nly, toplefty + nlz) === CubeType.Air;
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

    const maxCubes = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
    const positions = new Float32Array(4 * maxCubes);
    const colors = new Float32Array(3 * maxCubes);
    let count = 0;

    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const surfaceY = this.heightMap[this.size * i + j] as number;

        for (let y = 0; y <= surfaceY; y++) {
          const blockType = this.getBlock(j, y, i);

          // if it is air or next to air, it should be rendered
          if (blockType === CubeType.Air || !touchesAir(j, y, i)) continue;

          positions[4 * count + 0] = topleftx + j;
          positions[4 * count + 1] = y;
          positions[4 * count + 2] = toplefty + i;
          positions[4 * count + 3] = 0;

          const color = CUBE_TYPE_INFO[blockType].baseColor;
          colors[3 * count + 0] = color[0];
          colors[3 * count + 1] = color[1];
          colors[3 * count + 2] = color[2];

          count++;
        }
      }
    }

    this.cubes = count;
    this.cubePositionsF32 = positions.subarray(0, 4 * count) as Float32Array;
    this.cubeColorsF32 = colors.subarray(0, 3 * count) as Float32Array;
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
