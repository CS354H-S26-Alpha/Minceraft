import { CubeType } from "@/client/engine/render/cube-types";
import { smoothstepAB } from "@/utils/interpolations";
import { terrainHeight, valueNoise, valueNoiseFbm } from "@/utils/noise";

// Biomes are determined by two independent noise axes:
//   temperature (0=cold → 1=hot) and moisture (0=dry → 1=wet)
//
//   temp < 0.30                        → Tundra   (cold, no water)
//   0.30 ≤ temp < 0.60, moist < 0.50  → Mountain (stone peaks, snow above Y=95)
//   0.30 ≤ temp < 0.60, moist ≥ 0.50  → Forest
//   temp ≥ 0.60, moist < 0.50         → Desert   (lava in low spots)
//   temp ≥ 0.60, moist ≥ 0.50         → Swamp    (water, very flat)
export enum Biome {
  Forest, // 0 — temperate+wet
  Desert, // 1 — hot+dry  (lava lakes)
  Mountain, // 2 — temperate+dry (stone peaks, snow above Y=95)
  Tundra, // 3 — cold (no water)
  Swamp, // 4 — hot+wet (water lakes)
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
  [Biome.Tundra]: { surface: CubeType.Permafrost, subsurface: CubeType.Dirt, heightBase: 50, heightAmp: 10 },
  [Biome.Swamp]: { surface: CubeType.Grass, subsurface: CubeType.Dirt, heightBase: 52, heightAmp: 8 },
};

const TEMP_COLD = 0.3; // below → Tundra
const TEMP_HOT = 0.6; // above → Desert or Swamp
const MOIST_DRY = 0.5; // below (temperate) → Mountain; above → Forest
const MOIST_DRY_HOT = 0.5; // below (hot) → Desert; above → Swamp
const BLEND = 0.05; // half-width of crossfade zone at each boundary

// Maps (temperature, moisture) to a Biome.
export function computeBiome(temp: number, moist: number): Biome {
  if (temp < TEMP_COLD) return Biome.Tundra;
  if (temp >= TEMP_HOT) return moist >= MOIST_DRY_HOT ? Biome.Swamp : Biome.Desert;
  return moist >= MOIST_DRY ? Biome.Forest : Biome.Mountain;
}

// Per-biome soft weight at (temp, moist) for smooth height blending at boundaries.
// smoothstepAB(t, A, B): A > B → falling curve; A < B → rising curve.
function biomeWeight(temp: number, moist: number, biome: Biome): number {
  const B = BLEND;
  switch (biome) {
    case Biome.Tundra:
      return smoothstepAB(temp, TEMP_COLD + B, TEMP_COLD - B);

    case Biome.Mountain:
      return (
        smoothstepAB(temp, TEMP_COLD - B, TEMP_COLD + B) *
        smoothstepAB(temp, TEMP_HOT + B, TEMP_HOT - B) *
        smoothstepAB(moist, MOIST_DRY + B, MOIST_DRY - B)
      );

    case Biome.Forest:
      return (
        smoothstepAB(temp, TEMP_COLD - B, TEMP_COLD + B) *
        smoothstepAB(temp, TEMP_HOT + B, TEMP_HOT - B) *
        smoothstepAB(moist, MOIST_DRY - B, MOIST_DRY + B)
      );

    case Biome.Desert:
      return smoothstepAB(temp, TEMP_HOT - B, TEMP_HOT + B) * smoothstepAB(moist, MOIST_DRY_HOT + B, MOIST_DRY_HOT - B);

    case Biome.Swamp:
      return smoothstepAB(temp, TEMP_HOT - B, TEMP_HOT + B) * smoothstepAB(moist, MOIST_DRY_HOT - B, MOIST_DRY_HOT + B);
  }
}

// Returns height params blended smoothly across biome boundaries.
function blendedHeightParams(temp: number, moist: number): { base: number; amp: number } {
  const biomes = [Biome.Tundra, Biome.Mountain, Biome.Forest, Biome.Desert, Biome.Swamp] as const;
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
// Mountain snow line is noise-driven so coverage is irregular rather than a flat cutoff.
export function surfaceBlock(biome: Biome, height: number, seed: number, gx: number, gz: number): CubeType {
  if (biome === Biome.Mountain) {
    const snowLine = 85 + valueNoise(seed + 77, gx, gz, 1 / 50) * 20; // varies ~85–105
    if (height > snowLine) return CubeType.Snow;
  }
  return BIOME_INFOS[biome].surface;
}

// Spillover priority: higher value always wins at biome surface boundaries.
// Mountain > Desert > Swamp > Forest > Tundra
function biomePriority(biome: Biome): number {
  switch (biome) {
    case Biome.Mountain:
      return 4;
    case Biome.Desert:
      return 3;
    case Biome.Swamp:
      return 2;
    case Biome.Forest:
      return 1;
    case Biome.Tundra:
      return 0;
  }
}

// Single entry point for chunk generation: returns biome + surfaceBiome + final height.
// biome      — structural: drives height blending and fluid fill. Clean, no islands.
// surfaceBiome — visual only: top surface block type, uses high-freq jitter to spill
//               patches of neighbouring biome surface across the boundary.
export function sampleColumn(
  seed: number,
  gx: number,
  gz: number,
): { biome: Biome; surfaceBiome: Biome; height: number } {
  // Different frequencies break the quadrant-corner alignment between axes.
  const temp = valueNoiseFbm(seed + 7, gx, gz, 1 / 250);
  const moist = valueNoiseFbm(seed + 13, gx, gz, 1 / 110);
  const biome = computeBiome(temp, moist);

  // // Surface spillover: sample the biome function at a nearby world-space position.
  // // This guarantees surfaceBiome is always from an actually-adjacent region — it can never
  // // jump to a distant biome that isn't geographically nearby.
  // // If the neighbor is a different biome, a per-column noise value picks the winner.
  const nx = gx + (valueNoiseFbm(seed + 53, gx, gz, 1 / 60) - 0.5) * 5;
  const nz = gz + (valueNoiseFbm(seed + 59, gx, gz, 1 / 60) - 0.5) * 5;
  const nTemp = valueNoiseFbm(seed + 7, nx, nz, 1 / 250);
  const nMoist = valueNoiseFbm(seed + 13, nx, nz, 1 / 110);
  const njTemp = nTemp + (valueNoiseFbm(seed + 41, nx, nz, 1 / 50) - 0.5) * 0.11;
  const njMoist = nMoist + (valueNoiseFbm(seed + 43, nx, nz, 1 / 40) - 0.5) * 0.11;
  const neighborBiome = computeBiome(njTemp, njMoist);

  // Higher-priority neighbor wins only when a per-column noise gate passes —
  // so only a scattered subset of boundary blocks actually get spilled.
  const spillGate = valueNoise(seed + 71, gx, gz, 1 / 12) > 0.52;
  const surfaceBiome =
    neighborBiome !== biome && biomePriority(neighborBiome) > biomePriority(biome) && spillGate ? neighborBiome : biome;
  const raw = terrainHeight(seed, gx, gz);
  const { base, amp } = blendedHeightParams(temp, moist);
  const height = Math.round(base + (raw / 100 - 0.5) * 2 * amp);
  return { biome, surfaceBiome, height };
}
