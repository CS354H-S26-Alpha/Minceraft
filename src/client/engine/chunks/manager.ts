import { CHUNK_SIZE, chunkKey, chunkOrigin } from "@/game/chunk";
import type { ChunkBatchData, ChunkOrigin, ChunkQueueArgs, SingleChunkData } from "./client";

const RENDER_DISTANCE = 1;

export interface ChunkClient {
  setVisibleChunks(args: ChunkQueueArgs): Promise<ChunkBatchData>;
  generateNext(args: ChunkQueueArgs): Promise<ChunkBatchData | null>;
  dispose(): void;
}

export class ChunkManager {
  private readonly client: ChunkClient;
  private readonly seed: number;
  private lastOriginX = NaN;
  private lastOriginZ = NaN;
  private activeGeneration = 0;

  private chunkDataMap = new Map<string, SingleChunkData>();
  private positionBuffer = new Float32Array(0);
  private colorBuffer = new Float32Array(0);

  positions = new Float32Array(0);
  colors = new Float32Array(0);
  count = 0;

  constructor(spawnX: number, spawnZ: number, seed: number, client: ChunkClient) {
    this.client = client;
    this.seed = seed;
    this.update(spawnX, spawnZ);
  }

  /** Starts a new chunk generation when the player enters a different chunk. */
  update(wx: number, wz: number): void {
    const [originX, originZ] = chunkOrigin(wx, wz);
    if (originX === this.lastOriginX && originZ === this.lastOriginZ) return;

    this.lastOriginX = originX;
    this.lastOriginZ = originZ;
    const generationId = ++this.activeGeneration;
    const args: ChunkQueueArgs = {
      generationId,
      originX,
      originZ,
      renderDistance: RENDER_DISTANCE,
      seed: this.seed,
      chunkOrigins: buildChunkOrigins(originX, originZ),
    };
    void this.load(args);
  }

  /** Concatenate all loaded chunks into flat render arrays. */
  buildRenderData(): void {
    let totalCubes = 0;
    for (const chunk of this.chunkDataMap.values()) totalCubes += chunk.numCubes;

    if (this.positionBuffer.length < totalCubes * 4) {
      this.positionBuffer = new Float32Array(totalCubes * 4);
    }
    if (this.colorBuffer.length < totalCubes * 3) {
      this.colorBuffer = new Float32Array(totalCubes * 3);
    }

    let posOffset = 0;
    let colOffset = 0;
    for (const chunk of this.chunkDataMap.values()) {
      this.positionBuffer.set(chunk.cubePositions, posOffset);
      posOffset += chunk.cubePositions.length;
      this.colorBuffer.set(chunk.cubeColors, colOffset);
      colOffset += chunk.cubeColors.length;
    }

    this.positions = this.positionBuffer.subarray(0, totalCubes * 4);
    this.colors = this.colorBuffer.subarray(0, totalCubes * 3);
    this.count = totalCubes;
  }

  private async load(args: ChunkQueueArgs): Promise<void> {
    this.applyBatch(await this.client.setVisibleChunks(args), args.generationId);
    while (args.generationId === this.activeGeneration) {
      const next = await this.client.generateNext(args);
      if (!next) return;
      this.applyBatch(next, args.generationId);
    }
  }

  private applyBatch(batch: ChunkBatchData, generationId: number) {
    if (generationId !== this.activeGeneration) return;
    this.chunkDataMap.clear();
    for (const chunk of batch.chunks) {
      this.chunkDataMap.set(chunkKey(chunk.originX, chunk.originZ), chunk);
    }
  }

  dispose(): void {
    this.client.dispose();
  }
}

/** Returns all 9 chunk origins in a 3x3 grid centered on (originX, originZ). */
function buildChunkOrigins(originX: number, originZ: number): ChunkOrigin[] {
  const origins: ChunkOrigin[] = [];
  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      origins.push({
        originX: originX + dx * CHUNK_SIZE,
        originZ: originZ + dz * CHUNK_SIZE,
      });
    }
  }
  return origins;
}
