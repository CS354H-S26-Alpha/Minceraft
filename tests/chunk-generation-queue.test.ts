import { describe, expect, it } from "vitest";
import type { ChunkOrigin, VisibleChunkQueueArgs } from "../src/client/engine/chunks/chunk-generation-protocol";
import { ChunkGenerationQueue } from "../src/client/engine/chunks/chunk-generation-queue";
import { CubeType } from "../src/client/engine/render/cube-types";

class FakeChunk {
  public renderCount = 0;

  constructor(
    private readonly x: number,
    private readonly z: number,
  ) {}

  public renderChunk(): void {
    this.renderCount++;
  }

  public getBlockWorld(): CubeType {
    return CubeType.Stone;
  }

  public cubePositions(): Float32Array {
    return new Float32Array([this.x, 0, this.z, 0]);
  }

  public cubeColors(): Float32Array {
    return new Float32Array([1, 1, 1]);
  }

  public numCubes(): number {
    return 1;
  }
}

function buildArgs(generationId: number, seed: number, chunkOrigins: ChunkOrigin[]): VisibleChunkQueueArgs {
  return {
    generationId,
    seed,
    originX: 0,
    originZ: 0,
    renderDistance: 1,
    chunkOrigins,
  };
}

describe("ChunkGenerationQueue", () => {
  it("reuses cached chunks and only generates newly queued ones", () => {
    const created: string[] = [];
    const queue = new ChunkGenerationQueue((x, z) => {
      created.push(`${x},${z}`);
      return new FakeChunk(x, z);
    });
    const firstChunks = [
      { originX: 0, originZ: 0 },
      { originX: 64, originZ: 0 },
      { originX: 0, originZ: 64 },
    ];

    queue.setVisibleChunks(buildArgs(1, 123, firstChunks));
    queue.generateNextVisibleChunk(buildArgs(1, 123, firstChunks));
    queue.generateNextVisibleChunk(buildArgs(1, 123, firstChunks));
    queue.generateNextVisibleChunk(buildArgs(1, 123, firstChunks));

    const secondChunks = [
      { originX: 0, originZ: 0 },
      { originX: 64, originZ: 0 },
      { originX: 128, originZ: 0 },
    ];
    queue.setVisibleChunks(buildArgs(2, 123, secondChunks));
    queue.generateNextVisibleChunk(buildArgs(2, 123, secondChunks));

    expect(created).toEqual(["0,0", "64,0", "0,64", "128,0"]);
  });

  it("cancels stale generations when a new visible set replaces the queue", () => {
    const queue = new ChunkGenerationQueue((x, z) => new FakeChunk(x, z));
    const firstChunks = [{ originX: 0, originZ: 0 }];
    const secondChunks = [{ originX: 64, originZ: 0 }];

    queue.setVisibleChunks(buildArgs(1, 123, firstChunks));
    queue.setVisibleChunks(buildArgs(2, 123, secondChunks));

    expect(queue.generateNextVisibleChunk(buildArgs(1, 123, firstChunks))).toBeNull();
    expect(queue.generateNextVisibleChunk(buildArgs(2, 123, secondChunks))?.numCubes).toBe(1);
  });
});
