import { RemoteEntityStore } from "./store";

export type GpuBuffers = Record<string, Float32Array>;

export interface StaticEntityAttribute {
  name: string;
  size: number;
  data: Float32Array;
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
    extraAttributes?: StaticEntityAttribute[];
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

export interface EntityPipelineConfig<SnapshotState, RenderState = SnapshotState> {
  interpolate: (prev: SnapshotState, curr: SnapshotState, t: number) => RenderState;
  pack: (states: RenderState[], buffers: GpuBuffers) => number;
}

export function createEntityPipeline<SnapshotState, RenderState = SnapshotState>(
  config: EntityPipelineConfig<SnapshotState, RenderState>,
) {
  const store = new RemoteEntityStore<SnapshotState, RenderState>(config.interpolate);
  const buffers: GpuBuffers = {};

  return {
    onSnapshot(entities: Record<string, SnapshotState>, now: number) {
      store.update(structuredClone(entities), now);
    },
    states(now: number): RenderState[] {
      return store.interpolated(now);
    },
    frame(now: number): { buffers: GpuBuffers; count: number } {
      const states = store.interpolated(now);
      const count = config.pack(states, buffers);
      return { buffers, count };
    },
  };
}
