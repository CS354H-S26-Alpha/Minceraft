import type { PlayerState } from "@/game/player";
import { Quad } from "../render/quad";
import playerFSText from "../render/shaders/player.frag";
import playerVSText from "../render/shaders/player.vert";
import type { EntityPassDef, EntityPipelineConfig, GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";
import { lerp, lerpAngle } from "./store";

const quad = new Quad();

export const playerPipelineConfig: EntityPipelineConfig<PlayerState> = {
  interpolate: (prev, curr, t) => ({
    id: curr.id,
    name: curr.name,
    x: lerp(prev.x, curr.x, t),
    y: lerp(prev.y, curr.y, t),
    z: lerp(prev.z, curr.z, t),
    yaw: lerpAngle(prev.yaw, curr.yaw, t),
    pitch: lerp(prev.pitch, curr.pitch, t),
  }),
  pack: (players: PlayerState[], buffers: GpuBuffers) => {
    const count = players.length;
    const positions = ensureBuffer(buffers, "aOffset", count * 4);
    const pitches = ensureBuffer(buffers, "aPitch", count);
    for (let i = 0; i < count; i++) {
      const p = players[i];
      if (!p) continue;
      positions[i * 4] = p.x;
      positions[i * 4 + 1] = p.y;
      positions[i * 4 + 2] = p.z;
      positions[i * 4 + 3] = p.yaw;
      pitches[i] = p.pitch;
    }
    return count;
  },
};

export const playerPassDef: EntityPassDef = {
  key: "players",
  vertexShader: playerVSText,
  fragmentShader: playerFSText,
  geometry: {
    positions: quad.positionsFlat(),
    indices: quad.indicesFlat(),
    normals: quad.normalsFlat(),
    uvs: quad.uvFlat(),
  },
  instancedAttributes: [
    { name: "aOffset", size: 4 },
    { name: "aPitch", size: 1 },
  ],
  cullFace: false,
};
