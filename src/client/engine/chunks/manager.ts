import { Mat4, type Mat4Like } from "gl-matrix";
import { CHUNK_SIZE, chunkKey, chunkOrigin } from "@/game/chunk";
import type { ChunkBatchData, ChunkOrigin, ChunkQueueArgs, SingleChunkData } from "./client";
import { aabbInFrustum, chunkAABB, extractFrustumPlanes } from "./frustum";

const RENDER_DISTANCE = 4;

export interface ChunkClient {
  setVisibleChunks(args: ChunkQueueArgs): Promise<ChunkBatchData>;
  generateNext(args: ChunkQueueArgs): Promise<ChunkBatchData | null>;
  dispose(): void;
}

/**
 * Main-thread coordinator that keeps the renderer fed with terrain data
 * from the chunk generation worker, with per-frame frustum culling.
 */
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

  constructor(
    spawnX: number,
    spawnZ: number,
    seed: number,
    client: ChunkClient,
    private readonly onChange?: () => void,
  ) {
    this.client = client;
    this.seed = seed;
    this.update(spawnX, spawnZ);
  }

  get minimapRadiusBlocks(): number {
    return RENDER_DISTANCE * CHUNK_SIZE;
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

  /** Frustum-cull chunks and concatenate visible ones into flat arrays. */
  cull(viewMatrix: Readonly<Mat4Like>, projMatrix: Readonly<Mat4Like>): void {
    const vp = Mat4.multiply(new Mat4(), projMatrix, viewMatrix) as Mat4;
    const planes = extractFrustumPlanes(vp);

    let totalCubes = 0;
    const visible: SingleChunkData[] = [];

    for (const chunk of this.chunkDataMap.values()) {
      const aabb = chunkAABB(chunk.originX, chunk.originZ);
      if (aabbInFrustum(aabb, planes)) {
        visible.push(chunk);
        totalCubes += chunk.numCubes;
      }
    }

    if (this.positionBuffer.length < totalCubes * 4) {
      this.positionBuffer = new Float32Array(totalCubes * 4);
    }
    if (this.colorBuffer.length < totalCubes * 3) {
      this.colorBuffer = new Float32Array(totalCubes * 3);
    }

    let posOffset = 0;
    let colOffset = 0;
    for (const chunk of visible) {
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
    this.onChange?.();
  }

  dispose(): void {
    this.client.dispose();
  }

  /**
   * Returns an encoded minimap sample for the highest block at (x, z).
   * High byte = `CubeType`, low byte = surface Y.
   */
  sampleSurface(wx: number, wz: number): number | undefined {
    const [originX, originZ] = chunkOrigin(wx, wz);
    const chunk = this.chunkDataMap.get(chunkKey(originX, originZ));
    if (!chunk) return undefined;

    const localX = wx - (originX - CHUNK_SIZE / 2);
    const localZ = wz - (originZ - CHUNK_SIZE / 2);
    if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) return undefined;

    const index = localZ * CHUNK_SIZE + localX;
    const blockType = chunk.surfaceTypes[index];
    const height = chunk.surfaceHeights[index];
    if (blockType === undefined || height === undefined) return undefined;
    return (blockType << 8) | height;
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
