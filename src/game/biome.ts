import { CubeType } from "@/client/engine/render/cube-types";
import { lerp, smoothstepAB } from "@/utils/interpolations";
import { terrainHeight, valueNoise } from "@/utils/noise";

// A biome noise value in [0,1] maps to one of these regions:
//   [0, 0.40) → Forest   [0.40, 0.70) → Desert   [0.70, 1] → Mountain
export enum Biome {
  Forest,
  Desert,
  Mountain,
}

export interface BiomeInfo {
  surface: CubeType; // top block
  subsurface: CubeType; // blocks just below the surface
  heightBase: number; // average Y
  heightAmp: number; // variation around base
}

export const BIOME_INFOS: Record<Biome, BiomeInfo> = {
  [Biome.Forest]: { surface: CubeType.ForestGrass, subsurface: CubeType.Dirt, heightBase: 60, heightAmp: 10 },
  [Biome.Desert]: { surface: CubeType.Sand, subsurface: CubeType.Sand, heightBase: 56, heightAmp: 8 },
  [Biome.Mountain]: { surface: CubeType.Stone, subsurface: CubeType.Stone, heightBase: 74, heightAmp: 24 },
};

const FOREST_TO_DESERT = 0.4;
const DESERT_TO_MOUNTAIN = 0.7;
const BLEND = 0.08; // crossfade width at each boundary

// Maps a noise value to a Biome.
export function computeBiome(biomeNoise: number): Biome {
  if (biomeNoise < FOREST_TO_DESERT) return Biome.Forest;
  if (biomeNoise < DESERT_TO_MOUNTAIN) return Biome.Desert;
  return Biome.Mountain;
}

// Returns height params blended smoothly near biome boundaries to avoid seams.
// Within BLEND of a threshold, lerps between the two neighboring biomes' params.
function blendedHeightParams(biomeNoise: number): { base: number; amp: number } {
  const f = BIOME_INFOS[Biome.Forest];
  const d = BIOME_INFOS[Biome.Desert];
  const m = BIOME_INFOS[Biome.Mountain];

  if (biomeNoise < FOREST_TO_DESERT + BLEND) {
    const t = smoothstepAB(biomeNoise, FOREST_TO_DESERT - BLEND, FOREST_TO_DESERT + BLEND);
    return { base: lerp(f.heightBase, d.heightBase, t), amp: lerp(f.heightAmp, d.heightAmp, t) };
  }
  if (biomeNoise < DESERT_TO_MOUNTAIN + BLEND) {
    const t = smoothstepAB(biomeNoise, DESERT_TO_MOUNTAIN - BLEND, DESERT_TO_MOUNTAIN + BLEND);
    return { base: lerp(d.heightBase, m.heightBase, t), amp: lerp(d.heightAmp, m.heightAmp, t) };
  }
  return { base: m.heightBase, amp: m.heightAmp };
}

// Returns the top block type. Snow overrides any biome above Y=80.
export function surfaceBlock(biome: Biome, height: number): CubeType {
  if (height > 80) return CubeType.Snow;
  return BIOME_INFOS[biome].surface;
}

// Single entry point for chunk generation: returns biome + final height for (gx, gz).
export function sampleColumn(seed: number, gx: number, gz: number): { biome: Biome; height: number } {
  const biomeNoise = valueNoise(seed + 7, gx, gz, 1 / 300);
  const biome = computeBiome(biomeNoise);
  const raw = terrainHeight(seed, gx, gz);
  const { base, amp } = blendedHeightParams(biomeNoise);
  const height = Math.round(base + (raw / 100 - 0.5) * 2 * amp);
  return { biome, height };
}
