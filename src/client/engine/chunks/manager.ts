import { CHUNK_SIZE, chunkOrigin } from "@/game/chunk";
import { type ChunkOrigin, type ChunkQueueArgs, type ChunkRenderData, ChunkWorkerClient } from "./client";

const RENDER_DISTANCE = 4;

/**
 * Main-thread coordinator that keeps the renderer fed with terrain data
 * from the chunk generation worker.
 */
export class ChunkManager {
  private readonly client: ChunkWorkerClient;
  private readonly seed: number;
  private lastOriginX = NaN;
  private lastOriginZ = NaN;
  private activeGeneration = 0;

  positions = new Float32Array(0);
  colors = new Float32Array(0);
  count = 0;

  constructor(spawnX: number, spawnZ: number, seed: number) {
    this.client = new ChunkWorkerClient();
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
      chunkOrigins: buildGenerationOrder(originX, originZ, RENDER_DISTANCE),
    };
    void this.load(args);
  }

  private async load(args: ChunkQueueArgs): Promise<void> {
    this.apply(await this.client.setVisibleChunks(args), args.generationId);
    while (args.generationId === this.activeGeneration) {
      const next = await this.client.generateNext(args);
      if (!next) return;
      this.apply(next, args.generationId);
    }
  }

  private apply(data: ChunkRenderData, generationId: number) {
    if (generationId !== this.activeGeneration) return;
    this.positions = data.cubePositions as Float32Array<ArrayBuffer>;
    this.colors = data.cubeColors as Float32Array<ArrayBuffer>;
    this.count = data.numCubes;
  }

  dispose(): void {
    this.client.dispose();
  }
}

function buildGenerationOrder(originX: number, originZ: number, renderDistance: number) {
  const origins: ChunkOrigin[] = [{ originX, originZ }];

  for (let radius = 1; radius <= renderDistance; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        origins.push({
          originX: originX + dx * CHUNK_SIZE,
          originZ: originZ + dz * CHUNK_SIZE,
        });
      }
    }
  }

  return origins;
}
