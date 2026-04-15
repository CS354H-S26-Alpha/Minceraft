import { CubeType } from "@/client/engine/render/cube-types";
import { smoothstepAB } from "@/utils/interpolations";
import { terrainHeight, valueNoise, valueNoiseFbm } from "@/utils/noise";

// Biomes are determined by two independent noise axes:
//   temperature (0=cold → 1=hot) and moisture (0=dry → 1=wet)
//
//   temp < 0.35                               → Tundra       (cold, dry, no water)
//   0.35 ≤ temp < 0.50, moist < 0.55         → ColdMountain (snow peaks, water in valleys)
//   0.50 ≤ temp < 0.65, moist < 0.55         → Mountain     (stone peaks, snow only above Y=80)
//   0.35 ≤ temp < 0.65, moist ≥ 0.55         → Forest
//   temp ≥ 0.65, moist < 0.50                → Desert       (lava in low spots)
//   temp ≥ 0.65, moist ≥ 0.50                → Swamp        (water, very flat)
export enum Biome {
  Forest, // 0 — temperate+wet
  Desert, // 1 — hot+dry  (lava lakes)
  Mountain, // 2 — warm-temperate+dry  (stone peaks)
  Tundra, // 3 — cold (dry, no water)
  Swamp, // 4 — hot+wet (water lakes)
  ColdMountain, // 5 — cold-temperate+dry (snow peaks, water in valleys)
}

export interface BiomeInfo {
  surface: CubeType; // top block
  subsurface: CubeType; // blocks just below the surface
  heightBase: number; // average Y
  heightAmp: number; // variation around base
}

export const BIOME_INFOS: Record<Biome, BiomeInfo> = {
  [Biome.Forest]: { surface: CubeType.ForestGrass, subsurface: CubeType.Dirt, heightBase: 60, heightAmp: 10 },
  [Biome.Desert]: { surface: CubeType.Sand, subsurface: CubeType.Sand, heightBase: 60, heightAmp: 10 },
  [Biome.Mountain]: { surface: CubeType.Stone, subsurface: CubeType.Stone, heightBase: 90, heightAmp: 32 },
  [Biome.Tundra]: { surface: CubeType.Snow, subsurface: CubeType.Dirt, heightBase: 60, heightAmp: 10 },
  [Biome.Swamp]: { surface: CubeType.Grass, subsurface: CubeType.Dirt, heightBase: 52, heightAmp: 8 },
  [Biome.ColdMountain]: { surface: CubeType.Snow, subsurface: CubeType.Stone, heightBase: 85, heightAmp: 28 },
};

const TEMP_COLD = 0.3; // below → Tundra       (~30% of range)
const TEMP_MID = 0.5; // splits ColdMountain (below) from Mountain (above) in dry-temperate
const TEMP_HOT = 0.6; // above → Desert or Swamp  (~40% of range, expanded for visibility)
const MOIST_DRY = 0.5; // below (temperate) → mountain zone; above → Forest  (50/50 split)
const MOIST_DRY_HOT = 0.5; // below (hot) → Desert; above → Swamp
const BLEND = 0.05; // half-width of crossfade zone at each boundary

// Maps (temperature, moisture) to a Biome.
export function computeBiome(temp: number, moist: number): Biome {
  if (temp < TEMP_COLD) return Biome.Tundra;
  if (temp >= TEMP_HOT) return moist >= MOIST_DRY_HOT ? Biome.Swamp : Biome.Desert;
  if (moist >= MOIST_DRY) return Biome.Forest;
  return temp < TEMP_MID ? Biome.ColdMountain : Biome.Mountain;
}

// Per-biome soft weight at (temp, moist) for smooth height blending at boundaries.
// smoothstepAB(t, A, B): A > B → falling curve; A < B → rising curve.
function biomeWeight(temp: number, moist: number, biome: Biome): number {
  const B = BLEND;
  switch (biome) {
    case Biome.Tundra:
      return smoothstepAB(temp, TEMP_COLD + B, TEMP_COLD - B); // 1 when cold, 0 when warm

    case Biome.ColdMountain:
      // cold-side of temperate AND below TEMP_MID AND dry
      return (
        smoothstepAB(temp, TEMP_COLD - B, TEMP_COLD + B) * // warm side of cold boundary
        smoothstepAB(temp, TEMP_MID + B, TEMP_MID - B) * // cold side of mid boundary
        smoothstepAB(moist, MOIST_DRY + B, MOIST_DRY - B)
      ); // dry side

    case Biome.Mountain:
      // warm-side of temperate AND above TEMP_MID AND dry
      return (
        smoothstepAB(temp, TEMP_MID - B, TEMP_MID + B) * // warm side of mid boundary
        smoothstepAB(temp, TEMP_HOT + B, TEMP_HOT - B) * // cool side of hot boundary
        smoothstepAB(moist, MOIST_DRY + B, MOIST_DRY - B)
      ); // dry side

    case Biome.Forest:
      return (
        smoothstepAB(temp, TEMP_COLD - B, TEMP_COLD + B) *
        smoothstepAB(temp, TEMP_HOT + B, TEMP_HOT - B) *
        smoothstepAB(moist, MOIST_DRY - B, MOIST_DRY + B)
      ); // wet side

    case Biome.Desert:
      return smoothstepAB(temp, TEMP_HOT - B, TEMP_HOT + B) * smoothstepAB(moist, MOIST_DRY_HOT + B, MOIST_DRY_HOT - B);

    case Biome.Swamp:
      return smoothstepAB(temp, TEMP_HOT - B, TEMP_HOT + B) * smoothstepAB(moist, MOIST_DRY_HOT - B, MOIST_DRY_HOT + B);
  }
}

// Returns height params blended smoothly across biome boundaries.
function blendedHeightParams(temp: number, moist: number): { base: number; amp: number } {
  const biomes = [Biome.Tundra, Biome.ColdMountain, Biome.Mountain, Biome.Forest, Biome.Desert, Biome.Swamp] as const;
  let totalWeight = 0,
    base = 0,
    amp = 0;
  for (const b of biomes) {
    const w = biomeWeight(temp, moist, b);
    totalWeight += w;
    base += BIOME_INFOS[b].heightBase * w;
    amp += BIOME_INFOS[b].heightAmp * w;
  }
  if (totalWeight < 1e-6) {
    const b = computeBiome(temp, moist);
    return { base: BIOME_INFOS[b].heightBase, amp: BIOME_INFOS[b].heightAmp };
  }
  return { base: base / totalWeight, amp: amp / totalWeight };
}

// Returns the top block type.
// Snow overrides above Y=80 for all biomes — ColdMountain already has Snow as its surface
// so it is snowy at all elevations; Mountain (Stone surface) only gets snow above Y=80.
export function surfaceBlock(biome: Biome, height: number): CubeType {
  if (height > 80) return CubeType.Snow;
  return BIOME_INFOS[biome].surface;
}

// Single entry point for chunk generation: returns biome + final height for (gx, gz).
// Also returns surfaceBiome — determined via a finer warp so block-type transitions at
// biome boundaries are noisy and interleaved rather than a smooth line.
export function sampleColumn(
  seed: number,
  gx: number,
  gz: number,
): { biome: Biome; surfaceBiome: Biome; height: number } {
  // Coarse domain warp — used for height blending (smooth terrain).
  const warpStrength = 48;
  const wx = (valueNoise(seed + 31, gx, gz, 1 / 90) - 0.5) * warpStrength;
  const wz = (valueNoise(seed + 37, gx, gz, 1 / 90) - 0.5) * warpStrength;
  const temp = valueNoiseFbm(seed + 7, gx + wx, gz + wz, 1 / 250);
  const moist = valueNoiseFbm(seed + 13, gx + wx, gz + wz, 1 / 250);
  const biome = computeBiome(temp, moist);

  // Fine domain warp — applied only for surface block type.
  // Higher frequency + smaller amplitude creates a jagged, interleaved transition zone
  // instead of a smooth boundary line.
  const fineStrength = 24;
  const fx = (valueNoise(seed + 53, gx, gz, 1 / 18) - 0.5) * fineStrength;
  const fz = (valueNoise(seed + 59, gx, gz, 1 / 18) - 0.5) * fineStrength;
  const surfaceTemp = valueNoiseFbm(seed + 7, gx + wx + fx, gz + wz + fz, 1 / 250);
  const surfaceMoist = valueNoiseFbm(seed + 13, gx + wx + fx, gz + wz + fz, 1 / 250);
  const surfaceBiome = computeBiome(surfaceTemp, surfaceMoist);

  const raw = terrainHeight(seed, gx, gz);
  const { base, amp } = blendedHeightParams(temp, moist);
  const height = Math.round(base + (raw / 100 - 0.5) * 2 * amp);
  return { biome, surfaceBiome, height };
}
