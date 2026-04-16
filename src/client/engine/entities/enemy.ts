import { ENEMY_DEPTH, ENEMY_HEIGHT, ENEMY_WIDTH, type EnemyPublicState } from "@/game/enemy";
import { lerp, lerpAngle } from "@/utils/interpolations";
import { Cube } from "../render/cube";
import enemyFSText from "../render/shaders/enemy.frag";
import enemyVSText from "../render/shaders/enemy.vert";
import type { EntityPassDef, EntityPipelineConfig, GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";

const cube = new Cube();
const ENEMY_HIT_FLASH_MS = 180;

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

export interface EnemyRenderState extends EnemyPublicState {
  flash: number;
}

export function createEnemySnapshotTracker() {
  const lastHealth = new Map<string, number>();
  const flashUntil = new Map<string, number>();

  return {
    decorate(snapshot: Readonly<Record<string, EnemyPublicState>>, now: number): Record<string, EnemyRenderState> {
      const result: Record<string, EnemyRenderState> = {};
      const seen = new Set<string>();

      for (const [id, enemy] of Object.entries(snapshot)) {
        seen.add(id);
        const prevHealth = lastHealth.get(id);
        if (prevHealth !== undefined && enemy.health < prevHealth) {
          flashUntil.set(id, now + ENEMY_HIT_FLASH_MS);
        }
        lastHealth.set(id, enemy.health);
        const until = flashUntil.get(id) ?? 0;
        const flash = until > now ? (until - now) / ENEMY_HIT_FLASH_MS : 0;
        if (flash <= 0) flashUntil.delete(id);
        result[id] = { ...enemy, flash };
      }

      for (const id of [...lastHealth.keys()]) {
        if (seen.has(id)) continue;
        lastHealth.delete(id);
        flashUntil.delete(id);
      }

      return result;
    },
  };
}

export const enemyPipelineConfig: EntityPipelineConfig<EnemyRenderState> = {
  interpolate: (prev, curr, t) => ({
    id: curr.id,
    x: lerp(prev.x, curr.x, t),
    y: lerp(prev.y, curr.y, t),
    z: lerp(prev.z, curr.z, t),
    yaw: lerpAngle(prev.yaw, curr.yaw, t),
    health: curr.health,
    flash: lerp(prev.flash, curr.flash, t),
  }),
  pack: (enemies: EnemyRenderState[], buffers: GpuBuffers) => {
    const count = enemies.length;
    const positions = ensureBuffer(buffers, "aOffset", count * 4);
    const pitches = ensureBuffer(buffers, "aPitch", count);
    const flashes = ensureBuffer(buffers, "aFlash", count);
    for (let i = 0; i < count; i++) {
      const enemy = enemies[i];
      if (!enemy) continue;
      positions[i * 4] = enemy.x;
      positions[i * 4 + 1] = enemy.y;
      positions[i * 4 + 2] = enemy.z;
      positions[i * 4 + 3] = enemy.yaw;
      pitches[i] = 0;
      flashes[i] = enemy.flash;
    }
    return count;
  },
};

export const enemyPassDef: EntityPassDef = {
  key: "enemies",
  vertexShader: enemyVSText,
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
    { name: "aFlash", size: 1 },
  ],
  cullFace: false,
};
