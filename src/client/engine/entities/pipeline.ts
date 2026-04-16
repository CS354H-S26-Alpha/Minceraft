import { RemoteEntityStore } from "./store";

export type GpuBuffers = Record<string, Float32Array>;

export interface EntityPipelineConfig<S> {
  interpolate: (prev: S, curr: S, t: number) => S;
  pack: (states: S[], buffers: GpuBuffers) => number;
}

export interface EntityPassDef {
  key: string;
  vertexShader: string;
  fragmentShader: string;
  geometry: {
    positions: Float32Array;
    indices: Uint32Array;
    normals: Float32Array;
    uvs: Float32Array;
  };
  instancedAttributes: { name: string; size: number }[];
  cullFace?: boolean;
}

export interface EntityDrawData {
  key: string;
  buffers: GpuBuffers;
  count: number;
}

export function ensureBuffer(buffers: GpuBuffers, name: string, minLength: number): Float32Array {
  const existing = buffers[name];
  if (!existing || existing.length < minLength) {
    const buf = new Float32Array(Math.max(minLength, (existing?.length ?? 0) * 2));
    buffers[name] = buf;
    return buf;
  }
  return existing;
}

export function createEntityPipeline<S>(config: EntityPipelineConfig<S>) {
  const store = new RemoteEntityStore<S>(config.interpolate);
  const buffers: GpuBuffers = {};

  return {
    onSnapshot(entities: Record<string, S>, now: number) {
      store.update(structuredClone(entities), now);
    },
    states(now: number): S[] {
      return store.interpolated(now);
    },
    frame(now: number): { buffers: GpuBuffers; count: number } {
      const states = store.interpolated(now);
      const count = config.pack(states, buffers);
      return { buffers, count };
    },
  };
}
