export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  delta -= Math.round(delta / (2 * Math.PI)) * (2 * Math.PI);
  return a + delta * t;
}

/** Cubic smoothstep: maps t in [0,1] to a smooth [0,1] */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// smooth step from 0 to 1 between A and B
export function smoothstepAB(t: number, A: number, B: number): number {
  const x = Math.max(0, Math.min(1, (t - A) / (B - A)));
  return smoothstep(x);
}

/** Bilinear interpolation with smoothstep on both axes */
export function bilerp(v00: number, v10: number, v01: number, v11: number, tx: number, tz: number): number {
  const sx = smoothstep(tx);
  const sz = smoothstep(tz);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sz) + (v01 * (1 - sx) + v11 * sx) * sz;
}
