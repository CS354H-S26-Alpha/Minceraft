import { bilerp } from "./interpolations";

/** Maps integer coordinates (x, z) to a pseudorandom value in [0, 1] */
export function hash2D(seed: number, x: number, z: number): number {
  let hash = seed;
  hash = (hash ^ (x * 374761393)) & 0x7fffffff;
  hash = (hash ^ (z * 668265263)) & 0x7fffffff;
  hash = (hash * 1274126177) & 0x7fffffff;
  return hash / 0x7fffffff;
}

/** Value noise in [0, 1] at a given frequency */
export function valueNoise(seed: number, x: number, z: number, frequency: number): number {
  const sx = x * frequency,
    sz = z * frequency;
  const x0 = Math.floor(sx),
    z0 = Math.floor(sz);
  return bilerp(
    hash2D(seed, x0, z0),
    hash2D(seed, x0 + 1, z0),
    hash2D(seed, x0, z0 + 1),
    hash2D(seed, x0 + 1, z0 + 1),
    sx - x0,
    sz - z0,
  );
}

/**
 * 3-octave terrain height in [0, 100].
 * Octave weights: 50 / 25 / 12.5 (max sum = 87.5).
 */
export function terrainHeight(seed: number, x: number, z: number): number {
  const h =
    valueNoise(seed, x, z, 1 / 16) * 50 + valueNoise(seed, x, z, 1 / 8) * 25 + valueNoise(seed, x, z, 1 / 4) * 12.5;
  return Math.floor((h / 87.5) * 100);
}
