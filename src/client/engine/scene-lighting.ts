import { DAY_LENGTH_S } from "@/game/time";

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class SceneLighting {
  readonly lightPosition = new Float32Array(4);
  /** Actual sun position (never flipped). Used by the skybox to place sun & moon. */
  readonly sunPosition = new Float32Array(4);
  readonly backgroundColor = new Float32Array(4);
  readonly ambientColor = new Float32Array(3);
  readonly sunColor = new Float32Array(3);

  update(timeOfDayS: number): void {
    const t = timeOfDayS % DAY_LENGTH_S;
    const angle = (t / DAY_LENGTH_S) * Math.PI * 2;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    // Gamified day/night curve: snappy transitions at the horizon, long
    // plateaus of "full day" and "full night". Smoothstep gives an S-shaped
    // ramp that avoids the slow linear fade of raw max(0, sinA).
    const day = smoothstep(-0.08, 0.22, sinA);
    const night = smoothstep(-0.08, 0.22, -sinA);

    // Actual sun position — skybox uses this to place the sun disc (and the
    // moon at its negation). Terrain/player lighting uses `lightPosition`
    // which flips to the moon direction at night so light doesn't come from
    // below the horizon.
    this.sunPosition[0] = cosA * 2000;
    this.sunPosition[1] = sinA * 2000;
    this.sunPosition[2] = 600;
    this.sunPosition[3] = 1;

    // Light source tracks the sun during the day and the moon (directly
    // opposite the sun) at night. Blending by `night` smoothly flips the
    // direction so lighting never comes from below the horizon; at twilight
    // the horizontal component shrinks to ~0 while the z=600 overhead
    // contribution keeps light predominantly from above.
    const dirSign = 1 - 2 * night;
    this.lightPosition[0] = cosA * 2000 * dirSign;
    this.lightPosition[1] = sinA * 2000 * dirSign;
    this.lightPosition[2] = 600;
    this.lightPosition[3] = 1;
    // Horizon glow — asymmetric bell pivoted slightly above the true horizon
    // (sinA = horizonPivot). The above-pivot wing is wide so the warm palette
    // lingers during the descent into sunset and the tail after sunrise; the
    // below-pivot wing is narrow so the glow snaps off once the sun nears or
    // crosses the horizon. Offsetting the pivot above 0 means the peak colors
    // appear while the sun is still a little above the horizon — matching how
    // real sunsets look strongest just before the sun actually sets.;
    const horizonWidth = sinA >= 0 ? 0.6 : 0.18;
    const horizonShape = Math.max(0, 1 - Math.abs(sinA) / horizonWidth);
    const horizon = horizonShape * horizonShape * 0.55;

    const sinFromPivot = sinA - 0.04;
    const fogHorizonWidth = sinFromPivot >= 0 ? 0.6 : 0.1;
    const fogHorizonShape = Math.max(0, 1 - Math.abs(sinFromPivot) / fogHorizonWidth);
    const fogHorizon = fogHorizonShape * fogHorizonShape * 0.55;

    this.backgroundColor[0] = Math.min(1, day * 0.4 + fogHorizon * 0.92 + night * 0.02);
    this.backgroundColor[1] = Math.min(1, day * 0.62 + fogHorizon * 0.42 + night * 0.02);
    this.backgroundColor[2] = Math.min(1, day * 0.96 + fogHorizon * 0.12 + night * 0.1);
    this.backgroundColor[3] = 1;

    this.ambientColor[0] = day * 0.445 + fogHorizon * 0.35 + night * 0.04;
    this.ambientColor[1] = day * 0.45 + fogHorizon * 0.18 + night * 0.04;
    this.ambientColor[2] = day * 0.567 + fogHorizon * 0.06 + night * 0.1;

    this.sunColor[0] = day * 1.0 + horizon * 1.0 + night * 0.3;
    this.sunColor[1] = day * 0.99 + horizon * 0.52 + night * 0.32;
    this.sunColor[2] = day * 0.97 + horizon * 0.1 + night * 0.5;
  }
}
