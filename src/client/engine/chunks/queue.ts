import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE, Chunk, chunkKey, chunkOrigin } from "@/game/chunk";
import type { ChunkOrigin, ChunkQueueArgs, ChunkRenderData } from "./client";

interface ChunkLike {
  renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void;
  getBlockWorld(wx: number, wy: number, wz: number): CubeType;
  cubePositions(): Float32Array;
  cubeColors(): Float32Array;
  numCubes(): number;
}

type ChunkFactory = (centerX: number, centerZ: number, size: number, seed: number) => ChunkLike;

interface QueuedChunk extends ChunkOrigin {
  key: string;
}

/** Manages chunk caching and incremental terrain generation. */
export class ChunkGenerationQueue {
  private readonly chunkMap = new Map<string, ChunkLike>();
  private activeSeed: number | undefined;
  private activeGenerationId = -1;
  private queuedChunks: QueuedChunk[] = [];

  constructor(
    private readonly chunkFactory: ChunkFactory = (centerX, centerZ, size, seed) =>
      new Chunk(centerX, centerZ, size, seed),
  ) {}

  /** Replaces the desired visible set and returns a render from already-cached chunks. */
  setVisibleChunks(args: ChunkQueueArgs): ChunkRenderData {
    this.ensureSeed(args.seed);
    this.activeGenerationId = args.generationId;
    this.queuedChunks = this.buildQueue(args.chunkOrigins);
    return this.renderVisible(args);
  }

  /** Generates one queued chunk and returns an updated render, or `null` if done or stale. */
  generateNext(args: ChunkQueueArgs): ChunkRenderData | null {
    this.ensureSeed(args.seed);
    if (args.generationId !== this.activeGenerationId) return null;

    while (this.queuedChunks.length > 0) {
      const next = this.queuedChunks.shift();
      if (!next) return null;
      if (this.chunkMap.has(next.key)) continue;
      this.chunkMap.set(next.key, this.chunkFactory(next.originX, next.originZ, CHUNK_SIZE, args.seed));
      return this.renderVisible(args);
    }

    return null;
  }

  private ensureSeed(seed: number): void {
    if (this.activeSeed === seed) return;
    this.chunkMap.clear();
    this.queuedChunks = [];
    this.activeSeed = seed;
    this.activeGenerationId = -1;
  }

  private buildQueue(chunkOrigins: ChunkOrigin[]) {
    const queue = [];
    const seenKeys = new Set<string>();

    for (const chunkOrigin of chunkOrigins) {
      const key = chunkKey(chunkOrigin.originX, chunkOrigin.originZ);
      if (seenKeys.has(key) || this.chunkMap.has(key)) continue;
      seenKeys.add(key);
      queue.push({ ...chunkOrigin, key });
    }

    return queue;
  }

  private renderVisible({ originX, originZ, renderDistance }: ChunkQueueArgs) {
    const visibleChunks = [];

    for (let cx = -renderDistance; cx <= renderDistance; cx++) {
      for (let cz = -renderDistance; cz <= renderDistance; cz++) {
        const chunkX = originX + cx * CHUNK_SIZE;
        const chunkZ = originZ + cz * CHUNK_SIZE;
        const chunk = this.chunkMap.get(chunkKey(chunkX, chunkZ));
        if (!chunk) continue;
        visibleChunks.push(chunk);
      }
    }

    const worldGetBlock = (wx: number, wy: number, wz: number): CubeType => {
      const [ox, oz] = chunkOrigin(wx, wz);
      const chunk = this.chunkMap.get(chunkKey(ox, oz));
      if (!chunk) return CubeType.Stone;
      return chunk.getBlockWorld(wx, wy, wz);
    };

    for (const chunk of visibleChunks) chunk.renderChunk(worldGetBlock);

    let totalPositionCount = 0;
    let totalColorCount = 0;
    let totalCubes = 0;
    for (const chunk of visibleChunks) {
      totalPositionCount += chunk.cubePositions().length;
      totalColorCount += chunk.cubeColors().length;
      totalCubes += chunk.numCubes();
    }

    const cubePositions = new Float32Array(totalPositionCount);
    const cubeColors = new Float32Array(totalColorCount);
    let positionOffset = 0;
    let colorOffset = 0;

    for (const chunk of visibleChunks) {
      const positions = chunk.cubePositions();
      cubePositions.set(positions, positionOffset);
      positionOffset += positions.length;

      const colors = chunk.cubeColors();
      cubeColors.set(colors, colorOffset);
      colorOffset += colors.length;
    }

    return { cubePositions, cubeColors, numCubes: totalCubes };
  }
}
