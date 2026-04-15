const DAY_LENGTH_S = 240;
const PHASE_MS = (DAY_LENGTH_S / 4) * 1000;

/**
 * Scene-wide lighting state consumed by the renderer each frame.
 * Currently driven by a day/night cycle; additional sources (fog, weather)
 * can be layered in via `update()`.
 */
export class SceneLighting {
  readonly lightPosition = new Float32Array(4);
  readonly backgroundColor = new Float32Array(4);
  readonly ambientColor = new Float32Array(3);
  readonly sunColor = new Float32Array(3);

  private timeOffset = 0;

  /** Advance the day/night cycle by one phase. */
  skipPhase(): void {
    this.timeOffset += PHASE_MS;
  }

  /** Recompute all lighting state for the current frame. */
  update(nowMs: number): void {
    const t = ((nowMs + this.timeOffset) / 1000) % DAY_LENGTH_S;
    const angle = (t / DAY_LENGTH_S) * Math.PI * 2;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    this.lightPosition[0] = cosA * 2000;
    this.lightPosition[1] = sinA * 2000;
    this.lightPosition[2] = 600;
    this.lightPosition[3] = 1;

    const day = Math.max(0, sinA);
    const night = Math.max(0, -sinA);
    const horizon = Math.max(0, 1 - Math.abs(sinA) / 0.35) * 0.35;

    this.backgroundColor[0] = Math.min(1, day * 0.4 + horizon * 0.92 + night * 0.02);
    this.backgroundColor[1] = Math.min(1, day * 0.62 + horizon * 0.42 + night * 0.02);
    this.backgroundColor[2] = Math.min(1, day * 0.96 + horizon * 0.12 + night * 0.1);
    this.backgroundColor[3] = 1;

    this.ambientColor[0] = day * 0.28 + horizon * 0.35 + night * 0.04;
    this.ambientColor[1] = day * 0.28 + horizon * 0.18 + night * 0.04;
    this.ambientColor[2] = day * 0.32 + horizon * 0.06 + night * 0.1;

    this.sunColor[0] = day * 1.0 + horizon * 1.0 + night * 0.3;
    this.sunColor[1] = day * 0.96 + horizon * 0.52 + night * 0.32;
    this.sunColor[2] = day * 0.82 + horizon * 0.1 + night * 0.5;
  }
}
