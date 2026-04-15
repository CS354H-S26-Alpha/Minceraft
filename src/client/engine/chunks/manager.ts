import { Mat4, type Mat4Like } from "gl-matrix";
import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "@/game/chunk";
import type { ChunkBatchData, ChunkOrigin, ChunkQueueArgs, SingleChunkData } from "./client";
import { aabbInFrustum, chunkAABB, extractFrustumPlanes } from "./frustum";

const RENDER_DISTANCE = 1;
const LOAD_DISTANCE = RENDER_DISTANCE + 2;
const EVICT_DISTANCE = LOAD_DISTANCE + 2;

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

  constructor(seed: number, client: ChunkClient) {
    this.client = client;
    this.seed = seed;
  }

  private buildArgs(generationId: number, originX: number, originZ: number): ChunkQueueArgs {
    return {
      generationId,
      originX,
      originZ,
      renderDistance: RENDER_DISTANCE,
      loadDistance: LOAD_DISTANCE,
      evictDistance: EVICT_DISTANCE,
      seed: this.seed,
      chunkOrigins: buildGenerationOrder(originX, originZ, LOAD_DISTANCE),
    };
  }

  /** Starts a new chunk generation when the player enters a different chunk. */
  update(wx: number, wz: number): void {
    const [originX, originZ] = chunkOrigin(wx, wz);
    if (originX === this.lastOriginX && originZ === this.lastOriginZ) return;

    this.lastOriginX = originX;
    this.lastOriginZ = originZ;
    const generationId = ++this.activeGeneration;

    const args = this.buildArgs(generationId, originX, originZ);
    void this.load(args);
  }

  reset(): void {
    this.lastOriginX = NaN;
    this.lastOriginZ = NaN;
  }

  /** Minimum camera Y where the player cylinder can stand at `(wx, wz)`. */
  collisionQuery(wx: number, wz: number): number {
    return Chunk.minYForCylinderWorld(wx, wz, (bx, by, bz) => this.getBlockWorld(bx, by, bz));
  }

  private getBlockWorld(wx: number, wy: number, wz: number): CubeType {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return CubeType.Air;
    const [ox, oz] = chunkOrigin(wx, wz);
    const chunk = this.chunkDataMap.get(chunkKey(ox, oz));
    if (!chunk) return CubeType.Air;
    const lx = wx - (ox - CHUNK_SIZE / 2);
    const lz = wz - (oz - CHUNK_SIZE / 2);
    return chunk.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] as CubeType;
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

  private applyBatch(batch: ChunkBatchData, generationId: number): void {
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

function buildGenerationOrder(originX: number, originZ: number, loadDistance: number): ChunkOrigin[] {
  const origins: ChunkOrigin[] = [{ originX, originZ }];

  for (let radius = 1; radius <= loadDistance; radius++) {
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
