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
    const chunks = this.nearChunks;

    let totalLen = 0;
    for (const chunk of chunks) {
      totalLen += chunk.cubePositions().length;
    }

    const result = new Float32Array(totalLen);

    let offset = 0;
    for (const chunk of chunks) {
      const pos = chunk.cubePositions();
      result.set(pos, offset);
      offset += pos.length;
    }

    return result;
  }

  public getNearCubeColorsFlattened(): Float32Array {
    const chunks = this.nearChunks;

    let totalLen = 0;
    for (const chunk of chunks) {
      totalLen += chunk.cubeColors().length;
    }

    const result = new Float32Array(totalLen);

    let offset = 0;
    for (const chunk of chunks) {
      const col = chunk.cubeColors();
      result.set(col, offset);
      offset += col.length;
    }

    return result;
  }

  public getNearCubeSize(): number {
    return this.nearChunks.reduce((acc, chunk) => acc + chunk.numCubes(), 0);
  }

  public getMinYForCylinder(wx: number, wz: number, radius: number): number {
    const minCX = Math.floor(wx - radius);
    const maxCX = Math.floor(wx + radius);
    const minCZ = Math.floor(wz - radius);
    const maxCZ = Math.floor(wz + radius);

    let maxSurface = -Infinity;

    for (let gx = minCX; gx <= maxCX; gx++) {
      for (let gz = minCZ; gz <= maxCZ; gz++) {
        const nearX = Math.max(gx, Math.min(wx, gx + 1));
        const nearZ = Math.max(gz, Math.min(wz, gz + 1));
        const distSq = (wx - nearX) ** 2 + (wz - nearZ) ** 2;
        if (distSq >= radius * radius) continue; 

        const [originX, originZ] = chunkOrigin(gx, gz);
        const chunk = this.chunkMap.get(chunkKey(originX, originZ));
        if (!chunk) continue;

        const lx = gx - (originX - CHUNK_SIZE / 2);
        const lz = gz - (originZ - CHUNK_SIZE / 2);
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;

        const surfaceY = chunk.getSurfaceY(lx, lz);
        maxSurface = Math.max(maxSurface, surfaceY + 1);
      }
    }

    return maxSurface === -Infinity ? 0 : maxSurface;
  }

  public isCylinderClear(wx: number, wz: number, feetY: number, playerHeight: number, radius: number): boolean {
    const minCX = Math.floor(wx - radius);
    const maxCX = Math.floor(wx + radius);
    const minCZ = Math.floor(wz - radius);
    const maxCZ = Math.floor(wz + radius);

    for (let gx = minCX; gx <= maxCX; gx++) {
      for (let gz = minCZ; gz <= maxCZ; gz++) {
        const nearX = Math.max(gx, Math.min(wx, gx + 1));
        const nearZ = Math.max(gz, Math.min(wz, gz + 1));
        const distSq = (wx - nearX) ** 2 + (wz - nearZ) ** 2;
        if (distSq >= radius * radius) continue;

        const [originX, originZ] = chunkOrigin(gx, gz);
        const chunk = this.chunkMap.get(chunkKey(originX, originZ));
        // Unloaded chunk = treat as solid = not clear
        if (!chunk) return false;

        const lx = gx - (originX - CHUNK_SIZE / 2);
        const lz = gz - (originZ - CHUNK_SIZE / 2);
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return false;

        if (!chunk.isColumnClear(lx, lz, feetY, feetY + playerHeight)) {
          return false;
        }
      }
    }
    return true;
  }
}
