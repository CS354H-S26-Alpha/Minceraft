import { CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "./chunk";

export class ChunkMaster {
  private chunkMap = new Map<string, Chunk>(); // pulls chunk by unique cordinate key
  private nearChunks: Chunk[] = [];
  private seed: number;

  constructor(spawnX: number, spawnZ: number, seed: number) {
    this.seed = seed;
    this.updateChunksAroundPos(spawnX, spawnZ);
  }

  public updateChunksAroundPos(wx: number, wz: number): Chunk[] {
    const [originX, originZ] = chunkOrigin(wx, wz);
    const chunks: Chunk[] = [];
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const [chunkX, chunkZ] = [originX + cx * CHUNK_SIZE, originZ + cz * CHUNK_SIZE];
        const chunk = this.chunkMap.get(chunkKey(chunkX, chunkZ));
        if (chunk) {
          chunks.push(chunk);
        } else {
          // compute chunk, add to map, add to near chunks
          const newChunk = new Chunk(chunkX, chunkZ, CHUNK_SIZE, this.seed);
          this.chunkMap.set(chunkKey(chunkX, chunkZ), newChunk);
          chunks.push(newChunk);
        }
      }
    }
    this.nearChunks = chunks;
    return chunks;
  }

  public getNearCubePositionsFlattened(): Float32Array {
    return new Float32Array(this.nearChunks.flatMap((chunk) => Array.from(chunk.cubePositions())));
  }

  public getNearCubeColorsFlattened(): Float32Array {
    return new Float32Array(this.nearChunks.flatMap((chunk) => Array.from(chunk.cubeColors())));
  }

  public getNearCubeSize(): number {
    return this.nearChunks.reduce((acc, chunk) => acc + chunk.numCubes(), 0);
  }
}
