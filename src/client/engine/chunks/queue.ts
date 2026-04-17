/** biome-ignore-all lint/style/noNonNullAssertion: typed-array hot path with bounded indices */
import { LRUCache } from "lru-cache";
import { CubeType } from "@/client/engine/render/cube-types";
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  chunkKey,
  chunkOrigin,
  computeHeightData,
  decodeBlocks,
  type RenderBlockResult,
  renderBlockData,
  SECTION_SIZE,
  SECTIONS_PER_CHUNK,
  sectionIndex,
  sectionRegion,
  updateColumnSurface,
} from "@/game/chunk";
import type { ChunkBatchData, WorkerChunkData } from "./client";

interface SectionRenderData {
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  cubeAmbientOcclusion: Uint8Array;
  numCubes: number;
}

interface CachedChunkData {
  blocks: Uint8Array;
  heightMap: Uint8Array;
  surfaceTypes: Uint8Array;
  sections: (SectionRenderData | null)[];
}

const CARDINAL_OFFSETS: [number, number][] = [
  [CHUNK_SIZE, 0],
  [-CHUNK_SIZE, 0],
  [0, CHUNK_SIZE],
  [0, -CHUNK_SIZE],
];

interface ConcatenatedResult extends RenderBlockResult {
  sectionOffsets: Uint32Array;
  sectionCounts: Uint16Array;
}

function concatenateSections(sections: (SectionRenderData | null)[]): ConcatenatedResult {
  const sectionOffsets = new Uint32Array(sections.length);
  const sectionCounts = new Uint16Array(sections.length);

  let totalCubes = 0;
  for (let i = 0; i < sections.length; i++) {
    sectionOffsets[i] = totalCubes;
    const count = sections[i]?.numCubes ?? 0;
    sectionCounts[i] = count;
    totalCubes += count;
  }

  const cubePositions = new Float32Array(totalCubes * 4);
  const cubeColors = new Float32Array(totalCubes * 3);
  const cubeAmbientOcclusion = new Uint8Array(totalCubes * 24);
  let posOff = 0;
  let colOff = 0;
  let aoOff = 0;
  for (const s of sections) {
    if (!s || s.numCubes === 0) continue;
    cubePositions.set(s.cubePositions, posOff);
    posOff += s.cubePositions.length;
    cubeColors.set(s.cubeColors, colOff);
    colOff += s.cubeColors.length;
    cubeAmbientOcclusion.set(s.cubeAmbientOcclusion, aoOff);
    aoOff += s.cubeAmbientOcclusion.length;
  }
  return { cubePositions, cubeColors, cubeAmbientOcclusion, numCubes: totalCubes, sectionOffsets, sectionCounts };
}

/**
 * Sorts a full-chunk render result into section-contiguous order and computes
 * per-section offset/count metadata. Two O(n) passes over cubePositions.
 */
function bucketBySections(result: RenderBlockResult, originX: number, originZ: number): ConcatenatedResult {
  const n = result.numCubes;
  const halfS = CHUNK_SIZE / 2;

  // Pass 1: count cubes per section
  const counts = new Uint16Array(SECTIONS_PER_CHUNK);
  for (let i = 0; i < n; i++) {
    const lx = result.cubePositions[i * 4]! - (originX - halfS);
    const ly = result.cubePositions[i * 4 + 1]!;
    const lz = result.cubePositions[i * 4 + 2]! - (originZ - halfS);
    const si = sectionIndex(lx, ly, lz);
    counts[si] = counts[si]! + 1;
  }

  // Build prefix-sum offsets
  const offsets = new Uint32Array(SECTIONS_PER_CHUNK);
  const writeIdx = new Uint32Array(SECTIONS_PER_CHUNK);
  let offset = 0;
  for (let i = 0; i < SECTIONS_PER_CHUNK; i++) {
    offsets[i] = offset;
    writeIdx[i] = offset;
    offset += counts[i]!;
  }

  // Pass 2: scatter into section-sorted order
  const cubePositions = new Float32Array(n * 4);
  const cubeColors = new Float32Array(n * 3);
  const cubeAmbientOcclusion = new Uint8Array(n * 24);

  for (let i = 0; i < n; i++) {
    const lx = result.cubePositions[i * 4]! - (originX - halfS);
    const ly = result.cubePositions[i * 4 + 1]!;
    const lz = result.cubePositions[i * 4 + 2]! - (originZ - halfS);
    const si = sectionIndex(lx, ly, lz);
    const dst = writeIdx[si]!;
    writeIdx[si] = dst + 1;

    cubePositions[dst * 4] = result.cubePositions[i * 4]!;
    cubePositions[dst * 4 + 1] = result.cubePositions[i * 4 + 1]!;
    cubePositions[dst * 4 + 2] = result.cubePositions[i * 4 + 2]!;
    cubePositions[dst * 4 + 3] = result.cubePositions[i * 4 + 3]!;

    cubeColors[dst * 3] = result.cubeColors[i * 3]!;
    cubeColors[dst * 3 + 1] = result.cubeColors[i * 3 + 1]!;
    cubeColors[dst * 3 + 2] = result.cubeColors[i * 3 + 2]!;

    cubeAmbientOcclusion.set(result.cubeAmbientOcclusion.subarray(i * 24, i * 24 + 24), dst * 24);
  }

  return {
    cubePositions,
    cubeColors,
    cubeAmbientOcclusion,
    numCubes: n,
    sectionOffsets: offsets,
    sectionCounts: counts,
  };
}

function buildChunkData(ox: number, oz: number, cached: CachedChunkData, result: ConcatenatedResult): WorkerChunkData {
  return {
    originX: ox,
    originZ: oz,
    cubePositions: result.cubePositions,
    cubeColors: result.cubeColors,
    blocks: cached.blocks,
    cubeAmbientOcclusion: result.cubeAmbientOcclusion,
    surfaceHeights: cached.heightMap.slice(),
    surfaceTypes: cached.surfaceTypes.slice(),
    numCubes: result.numCubes,
    sectionOffsets: result.sectionOffsets,
    sectionCounts: result.sectionCounts,
  };
}

/** Receives server block data, decodes it, caches blocks, and builds render meshes. */
export class ChunkMeshBuilder {
  private readonly cache: LRUCache<string, CachedChunkData>;

  constructor(cacheCapacity = 512) {
    this.cache = new LRUCache<string, CachedChunkData>({ max: Math.max(1, cacheCapacity) });
  }

  loadChunks(incoming: Array<{ originX: number; originZ: number; blocks: Uint8Array }>): ChunkBatchData {
    for (const { originX, originZ, blocks: encoded } of incoming) {
      const key = chunkKey(originX, originZ);
      const blocks = decodeBlocks(encoded);
      const { heightMap, surfaceTypes } = computeHeightData(blocks, CHUNK_SIZE);
      this.cache.set(key, { blocks, heightMap, surfaceTypes, sections: new Array(SECTIONS_PER_CHUNK).fill(null) });
    }

    const worldGetBlock = this.buildWorldGetBlock();

    // Render all sections of incoming chunks + cardinal neighbor chunks
    const toRender = new Set<string>();
    for (const { originX, originZ } of incoming) {
      toRender.add(chunkKey(originX, originZ));
      for (const [dx, dz] of CARDINAL_OFFSETS) {
        const nkey = chunkKey(originX + dx, originZ + dz);
        if (this.cache.has(nkey)) toRender.add(nkey);
      }
    }

    const chunks: WorkerChunkData[] = [];
    for (const key of toRender) {
      const [oxStr, ozStr] = key.split(",");
      const ox = Number(oxStr);
      const oz = Number(ozStr);
      const cached = this.cache.get(key);
      if (!cached) continue;

      // Full-chunk render in one pass (fast), then bucket by section
      const result = renderBlockData(cached.blocks, cached.heightMap, ox, oz, CHUNK_SIZE, worldGetBlock);
      const sectioned = bucketBySections(result, ox, oz);
      // Store sections in cache for future updateBlock calls
      for (let i = 0; i < SECTIONS_PER_CHUNK; i++) {
        const off = sectioned.sectionOffsets[i]!;
        const cnt = sectioned.sectionCounts[i]!;
        cached.sections[i] =
          cnt > 0
            ? {
                cubePositions: sectioned.cubePositions.slice(off * 4, (off + cnt) * 4),
                cubeColors: sectioned.cubeColors.slice(off * 3, (off + cnt) * 3),
                cubeAmbientOcclusion: sectioned.cubeAmbientOcclusion.slice(off * 24, (off + cnt) * 24),
                numCubes: cnt,
              }
            : null;
      }
      chunks.push(buildChunkData(ox, oz, cached, sectioned));
    }

    return { chunks };
  }

  updateBlock(wx: number, wy: number, wz: number, blockType: number): ChunkBatchData {
    const [ox, oz] = chunkOrigin(wx, wz);
    const key = chunkKey(ox, oz);
    const cached = this.cache.get(key);
    if (!cached) return { chunks: [] };

    const lx = wx - (ox - CHUNK_SIZE / 2);
    const lz = wz - (oz - CHUNK_SIZE / 2);
    cached.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = blockType;

    updateColumnSurface(cached.blocks, cached.heightMap, cached.surfaceTypes, lx, lz, wy, blockType, CHUNK_SIZE);

    const worldGetBlock = this.buildWorldGetBlock();

    // Determine which sections need re-rendering
    const dirtyIdxs = new Set<number>();
    dirtyIdxs.add(sectionIndex(lx, wy, lz));
    // If at a section boundary, the adjacent section's AO/face culling may change
    if (lx % SECTION_SIZE === 0 && lx > 0) dirtyIdxs.add(sectionIndex(lx - 1, wy, lz));
    if (lx % SECTION_SIZE === SECTION_SIZE - 1 && lx < CHUNK_SIZE - 1) dirtyIdxs.add(sectionIndex(lx + 1, wy, lz));
    if (lz % SECTION_SIZE === 0 && lz > 0) dirtyIdxs.add(sectionIndex(lx, wy, lz - 1));
    if (lz % SECTION_SIZE === SECTION_SIZE - 1 && lz < CHUNK_SIZE - 1) dirtyIdxs.add(sectionIndex(lx, wy, lz + 1));
    if (wy % SECTION_SIZE === 0 && wy > 0) dirtyIdxs.add(sectionIndex(lx, wy - 1, lz));
    if (wy % SECTION_SIZE === SECTION_SIZE - 1 && wy < CHUNK_HEIGHT - 1) dirtyIdxs.add(sectionIndex(lx, wy + 1, lz));

    for (const idx of dirtyIdxs) {
      const region = sectionRegion(idx);
      cached.sections[idx] = renderBlockData(
        cached.blocks,
        cached.heightMap,
        ox,
        oz,
        CHUNK_SIZE,
        worldGetBlock,
        region,
      );
    }

    // Rebuild chunk-level output from sections
    const chunks: WorkerChunkData[] = [buildChunkData(ox, oz, cached, concatenateSections(cached.sections))];

    // If block is at a chunk edge, also re-render the neighbor chunk's edge section
    if (lx === 0 || lx === CHUNK_SIZE - 1 || lz === 0 || lz === CHUNK_SIZE - 1) {
      this.rebuildEdgeNeighborSection(ox, oz, lx, lz, wy, worldGetBlock, chunks);
    }

    return { chunks };
  }

  syncBlock(wx: number, wy: number, wz: number, blockType: number): void {
    const [ox, oz] = chunkOrigin(wx, wz);
    const cached = this.cache.get(chunkKey(ox, oz));
    if (!cached) return;
    const lx = wx - (ox - CHUNK_SIZE / 2);
    const lz = wz - (oz - CHUNK_SIZE / 2);
    cached.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = blockType;
    updateColumnSurface(cached.blocks, cached.heightMap, cached.surfaceTypes, lx, lz, wy, blockType, CHUNK_SIZE);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private rebuildEdgeNeighborSection(
    ox: number,
    oz: number,
    lx: number,
    lz: number,
    wy: number,
    worldGetBlock: (wx: number, wy: number, wz: number) => CubeType,
    chunks: WorkerChunkData[],
  ): void {
    const neighbors: [number, number, number, number][] = [];
    if (lx === 0) neighbors.push([ox - CHUNK_SIZE, oz, CHUNK_SIZE - 1, lz]);
    if (lx === CHUNK_SIZE - 1) neighbors.push([ox + CHUNK_SIZE, oz, 0, lz]);
    if (lz === 0) neighbors.push([ox, oz - CHUNK_SIZE, lx, CHUNK_SIZE - 1]);
    if (lz === CHUNK_SIZE - 1) neighbors.push([ox, oz + CHUNK_SIZE, lx, 0]);

    for (const [nox, noz, nlx, nlz] of neighbors) {
      const nkey = chunkKey(nox, noz);
      const ncached = this.cache.get(nkey);
      if (!ncached) continue;

      const idx = sectionIndex(nlx, wy, nlz);
      const region = sectionRegion(idx);
      ncached.sections[idx] = renderBlockData(
        ncached.blocks,
        ncached.heightMap,
        nox,
        noz,
        CHUNK_SIZE,
        worldGetBlock,
        region,
      );

      chunks.push(buildChunkData(nox, noz, ncached, concatenateSections(ncached.sections)));
    }
  }

  private buildWorldGetBlock(): (wx: number, wy: number, wz: number) => CubeType {
    return (wx, wy, wz) => {
      if (wy < 0 || wy >= CHUNK_HEIGHT) return CubeType.Air;
      const [bOx, bOz] = chunkOrigin(wx, wz);
      const cached = this.cache.get(chunkKey(bOx, bOz));
      if (!cached) return CubeType.Stone;
      const blx = wx - (bOx - CHUNK_SIZE / 2);
      const blz = wz - (bOz - CHUNK_SIZE / 2);
      if (blx < 0 || blx >= CHUNK_SIZE || blz < 0 || blz >= CHUNK_SIZE) return CubeType.Air;
      return (cached.blocks[wy * CHUNK_SIZE * CHUNK_SIZE + blz * CHUNK_SIZE + blx] ?? CubeType.Air) as CubeType;
    };
  }
}
