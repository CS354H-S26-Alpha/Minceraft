import type { EnemyPublicState } from "@/game/enemy";
import { lerp, lerpAngle } from "@/utils/interpolations";
import { Quad } from "../render/quad";
import enemyFSText from "../render/shaders/enemy.frag";
import playerVSText from "../render/shaders/player.vert";
import type { EntityPassDef, EntityPipelineConfig, GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";

const quad = new Quad();

export const enemyPipelineConfig: EntityPipelineConfig<EnemyPublicState> = {
  interpolate: (prev, curr, t) => ({
    id: curr.id,
    x: lerp(prev.x, curr.x, t),
    y: lerp(prev.y, curr.y, t),
    z: lerp(prev.z, curr.z, t),
    yaw: lerpAngle(prev.yaw, curr.yaw, t),
    health: curr.health,
  }),
  pack: (enemies: EnemyPublicState[], buffers: GpuBuffers) => {
    const count = enemies.length;
    const positions = ensureBuffer(buffers, "aOffset", count * 4);
    const pitches = ensureBuffer(buffers, "aPitch", count);
    for (let i = 0; i < count; i++) {
      const enemy = enemies[i];
      if (!enemy) continue;
      positions[i * 4] = enemy.x;
      positions[i * 4 + 1] = enemy.y;
      positions[i * 4 + 2] = enemy.z;
      positions[i * 4 + 3] = enemy.yaw;
      pitches[i] = 0;
    }
    return count;
  },
};

export const enemyPassDef: EntityPassDef = {
  key: "enemies",
  vertexShader: playerVSText,
  fragmentShader: enemyFSText,
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
