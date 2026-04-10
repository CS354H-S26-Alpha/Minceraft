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
        for (let j = 0; j < CHUNK_SIZE; j++) {
            for (let i = 0; i < CHUNK_SIZE; i++) {
                const height = Math.floor(10.0 * rng.next());
                heightMap[j * CHUNK_SIZE + i] = height;
                blockGrid[
                    height * CHUNK_SIZE * CHUNK_SIZE + j * CHUNK_SIZE + i
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
        for (let j = 0; j < CHUNK_SIZE; j++) {
            for (let i = 0; i < CHUNK_SIZE; i++) {
                heightMap[j * CHUNK_SIZE + i] = this.height;
                blockGrid[
                    this.height * CHUNK_SIZE * CHUNK_SIZE + j * CHUNK_SIZE + i
                ] = this.blockType;
            }
        }
    }
}
