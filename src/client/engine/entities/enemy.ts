import type { EnemyPublicState } from "@/game/enemy";
import { lerp, lerpAngle } from "@/utils/interpolations";
import { Cube } from "../render/cube";
import enemyFSText from "../render/shaders/enemy.frag";
import playerVSText from "../render/shaders/player.vert";
import type { EntityPassDef, EntityPipelineConfig, GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";

const cube = new Cube();
const ENEMY_WIDTH = 1.4;
const ENEMY_HEIGHT = 3.2;
const ENEMY_DEPTH = 1.4;

const enemyPositions = (() => {
  const base = cube.positionsFlat();
  const result = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 4) {
    const x = base[i] ?? 0;
    const y = base[i + 1] ?? 0;
    const z = base[i + 2] ?? 0;
    const w = base[i + 3] ?? 1;
    result[i] = (x - 0.5) * ENEMY_WIDTH;
    result[i + 1] = y * ENEMY_HEIGHT;
    result[i + 2] = (z - 0.5) * ENEMY_DEPTH;
    result[i + 3] = w;
  }
  return result;
})();

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
    positions: enemyPositions,
    indices: cube.indicesFlat(),
    normals: cube.normalsFlat(),
    uvs: cube.uvFlat(),
  },
  instancedAttributes: [
    { name: "aOffset", size: 4 },
    { name: "aPitch", size: 1 },
  ],
  cullFace: false,
};
