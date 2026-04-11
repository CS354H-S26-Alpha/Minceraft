import { CubeType } from "./CubeType";
import { CHUNK_SIZE } from "./Chunk";
import Rand from "rand-seed";

export interface ITerrain {
    generate(heightMap: Int32Array, blockGrid: Uint8Array): void;
}

export class NoTerrain implements ITerrain {
    generate(heightMap: Int32Array, blockGrid: Uint8Array): void {
        const seed = "42";
        let rng = new Rand(seed);
        for (let i = 0; i < CHUNK_SIZE; i++) {
            for (let j = 0; j < CHUNK_SIZE; j++) {
                const height = Math.floor(10.0 * rng.next());
                heightMap[i * CHUNK_SIZE + j] = height;
                blockGrid[
                    height * CHUNK_SIZE * CHUNK_SIZE + i * CHUNK_SIZE + j
                ] = CubeType.White;
            }
        }
    }
}

export class FlatTerrain implements ITerrain {
    constructor(
        private readonly blockType: CubeType = CubeType.Grass,
        private readonly height: number = 50,
    ) {}

    generate(heightMap: Int32Array, blockGrid: Uint8Array): void {
        for (let i = 0; i < CHUNK_SIZE; i++) {
            for (let j = 0; j < CHUNK_SIZE; j++) {
                heightMap[i * CHUNK_SIZE + j] = this.height;
                blockGrid[
                    this.height * CHUNK_SIZE * CHUNK_SIZE + i * CHUNK_SIZE + j
                ] = this.blockType;
            }
        }
    }
}
