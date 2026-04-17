import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, decodeBlocks, encodeBlocks } from "../src/game/chunk";

describe("encodeBlocks / decodeBlocks", () => {
  it("round-trips an all-air chunk", () => {
    const size = 4;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    const encoded = encodeBlocks(blocks);
    const decoded = decodeBlocks(encoded);
    expect(decoded).toEqual(blocks);
  });

  it("round-trips a chunk with varied columns", () => {
    const size = 4;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);

    const x = 1;
    const z = 2;
    blocks[0 * size * size + z * size + x] = CubeType.Bedrock;
    for (let y = 1; y <= 50; y++) {
      blocks[y * size * size + z * size + x] = CubeType.Stone;
    }
    for (let y = 51; y <= 53; y++) {
      blocks[y * size * size + z * size + x] = CubeType.Dirt;
    }
    blocks[54 * size * size + z * size + x] = CubeType.Grass;

    const encoded = encodeBlocks(blocks);
    const decoded = decodeBlocks(encoded);
    expect(decoded).toEqual(blocks);
  });

  it("compresses all-air far below raw size", () => {
    const size = 4;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    const encoded = encodeBlocks(blocks);
    expect(encoded.length).toBeLessThan(blocks.length);
  });

  it("round-trips a full-size generated chunk with high compression", () => {
    const chunk = new Chunk(0, 0, CHUNK_SIZE, 42, true);
    const encoded = encodeBlocks(chunk.blocks);
    const decoded = decodeBlocks(encoded);
    expect(decoded).toEqual(chunk.blocks);

    const rawSize = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
    const ratio = encoded.length / rawSize;
    expect(ratio).toBeLessThan(0.15);
  });

  it("round-trips alternating blocks (high-entropy input)", () => {
    const size = 1;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      blocks[y] = y % 2 === 0 ? CubeType.Stone : CubeType.Dirt;
    }
    const encoded = encodeBlocks(blocks);
    const decoded = decodeBlocks(encoded);
    expect(decoded).toEqual(blocks);
  });
});
