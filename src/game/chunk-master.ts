import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "./chunk";

const CHUNK_RENDER_DISTANCE = 4; // TODO: move into settings

export class ChunkMaster {
  private chunkMap = new Map<string, Chunk>();
  private seed: number;
  private lastOriginX = NaN;
  private lastOriginZ = NaN;

  private cachedPositions = new Float32Array(0);
  private cachedColors = new Float32Array(0);
  private cachedCubeCount = 0;

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

  public updateChunksAroundPos(wx: number, wz: number): void {
    const [originX, originZ] = chunkOrigin(wx, wz);
    if (originX === this.lastOriginX && originZ === this.lastOriginZ) return;
    this.lastOriginX = originX;
    this.lastOriginZ = originZ;

    const chunks: Chunk[] = [];
    let anyNew = false;

    for (let cx = -CHUNK_RENDER_DISTANCE; cx <= CHUNK_RENDER_DISTANCE; cx++) {
      for (let cz = -CHUNK_RENDER_DISTANCE; cz <= CHUNK_RENDER_DISTANCE; cz++) {
        const chunkX = originX + cx * CHUNK_SIZE;
        const chunkZ = originZ + cz * CHUNK_SIZE;
        const key = chunkKey(chunkX, chunkZ);
        let chunk = this.chunkMap.get(key);
        if (!chunk) {
          chunk = new Chunk(chunkX, chunkZ, CHUNK_SIZE, this.seed);
          this.chunkMap.set(key, chunk);
          anyNew = true;
        }
        chunks.push(chunk);
      }
    }

    // Re-render chunks with cross-chunk neighbor awareness when new chunks
    // enter the grid, correcting edge faces that were conservatively exposed.
    if (anyNew) {
      for (const chunk of chunks) chunk.renderChunk(this.worldGetBlock);
    }

    this.rebuildCache(chunks);
  }

  private rebuildCache(chunks: Chunk[]): void {
    let totalPos = 0;
    let totalCol = 0;
    let totalCubes = 0;
    for (const chunk of chunks) {
      totalPos += chunk.cubePositions().length;
      totalCol += chunk.cubeColors().length;
      totalCubes += chunk.numCubes();
    }

    const positions = new Float32Array(totalPos);
    const colors = new Float32Array(totalCol);
    let posOff = 0;
    let colOff = 0;
    for (const chunk of chunks) {
      const pos = chunk.cubePositions();
      positions.set(pos, posOff);
      posOff += pos.length;
      const col = chunk.cubeColors();
      colors.set(col, colOff);
      colOff += col.length;
    }

    this.cachedPositions = positions;
    this.cachedColors = colors;
    this.cachedCubeCount = totalCubes;
  }

  public getNearCubePositionsFlattened(): Float32Array {
    return this.cachedPositions;
  }

  public getNearCubeColorsFlattened(): Float32Array {
    return this.cachedColors;
  }

  public getNearCubeSize(): number {
    return this.cachedCubeCount;
  }
}
