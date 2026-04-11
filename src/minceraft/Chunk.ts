import Rand from "rand-seed";
import type { ITerrain } from "./Terrain";
import { CubeType, CUBE_TYPE_INFO } from "./CubeType";


export const CHUNK_SIZE = 64;
export const MAX_HEIGHT = 100;

export function chunkOrigin(wx: number, wz: number): [number, number] {
    return [
        Math.floor(wx / CHUNK_SIZE) * CHUNK_SIZE,
        Math.floor(wz / CHUNK_SIZE) * CHUNK_SIZE,
    ];
}

export function chunkKey(originX: number, originZ: number): string {
  return `${originX},${originZ}`;
}

export class Chunk {
    private cubes: number; // Number of cubes that should be *drawn* each frame
    private cubePositionsF32!: Float32Array; // (4 x cubes) array of cube translations, in homogeneous coordinates
    private cubeTypesF32!: Float32Array;     // (1 x cubes) array of block type per cube
    private cubeColorsF32!: Float32Array;    // (3 x cubes) array of precomputed RGB colors per cube
    private minX: number; // minimum x coordinate of the chunk (inclusive)
    private minZ: number; // minimum z coordinate of the chunk (inclusive)
    // private size: number; // Number of cubes along each side of the chunk

    private heightMap: Int32Array;
    private blockGrid: Uint8Array;

    constructor(
        centerX: number,
        centerZ: number,
        terrain: ITerrain,
        // size = CHUNK_SIZE,
    ) {
        [this.minX, this.minZ] = chunkOrigin(centerX, centerZ);
        this.heightMap = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
        this.blockGrid = new Uint8Array(MAX_HEIGHT * CHUNK_SIZE * CHUNK_SIZE);
        terrain.generate(this.heightMap, this.blockGrid);
        this.buildCubePositions();
    }

    // assumes all cubes we have are surface (render)
    private buildCubePositions(): void {
        this.cubes = CHUNK_SIZE * CHUNK_SIZE; // this is only surface level
        this.cubePositionsF32 = new Float32Array(4 * this.cubes);
        this.cubeTypesF32 = new Float32Array(this.cubes);
        this.cubeColorsF32 = new Float32Array(3 * this.cubes);

        // grid z and x
        for (let j = 0; j < CHUNK_SIZE; j++) {
            for (let i = 0; i < CHUNK_SIZE; i++) {
                const idx = CHUNK_SIZE * j + i;
                const height = this.heightMap[idx] ?? 0;
                this.cubePositionsF32[4 * idx + 0] = this.minX + j;
                this.cubePositionsF32[4 * idx + 1] = height;
                this.cubePositionsF32[4 * idx + 2] = this.minZ + i;
                this.cubePositionsF32[4 * idx + 3] = 0;

                const type = (this.blockGrid[height * CHUNK_SIZE * CHUNK_SIZE + j * CHUNK_SIZE + i] ?? 0) as CubeType;
                this.cubeTypesF32[idx] = type;
                const color = CUBE_TYPE_INFO[type]?.baseColor ?? [1.0, 0.0, 1.0];
                this.cubeColorsF32[3 * idx + 0] = color[0];
                this.cubeColorsF32[3 * idx + 1] = color[1];
                this.cubeColorsF32[3 * idx + 2] = color[2];
            }
        }
    }

    public cubePositions(): Float32Array {
        return this.cubePositionsF32;
    }

    public cubeColors(): Float32Array {
        return this.cubeColorsF32;
    }

    public numCubes(): number {
        return this.cubes;
    }

}
