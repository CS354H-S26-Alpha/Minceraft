import { describe, expect, it } from "vitest";
import { ChunkMeshBuilder } from "../src/client/engine/chunks/queue";
import { CubeType } from "../src/client/engine/render/cube-types";
import { CHUNK_SIZE, rleEncodeBlocks } from "../src/game/chunk";

function makeTestBlocks(): Uint8Array {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 128);
  // Fill bottom layer with stone, surface with grass
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      blocks[0 * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x] = CubeType.Bedrock;
      for (let y = 1; y < 50; y++) {
        blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x] = CubeType.Stone;
      }
      blocks[50 * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x] = CubeType.Grass;
    }
  }
  return blocks;
}

describe("ChunkMeshBuilder", () => {
  it("builds meshes from RLE-encoded blocks", () => {
    const builder = new ChunkMeshBuilder();
    const blocks = makeTestBlocks();
    const encoded = rleEncodeBlocks(blocks, CHUNK_SIZE);

    const batch = builder.loadChunks([{ originX: 0, originZ: 0, blocks: encoded }]);
    expect(batch.chunks.length).toBeGreaterThan(0);

    const chunk = batch.chunks.find((c) => c.originX === 0 && c.originZ === 0);
    expect(chunk).toBeDefined();
    expect(chunk?.numCubes).toBeGreaterThan(0);
    expect(chunk?.blocks.length).toBe(CHUNK_SIZE * CHUNK_SIZE * 128);
  });

  it("returns surfaceHeights and surfaceTypes", () => {
    const builder = new ChunkMeshBuilder();
    const blocks = makeTestBlocks();
    const encoded = rleEncodeBlocks(blocks, CHUNK_SIZE);

    const batch = builder.loadChunks([{ originX: 0, originZ: 0, blocks: encoded }]);
    const chunk = batch.chunks.find((c) => c.originX === 0 && c.originZ === 0);
    expect(chunk).toBeDefined();
    expect(chunk?.surfaceHeights[0]).toBe(50);
    expect(chunk?.surfaceTypes[0]).toBe(CubeType.Grass);
  });

  it("caches blocks and re-renders neighbors on new chunk load", () => {
    const builder = new ChunkMeshBuilder();
    const blocks = makeTestBlocks();
    const encoded = rleEncodeBlocks(blocks, CHUNK_SIZE);

    // Load first chunk
    builder.loadChunks([{ originX: 0, originZ: 0, blocks: encoded }]);

    // Load adjacent chunk — should also re-render the first chunk (for edge AO)
    const batch2 = builder.loadChunks([{ originX: CHUNK_SIZE, originZ: 0, blocks: encoded }]);
    const keys = batch2.chunks.map((c) => `${c.originX},${c.originZ}`);
    expect(keys).toContain("0,0"); // neighbor was re-rendered
    expect(keys).toContain(`${CHUNK_SIZE},0`);
  });

  it("clearCache removes all data", () => {
    const builder = new ChunkMeshBuilder();
    const blocks = makeTestBlocks();
    const encoded = rleEncodeBlocks(blocks, CHUNK_SIZE);

    builder.loadChunks([{ originX: 0, originZ: 0, blocks: encoded }]);
    builder.clearCache();

    // Loading the same chunk again should work (cache miss, re-decode)
    const batch = builder.loadChunks([{ originX: 0, originZ: 0, blocks: encoded }]);
    expect(batch.chunks.length).toBeGreaterThan(0);
  });
});
