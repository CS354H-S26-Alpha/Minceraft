import { WorkerEntrypoint } from "cloudflare:workers";
import { CHUNK_SIZE, Chunk, encodeBlocks } from "@/game/chunk";

/**
 * Stateless Worker entrypoint for chunk generation. Called via a self-service
 * binding from ChunkStore DO — each call runs on a separate isolate, so
 * multiple chunk generations can execute in parallel.
 */
export class ChunkGen extends WorkerEntrypoint<Env> {
  generateChunk(originX: number, originZ: number, seed: number): Uint8Array {
    const chunk = new Chunk(originX, originZ, CHUNK_SIZE, seed, true);
    return encodeBlocks(chunk.blocks);
  }
}
