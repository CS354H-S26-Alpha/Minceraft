import { CubeType } from "@/client/engine/render/cube-types";
import { terrainHeight, valueNoise } from "@/lib/noise";

export const enum Biome { Forest, Desert, Mountain }

export interface BiomeInfo {
  surface:    CubeType;  // top visible block
  subsurface: CubeType;  // 1-3 blocks below the surface
}

export const BIOME_INFOS: Record<Biome, BiomeInfo> = {
  [Biome.Forest]:   { surface: CubeType.ForestGrass, subsurface: CubeType.Dirt,   },
  [Biome.Desert]:   { surface: CubeType.Sand,        subsurface: CubeType.Sand,  },
  [Biome.Mountain]: { surface: CubeType.Stone,       subsurface: CubeType.Stone, },
};

// noise to Biome
export function computeBiome(biomeNoise: number): Biome {
  if (biomeNoise < 0.4)   return Biome.Forest;
  if (biomeNoise < 0.7) return Biome.Desert;
  return Biome.Mountain;
}


/** Surface block for a column, with altitude overrides that apply to any biome. */
export function surfaceBlock(biome: Biome, height: number): CubeType {
  if (height > 80) return CubeType.Snow;
  return BIOME_INFOS[biome].surface;
}

export function sampleColumn(
  seed: number,
  gx: number,
  gz: number,
): { biome: Biome; height: number } {
  const biomeNoise = valueNoise(seed + 7, gx, gz, 1 / 300);
  const biome      = computeBiome(biomeNoise);
  const height        = terrainHeight(seed, gx, gz);
  return { biome, height };
}
