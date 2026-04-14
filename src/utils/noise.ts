import { bilerp, smoothstep } from "./interpolations";

/** Maps integer coordinates (x, z) to a pseudorandom value in [0, 1] */
export function hash2D(seed: number, x: number, z: number): number {
  let hash = seed;
  hash = (hash ^ (x * 374761393)) & 0x7fffffff;
  hash = (hash ^ (z * 668265263)) & 0x7fffffff;
  hash = (hash * 1274126177) & 0x7fffffff;
  return hash / 0x7fffffff;
}

/** Maps 3D integer coordinates to a pseudorandom value in [0, 1] */
export function hash3D(seed: number, x: number, y: number, z: number): number {
  let hash = seed;
  hash = (hash ^ (x * 374761393)) & 0x7fffffff;
  hash = (hash ^ (y * 668265263)) & 0x7fffffff;
  hash = (hash ^ (z * 1013904223)) & 0x7fffffff;
  hash = (hash * 1274126177) & 0x7fffffff;
  return hash / 0x7fffffff;
}

// 12 gradient vectors for 3D Perlin noise (edges of a cube)
const GRAD3: [number, number, number][] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

/** Gradient dot product at a 3D lattice point */
function grad3D(seed: number, ix: number, iy: number, iz: number, dx: number, dy: number, dz: number): number {
  const g = GRAD3[Math.floor(hash3D(seed, ix, iy, iz) * 12)] as [number, number, number];
  return g[0] * dx + g[1] * dy + g[2] * dz;
}

/** 3D Perlin noise returning a value in approximately [-1, 1] */
export function perlin3D(seed: number, x: number, y: number, z: number, frequency: number): number {
  const sx = x * frequency;
  const sy = y * frequency;
  const sz = z * frequency;

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const z0 = Math.floor(sz);
  const fx = sx - x0;
  const fy = sy - y0;
  const fz = sz - z0;

  // Fade curves (smoothstep)
  const u = smoothstep(fx);
  const v = smoothstep(fy);
  const w = smoothstep(fz);

  // Gradient dot products at 8 corners
  const n000 = grad3D(seed, x0, y0, z0, fx, fy, fz);
  const n100 = grad3D(seed, x0 + 1, y0, z0, fx - 1, fy, fz);
  const n010 = grad3D(seed, x0, y0 + 1, z0, fx, fy - 1, fz);
  const n110 = grad3D(seed, x0 + 1, y0 + 1, z0, fx - 1, fy - 1, fz);
  const n001 = grad3D(seed, x0, y0, z0 + 1, fx, fy, fz - 1);
  const n101 = grad3D(seed, x0 + 1, y0, z0 + 1, fx - 1, fy, fz - 1);
  const n011 = grad3D(seed, x0, y0 + 1, z0 + 1, fx, fy - 1, fz - 1);
  const n111 = grad3D(seed, x0 + 1, y0 + 1, z0 + 1, fx - 1, fy - 1, fz - 1);

  // Trilinear interpolation
  const nx00 = n000 + u * (n100 - n000);
  const nx10 = n010 + u * (n110 - n010);
  const nx01 = n001 + u * (n101 - n001);
  const nx11 = n011 + u * (n111 - n011);
  const nxy0 = nx00 + v * (nx10 - nx00);
  const nxy1 = nx01 + v * (nx11 - nx01);
  return nxy0 + w * (nxy1 - nxy0);
}

/** Multi-octave 3D Perlin noise (fBm) */
export function perlin3DOctaves(
  seed: number,
  x: number,
  y: number,
  z: number,
  frequency: number,
  octaves: number = 3,
  lacunarity: number = 2.0,
  persistence: number = 0.5,
): number {
  let value = 0;
  let amp = 1;
  let freq = frequency;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += perlin3D(seed + i * 31, x, y, z, freq) * amp;
    maxAmp += amp;
    freq *= lacunarity;
    amp *= persistence;
  }
  return value / maxAmp;
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
