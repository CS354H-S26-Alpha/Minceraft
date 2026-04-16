import { describe, expect, it } from "vitest";
import { CubeType } from "../src/client/engine/render/cube-types";
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, rleDecodeBlocks, rleEncodeBlocks } from "../src/game/chunk";

describe("rleEncodeBlocks / rleDecodeBlocks", () => {
  it("round-trips an all-air chunk", () => {
    const size = 4;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    const encoded = rleEncodeBlocks(blocks, size);
    const decoded = rleDecodeBlocks(encoded, size);
    expect(decoded).toEqual(blocks);
  });

  it("round-trips a chunk with varied columns", () => {
    const size = 4;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);

    // Fill a column with bedrock(1), stone(50), dirt(3), grass(1), air(rest)
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

    const encoded = rleEncodeBlocks(blocks, size);
    const decoded = rleDecodeBlocks(encoded, size);
    expect(decoded).toEqual(blocks);
  });

  it("compresses well — all-air is very small", () => {
    const size = 4;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    const encoded = rleEncodeBlocks(blocks, size);
    // 16 columns × 1 run each × 2 bytes = 32 bytes
    expect(encoded.length).toBe(size * size * 2);
  });

  it("compresses a realistic column to ~10 bytes", () => {
    const size = 1;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    // bedrock(1) + stone(45) + dirt(3) + grass(1) + air(78) = 5 runs = 10 bytes
    blocks[0] = CubeType.Bedrock;
    for (let y = 1; y <= 45; y++) blocks[y * size * size] = CubeType.Stone;
    for (let y = 46; y <= 48; y++) blocks[y * size * size] = CubeType.Dirt;
    blocks[49 * size * size] = CubeType.Grass;

    const encoded = rleEncodeBlocks(blocks, size);
    expect(encoded.length).toBe(10);
  });

  it("round-trips a full-size generated chunk", () => {
    const chunk = new Chunk(0, 0, CHUNK_SIZE, 42, true);
    const encoded = rleEncodeBlocks(chunk.blocks, CHUNK_SIZE);
    const decoded = rleDecodeBlocks(encoded, CHUNK_SIZE);
    expect(decoded).toEqual(chunk.blocks);

    // Should achieve significant compression
    const rawSize = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
    const ratio = encoded.length / rawSize;
    expect(ratio).toBeLessThan(0.15); // at least 85% compression
  });

  it("handles runs longer than 128 by splitting", () => {
    // CHUNK_HEIGHT is 128, so max run is 128 — fits in u8
    // But if we ever had height > 255, runs would need splitting
    // For now just verify runs up to 128 work
    const size = 1;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    // All stone = 1 run of 128
    blocks.fill(CubeType.Stone);
    const encoded = rleEncodeBlocks(blocks, size);
    expect(encoded.length).toBe(2); // single pair
    expect(encoded[0]).toBe(CubeType.Stone);
    expect(encoded[1]).toBe(128);
  });

  it("handles alternating blocks (worst case)", () => {
    const size = 1;
    const blocks = new Uint8Array(size * size * CHUNK_HEIGHT);
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      blocks[y] = y % 2 === 0 ? CubeType.Stone : CubeType.Dirt;
    }
    const encoded = rleEncodeBlocks(blocks, size);
    // 128 runs of length 1 = 256 bytes
    expect(encoded.length).toBe(CHUNK_HEIGHT * 2);

    const decoded = rleDecodeBlocks(encoded, size);
    expect(decoded).toEqual(blocks);
  });
});
