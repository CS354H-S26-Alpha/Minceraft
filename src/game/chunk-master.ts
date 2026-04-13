import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "./chunk";

export class ChunkMaster {
  private chunkMap = new Map<string, Chunk>(); // pulls chunk by unique cordinate key
  private nearChunks: Chunk[] = [];
  private nearKeySignature = ""; // stringified set of current 3x3 keys — change detector
  private seed: number;

  constructor(spawnX: number, spawnZ: number, seed: number) {
    this.seed = seed;
    this.updateChunksAroundPos(spawnX, spawnZ);
  }

  /** Cross-chunk block lookup used for accurate edge culling during renderChunk.
   *  Unloaded chunks are treated as solid so faces at the world boundary don't render. */
  private worldGetBlock = (wx: number, wy: number, wz: number): CubeType => {
    const [ox, oz] = chunkOrigin(wx, wz);
    const chunk = this.chunkMap.get(chunkKey(ox, oz));
    if (!chunk) return CubeType.Stone; // unloaded = opaque, suppress boundary faces
    return chunk.getBlockWorld(wx, wy, wz);
  };

  public updateChunksAroundPos(wx: number, wz: number): Chunk[] {
    const [originX, originZ] = chunkOrigin(wx, wz);
    const chunks: Chunk[] = [];
    const keys: string[] = [];
    let anyNew = false;

    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const [chunkX, chunkZ] = [originX + cx * CHUNK_SIZE, originZ + cz * CHUNK_SIZE];
        const key = chunkKey(chunkX, chunkZ);
        keys.push(key);
        let chunk = this.chunkMap.get(key);
        if (!chunk) {
          chunk = new Chunk(chunkX, chunkZ, CHUNK_SIZE, this.seed);
          this.chunkMap.set(key, chunk);
          anyNew = true;
        }
        chunks.push(chunk);
      }
    }

    // Re-render all 9 chunks with cross-chunk neighbor awareness whenever the
    // grid shifts (i.e. a new chunk entered the 3x3). This corrects the edge
    // faces that were conservatively marked as exposed before neighbors existed.
    const signature = keys.join("|");
    if (anyNew || signature !== this.nearKeySignature) {
      for (const chunk of chunks) chunk.renderChunk(this.worldGetBlock);
      this.nearKeySignature = signature;
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
