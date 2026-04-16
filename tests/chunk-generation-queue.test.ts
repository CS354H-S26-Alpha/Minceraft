import { describe, expect, it } from "vitest";
import type { ChunkOrigin, ChunkQueueArgs } from "../src/client/engine/chunks/client";
import { ChunkGenerationQueue } from "../src/client/engine/chunks/queue";
import { CubeType } from "../src/client/engine/render/cube-types";

class FakeChunk {
  public renderCount = 0;
  public blocks = new Uint8Array(0);

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

  public cubeAmbientOcclusion(): Uint8Array {
    return new Uint8Array(24).fill(3);
  }

  public surfaceHeights(): Uint8Array {
    return new Uint8Array([1]);
  }

  public surfaceTypes(): Uint8Array {
    return new Uint8Array([CubeType.Stone]);
  }

  public numCubes(): number {
    return 1;
  }
}

function buildArgs(generationId: number, seed: number, chunkOrigins: ChunkOrigin[]): ChunkQueueArgs {
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
    queue.generateNext(buildArgs(1, 123, firstChunks));
    queue.generateNext(buildArgs(1, 123, firstChunks));
    queue.generateNext(buildArgs(1, 123, firstChunks));

    const secondChunks = [
      { originX: 0, originZ: 0 },
      { originX: 64, originZ: 0 },
      { originX: 128, originZ: 0 },
    ];
    queue.setVisibleChunks(buildArgs(2, 123, secondChunks));
    queue.generateNext(buildArgs(2, 123, secondChunks));

    expect(created).toEqual(["0,0", "64,0", "0,64", "128,0"]);
  });

  it("cancels stale generations when a new visible set replaces the queue", () => {
    const queue = new ChunkGenerationQueue((x, z) => new FakeChunk(x, z));
    const firstChunks = [{ originX: 0, originZ: 0 }];
    const secondChunks = [{ originX: 64, originZ: 0 }];

    queue.setVisibleChunks(buildArgs(1, 123, firstChunks));
    queue.setVisibleChunks(buildArgs(2, 123, secondChunks));

    expect(queue.generateNext(buildArgs(1, 123, firstChunks))).toBeNull();
    expect(queue.generateNext(buildArgs(2, 123, secondChunks))?.chunks[0]?.numCubes).toBe(1);
  });
});
