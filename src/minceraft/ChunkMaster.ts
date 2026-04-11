import { Chunk, CHUNK_SIZE, chunkKey, chunkOrigin } from "./Chunk";
import { type ITerrain } from "./Terrain";

export class ChunkMaster {
    private chunkMap = new Map<string, Chunk>(); // pulls chunk by unique cordinate key
    private terrain: ITerrain;

    constructor(startX: number, startZ: number, terrain: ITerrain) {
        this.terrain = terrain;
        for (let cx = -1; cx <= 1; cx++) {
            for (let cz = -1; cz <= 1; cz++) {
                const [originX, originZ] = [
                    startX + cx * CHUNK_SIZE,
                    startZ + cz * CHUNK_SIZE,
                ];
                const chunk = new Chunk(originX, originZ, terrain);
                this.chunkMap.set(chunkKey(originX, originZ), chunk);
            }
        }
    }

    public getChunksAroundPos(wx: number, wz: number): Chunk[] {
        const [originX, originZ] = chunkOrigin(wx, wz);
        const chunks: Chunk[] = [];
        for (let cx = -1; cx <= 1; cx++) {
            for (let cz = -1; cz <= 1; cz++) {
                const [chunkX, chunkZ] = [
                    originX + cx * CHUNK_SIZE,
                    originZ + cz * CHUNK_SIZE,
                ];
                const chunk = this.chunkMap.get(chunkKey(chunkX, chunkZ));
                if (chunk) {
                    chunks.push(chunk);
                } else {
                    const newChunk = new Chunk(chunkX, chunkZ, this.terrain);
                    this.chunkMap.set(chunkKey(chunkX, chunkZ), newChunk);
                    chunks.push(newChunk);
                }
            }
        }
        return chunks;
    }
}
