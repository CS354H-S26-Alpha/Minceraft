import { Mat4, type Mat4Like } from "gl-matrix";
import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_HEIGHT, CHUNK_SIZE, chunkKey, chunkOrigin } from "@/game/chunk";
import { Player } from "@/game/player";
import type { ChunkBatchData, ChunkOrigin, ChunkQueueArgs, SingleChunkData } from "./client";
import { aabbInFrustum, chunkAABB, extractFrustumPlanes } from "./frustum";

const RENDER_DISTANCE = 4;
const LOAD_DISTANCE = RENDER_DISTANCE + 1;
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

  /**
   * Minimum camera Y where the player can stand at `(wx, wz)` given their
   * current Y.
   */
  collisionQuery(wx: number, wz: number, currentY: number): number {
    const r = Player.CYLINDER_RADIUS;
    const r2 = r * r;
    const eye = Player.EYE_OFFSET;
    const headOffset = Player.CYLINDER_HEIGHT - eye;
    const x0 = Math.floor(wx - r);
    const x1 = Math.floor(wx + r);
    const z0 = Math.floor(wz - r);
    const z1 = Math.floor(wz + r);

    const scanCap = Math.min(CHUNK_HEIGHT - 1, Math.ceil(currentY + headOffset) - 1);
    if (scanCap < 0) return 0;

    let minCameraY = 0;
    let cachedOx = Number.NaN;
    let cachedOz = Number.NaN;
    let cachedChunk: SingleChunkData | undefined;

    for (let bx = x0; bx <= x1; bx++) {
      const cellX = wx < bx ? bx : wx > bx + 1 ? bx + 1 : wx;
      const ddx = wx - cellX;
      const ddx2 = ddx * ddx;
      if (ddx2 >= r2) continue;

      for (let bz = z0; bz <= z1; bz++) {
        const cellZ = wz < bz ? bz : wz > bz + 1 ? bz + 1 : wz;
        const ddz = wz - cellZ;
        if (ddx2 + ddz * ddz >= r2) continue;

        const [ox, oz] = chunkOrigin(bx, bz);
        if (ox !== cachedOx || oz !== cachedOz) {
          cachedOx = ox;
          cachedOz = oz;
          cachedChunk = this.chunkDataMap.get(chunkKey(ox, oz));
        }
        if (!cachedChunk) continue;
        const lx = bx - (ox - CHUNK_SIZE / 2);
        const lz = bz - (oz - CHUNK_SIZE / 2);
        const surface = cachedChunk.heightMap[lz * CHUNK_SIZE + lx]!;
        const start = surface < scanCap ? surface : scanCap;
        const blocks = cachedChunk.blocks;
        const colOffset = lz * CHUNK_SIZE + lx;
        const stride = CHUNK_SIZE * CHUNK_SIZE;
        for (let by = start; by >= 0; by--) {
          if (blocks[by * stride + colOffset] !== CubeType.Air) {
            const required = by + 1 + eye;
            if (required > minCameraY) minCameraY = required;
            break;
          }
        }
      }
    }

    return minCameraY;
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
