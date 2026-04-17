/** biome-ignore-all lint/style/noNonNullAssertion: typed-array hot path with bounded indices */
import { Mat4, type Mat4Like } from "gl-matrix";
import { CubeType } from "@/client/engine/render/cube-types";
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  chunkKey,
  chunkOrigin,
  renderBlockData,
  SECTION_SIZE,
  sectionIndex,
  sectionRegion,
  updateColumnSurface,
} from "@/game/chunk";
import { Player } from "@/game/player";
import type { ChunkBatchData, SingleChunkData } from "./client";
import { aabbInFrustum, chunkAABB, extractFrustumPlanes } from "./frustum";

export const DEFAULT_RENDER_DISTANCE = 4;
export const MIN_RENDER_DISTANCE = 1;
export const MAX_RENDER_DISTANCE = 4;
const EVICT_PADDING = 2;
const INGEST_PER_FRAME = 3;

export interface ChunkClient {
  loadChunks(chunks: Array<{ originX: number; originZ: number; blocks: Uint8Array }>): Promise<ChunkBatchData>;
  syncBlock(wx: number, wy: number, wz: number, blockType: number): void;
  clearCache(): Promise<void>;
  dispose(): void;
}

/**
 * Main-thread coordinator that receives server-pushed chunk data, dispatches
 * to the mesh-building worker, and feeds frustum-culled render arrays to the
 * renderer each frame.
 */
export class ChunkManager {
  private readonly client: ChunkClient;
  private renderDistance: number;
  private lastOriginX = NaN;
  private lastOriginZ = NaN;

  private chunkDataMap = new Map<string, SingleChunkData>();
  private localOverrides = new Map<string, Map<number, CubeType>>();
  private ingestQueue: Array<{ originX: number; originZ: number; blocks: Uint8Array }> = [];
  private workerBusy = false;
  private resetGeneration = 0;
  private positionBuffer = new Float32Array(0);
  private colorBuffer = new Float32Array(0);
  private ambientOcclusionBuffer = new Uint8Array(0);
  private dirty = true;
  private lastVisibleChunks: SingleChunkData[] = [];

  positions = new Float32Array(0);
  colors = new Float32Array(0);
  ambientOcclusion = new Uint8Array(0);
  count = 0;

  constructor(
    client: ChunkClient,
    renderDistance: number = DEFAULT_RENDER_DISTANCE,
    private readonly onChange?: () => void,
  ) {
    this.client = client;
    this.renderDistance = clampRenderDistance(renderDistance);
  }

  get minimapRadiusBlocks(): number {
    return this.renderDistance * CHUNK_SIZE;
  }

  /** Queues server-pushed chunk data for incremental ingestion. */
  receiveChunks(chunks: Array<{ originX: number; originZ: number; blocks: Uint8Array }>): void {
    this.ingestQueue.push(...chunks);
  }

  /**
   * Processes a limited batch of queued chunks per frame, sending them to the
   * worker for mesh building. Call once per rAF frame to spread the load.
   */
  processIncoming(): void {
    if (this.workerBusy || this.ingestQueue.length === 0) return;
    const batch = this.ingestQueue.splice(0, INGEST_PER_FRAME);
    this.workerBusy = true;
    const gen = this.resetGeneration;
    void this.client.loadChunks(batch).then((result) => {
      this.workerBusy = false;
      if (gen !== this.resetGeneration) return;
      this.mergeBatch(result);
    });
  }

  /** Evicts chunks that are too far from the player's current position. */
  update(wx: number, wz: number): void {
    const [originX, originZ] = chunkOrigin(wx, wz);
    if (originX === this.lastOriginX && originZ === this.lastOriginZ) return;
    this.lastOriginX = originX;
    this.lastOriginZ = originZ;
    this.evictDistant(originX, originZ);
  }

  setRenderDistance(renderDistance: number): void {
    const next = clampRenderDistance(renderDistance);
    if (next === this.renderDistance) return;
    this.renderDistance = next;
    this.dirty = true;
  }

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
        const surface = cachedChunk.surfaceHeights[lz * CHUNK_SIZE + lx]!;
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

  /**
   * Max eye Y allowed at (wx, wz) given current eye height. Scans upward from
   * the current head top within the cylinder footprint; the first solid block's
   * bottom caps the head. Returns +Infinity when no ceiling is in range.
   */
  headQuery(wx: number, wz: number, eyeY: number): number {
    const r = Player.CYLINDER_RADIUS;
    const r2 = r * r;
    const eye = Player.EYE_OFFSET;
    const headOffset = Player.CYLINDER_HEIGHT - eye;
    const scanFrom = Math.floor(eyeY + headOffset);
    if (scanFrom >= CHUNK_HEIGHT) return Number.POSITIVE_INFINITY;

    const x0 = Math.floor(wx - r);
    const x1 = Math.floor(wx + r);
    const z0 = Math.floor(wz - r);
    const z1 = Math.floor(wz + r);

    let maxEyeY = Number.POSITIVE_INFINITY;
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
        const blocks = cachedChunk.blocks;
        const colOffset = lz * CHUNK_SIZE + lx;
        const stride = CHUNK_SIZE * CHUNK_SIZE;
        for (let by = scanFrom; by < CHUNK_HEIGHT; by++) {
          if (blocks[by * stride + colOffset] !== CubeType.Air) {
            const allowed = by - headOffset;
            if (allowed < maxEyeY) maxEyeY = allowed;
            break;
          }
        }
      }
    }

    return maxEyeY;
  }

  /** Returns true if the chunk containing the given world coordinates is loaded. */
  hasChunkAt(wx: number, wz: number): boolean {
    const [originX, originZ] = chunkOrigin(wx, wz);
    return this.chunkDataMap.has(chunkKey(originX, originZ));
  }

  /** Returns the block type at the given world coordinates, or Air if the chunk is not loaded. */
  getBlock(wx: number, wy: number, wz: number): CubeType {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return CubeType.Air;
    const [originX, originZ] = chunkOrigin(wx, wz);
    const chunk = this.chunkDataMap.get(chunkKey(originX, originZ));
    if (!chunk) return CubeType.Air;
    const lx = wx - (originX - CHUNK_SIZE / 2);
    const lz = wz - (originZ - CHUNK_SIZE / 2);
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return CubeType.Air;
    return (chunk.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] ?? CubeType.Air) as CubeType;
  }

  /**
   * Modifies a block and immediately rebuilds only the affected 16x16x16
   * section(s) on the main thread. With sections, the rebuild takes ~0.2ms
   * per section — fast enough for synchronous visual updates with correct AO.
   */
  modifyBlock(wx: number, wy: number, wz: number, newType: CubeType): CubeType | null {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return null;
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    const chunk = this.chunkDataMap.get(key);
    if (!chunk) return null;

    const lx = wx - (originX - CHUNK_SIZE / 2);
    const lz = wz - (originZ - CHUNK_SIZE / 2);
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return null;

    const index = wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    const previousType = (chunk.blocks[index] ?? CubeType.Air) as CubeType;
    chunk.blocks[index] = newType;

    let overrides = this.localOverrides.get(key);
    if (!overrides) {
      overrides = new Map();
      this.localOverrides.set(key, overrides);
    }
    overrides.set(index, newType);

    updateColumnSurface(chunk.blocks, chunk.surfaceHeights, chunk.surfaceTypes, lx, lz, wy, newType, CHUNK_SIZE);

    // Rebuild only the dirty section(s) and splice into chunk render arrays
    const worldGet = (bwx: number, bwy: number, bwz: number) =>
      this.getBlock(Math.floor(bwx), Math.floor(bwy), Math.floor(bwz));
    const dirtyIdx = sectionIndex(lx, wy, lz);
    const dirtySet = new Set<number>([dirtyIdx]);
    if (lx % SECTION_SIZE === 0 && lx > 0) dirtySet.add(sectionIndex(lx - 1, wy, lz));
    if (lx % SECTION_SIZE === SECTION_SIZE - 1 && lx < CHUNK_SIZE - 1) dirtySet.add(sectionIndex(lx + 1, wy, lz));
    if (lz % SECTION_SIZE === 0 && lz > 0) dirtySet.add(sectionIndex(lx, wy, lz - 1));
    if (lz % SECTION_SIZE === SECTION_SIZE - 1 && lz < CHUNK_SIZE - 1) dirtySet.add(sectionIndex(lx, wy, lz + 1));
    if (wy % SECTION_SIZE === 0 && wy > 0) dirtySet.add(sectionIndex(lx, wy - 1, lz));
    if (wy % SECTION_SIZE === SECTION_SIZE - 1 && wy < CHUNK_HEIGHT - 1) dirtySet.add(sectionIndex(lx, wy + 1, lz));

    this.rebuildSections(chunk, originX, originZ, dirtySet, worldGet);

    // If at chunk edge, rebuild the neighbor chunk's adjacent section too
    if (lx === 0) this.rebuildNeighborSection(originX - CHUNK_SIZE, originZ, CHUNK_SIZE - 1, lz, wy, worldGet);
    else if (lx === CHUNK_SIZE - 1) this.rebuildNeighborSection(originX + CHUNK_SIZE, originZ, 0, lz, wy, worldGet);
    if (lz === 0) this.rebuildNeighborSection(originX, originZ - CHUNK_SIZE, lx, CHUNK_SIZE - 1, wy, worldGet);
    else if (lz === CHUNK_SIZE - 1) this.rebuildNeighborSection(originX, originZ + CHUNK_SIZE, lx, 0, wy, worldGet);

    this.client.syncBlock(wx, wy, wz, newType);
    this.dirty = true;
    this.onChange?.();
    return previousType;
  }

  /**
   * Re-renders the specified sections and rebuilds the chunk's concatenated
   * render arrays from the section offset/count metadata.
   */
  private rebuildSections(
    chunk: SingleChunkData,
    originX: number,
    originZ: number,
    dirtySet: Set<number>,
    worldGet: (wx: number, wy: number, wz: number) => CubeType,
  ): void {
    // Re-render each dirty section
    const newSectionData = new Map<number, { pos: Float32Array; col: Float32Array; ao: Uint8Array; count: number }>();
    for (const idx of dirtySet) {
      const region = sectionRegion(idx);
      const result = renderBlockData(
        chunk.blocks,
        chunk.surfaceHeights,
        originX,
        originZ,
        CHUNK_SIZE,
        worldGet,
        region,
      );
      newSectionData.set(idx, {
        pos: result.cubePositions,
        col: result.cubeColors,
        ao: result.cubeAmbientOcclusion,
        count: result.numCubes,
      });
    }

    // Compute new total size
    let totalCubes = 0;
    const sectionCount = chunk.sectionOffsets.length;
    for (let i = 0; i < sectionCount; i++) {
      totalCubes += newSectionData.has(i) ? newSectionData.get(i)!.count : chunk.sectionCounts[i]!;
    }

    // Build new concatenated arrays
    const newPos = new Float32Array(totalCubes * 4);
    const newCol = new Float32Array(totalCubes * 3);
    const newAO = new Uint8Array(totalCubes * 24);
    const newOffsets = new Uint32Array(sectionCount);
    const newCounts = new Uint16Array(sectionCount);
    let offset = 0;

    for (let i = 0; i < sectionCount; i++) {
      newOffsets[i] = offset;
      const updated = newSectionData.get(i);
      if (updated) {
        newPos.set(updated.pos, offset * 4);
        newCol.set(updated.col, offset * 3);
        newAO.set(updated.ao, offset * 24);
        newCounts[i] = updated.count;
        offset += updated.count;
      } else {
        const oldOff = chunk.sectionOffsets[i]!;
        const oldCount = chunk.sectionCounts[i]!;
        if (oldCount > 0) {
          newPos.set(chunk.cubePositions.subarray(oldOff * 4, (oldOff + oldCount) * 4), offset * 4);
          newCol.set(chunk.cubeColors.subarray(oldOff * 3, (oldOff + oldCount) * 3), offset * 3);
          newAO.set(chunk.cubeAmbientOcclusion.subarray(oldOff * 24, (oldOff + oldCount) * 24), offset * 24);
        }
        newCounts[i] = oldCount;
        offset += oldCount;
      }
    }

    chunk.cubePositions = newPos;
    chunk.cubeColors = newCol;
    chunk.cubeAmbientOcclusion = newAO;
    chunk.numCubes = totalCubes;
    chunk.sectionOffsets = newOffsets;
    chunk.sectionCounts = newCounts;
  }

  private rebuildNeighborSection(
    adjOriginX: number,
    adjOriginZ: number,
    nlx: number,
    nlz: number,
    wy: number,
    worldGet: (wx: number, wy: number, wz: number) => CubeType,
  ): void {
    const adjKey = chunkKey(adjOriginX, adjOriginZ);
    const adjChunk = this.chunkDataMap.get(adjKey);
    if (!adjChunk) return;
    this.rebuildSections(adjChunk, adjOriginX, adjOriginZ, new Set([sectionIndex(nlx, wy, nlz)]), worldGet);
  }

  /** Frustum-cull chunks and concatenate visible ones into flat arrays. */
  cull(viewMatrix: Readonly<Mat4Like>, projMatrix: Readonly<Mat4Like>): void {
    const vp = Mat4.multiply(new Mat4(), projMatrix, viewMatrix) as Mat4;
    const planes = extractFrustumPlanes(vp);

    let totalCubes = 0;
    const visible: SingleChunkData[] = [];

    for (const chunk of this.chunkDataMap.values()) {
      // Distance cull: skip chunks beyond render distance
      const dx = Math.abs(chunk.originX - this.lastOriginX) / CHUNK_SIZE;
      const dz = Math.abs(chunk.originZ - this.lastOriginZ) / CHUNK_SIZE;
      if (Math.max(dx, dz) > this.renderDistance) continue;

      const aabb = chunkAABB(chunk.originX, chunk.originZ);
      if (aabbInFrustum(aabb, planes)) {
        visible.push(chunk);
        totalCubes += chunk.numCubes;
      }
    }

    if (
      !this.dirty &&
      visible.length === this.lastVisibleChunks.length &&
      visible.every((c, i) => c === this.lastVisibleChunks[i])
    ) {
      return;
    }

    this.lastVisibleChunks = visible;
    this.dirty = false;

    if (this.positionBuffer.length < totalCubes * 4) {
      this.positionBuffer = new Float32Array(totalCubes * 4);
    }
    if (this.colorBuffer.length < totalCubes * 3) {
      this.colorBuffer = new Float32Array(totalCubes * 3);
    }
    if (this.ambientOcclusionBuffer.length < totalCubes * 24) {
      this.ambientOcclusionBuffer = new Uint8Array(totalCubes * 24);
    }

    let posOffset = 0;
    let colOffset = 0;
    let aoOffset = 0;
    for (const chunk of visible) {
      this.positionBuffer.set(chunk.cubePositions, posOffset);
      posOffset += chunk.cubePositions.length;
      this.colorBuffer.set(chunk.cubeColors, colOffset);
      colOffset += chunk.cubeColors.length;
      this.ambientOcclusionBuffer.set(chunk.cubeAmbientOcclusion, aoOffset);
      aoOffset += chunk.cubeAmbientOcclusion.length;
    }

    this.positions = this.positionBuffer.subarray(0, totalCubes * 4);
    this.colors = this.colorBuffer.subarray(0, totalCubes * 3);
    this.ambientOcclusion = this.ambientOcclusionBuffer.subarray(0, totalCubes * 24);
    this.count = totalCubes;
  }

  private mergeBatch(batch: ChunkBatchData): void {
    for (const chunk of batch.chunks) {
      const key = chunkKey(chunk.originX, chunk.originZ);
      this.chunkDataMap.set(key, chunk);
      this.reapplyOverrides(chunk, key);
    }
    this.dirty = true;
    this.onChange?.();
  }

  private reapplyOverrides(chunk: SingleChunkData, key: string): void {
    const overrides = this.localOverrides.get(key);
    if (!overrides || overrides.size === 0) return;

    const worldGet = (bwx: number, bwy: number, bwz: number) =>
      this.getBlock(Math.floor(bwx), Math.floor(bwy), Math.floor(bwz));

    const dirtySections = new Set<number>();
    for (const [idx, type] of overrides) {
      chunk.blocks[idx] = type;
      const wy = Math.floor(idx / (CHUNK_SIZE * CHUNK_SIZE));
      const rem = idx % (CHUNK_SIZE * CHUNK_SIZE);
      const lz = Math.floor(rem / CHUNK_SIZE);
      const lx = rem % CHUNK_SIZE;
      updateColumnSurface(chunk.blocks, chunk.surfaceHeights, chunk.surfaceTypes, lx, lz, wy, type, CHUNK_SIZE);
      dirtySections.add(sectionIndex(lx, wy, lz));
      if (lx % SECTION_SIZE === 0 && lx > 0) dirtySections.add(sectionIndex(lx - 1, wy, lz));
      if (lx % SECTION_SIZE === SECTION_SIZE - 1 && lx < CHUNK_SIZE - 1)
        dirtySections.add(sectionIndex(lx + 1, wy, lz));
      if (lz % SECTION_SIZE === 0 && lz > 0) dirtySections.add(sectionIndex(lx, wy, lz - 1));
      if (lz % SECTION_SIZE === SECTION_SIZE - 1 && lz < CHUNK_SIZE - 1)
        dirtySections.add(sectionIndex(lx, wy, lz + 1));
      if (wy % SECTION_SIZE === 0 && wy > 0) dirtySections.add(sectionIndex(lx, wy - 1, lz));
      if (wy % SECTION_SIZE === SECTION_SIZE - 1 && wy < CHUNK_HEIGHT - 1)
        dirtySections.add(sectionIndex(lx, wy + 1, lz));
      const wx = chunk.originX - CHUNK_SIZE / 2 + lx;
      const wz = chunk.originZ - CHUNK_SIZE / 2 + lz;
      this.client.syncBlock(wx, wy, wz, type);
    }

    this.rebuildSections(chunk, chunk.originX, chunk.originZ, dirtySections, worldGet);
  }

  clearLocalOverride(wx: number, wy: number, wz: number): void {
    const [originX, originZ] = chunkOrigin(wx, wz);
    const key = chunkKey(originX, originZ);
    const lx = wx - (originX - CHUNK_SIZE / 2);
    const lz = wz - (originZ - CHUNK_SIZE / 2);
    const index = wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    const overrides = this.localOverrides.get(key);
    if (!overrides) return;
    overrides.delete(index);
    if (overrides.size === 0) this.localOverrides.delete(key);
  }

  private evictDistant(playerOriginX: number, playerOriginZ: number): void {
    const evictDistance = this.renderDistance + EVICT_PADDING;
    const toDelete: string[] = [];
    for (const key of this.chunkDataMap.keys()) {
      const [oxStr, ozStr] = key.split(",");
      const ox = Number(oxStr);
      const oz = Number(ozStr);
      const dx = Math.abs(ox - playerOriginX) / CHUNK_SIZE;
      const dz = Math.abs(oz - playerOriginZ) / CHUNK_SIZE;
      if (Math.max(dx, dz) > evictDistance) toDelete.push(key);
    }
    for (const key of toDelete) {
      this.chunkDataMap.delete(key);
      this.localOverrides.delete(key);
    }
    if (toDelete.length > 0) this.dirty = true;
  }

  dispose(): void {
    this.client.dispose();
  }

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

function clampRenderDistance(value: number): number {
  return Math.min(MAX_RENDER_DISTANCE, Math.max(MIN_RENDER_DISTANCE, Math.round(value)));
}
