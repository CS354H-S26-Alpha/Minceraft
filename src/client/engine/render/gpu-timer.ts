interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/**
 * Async GPU timer using native WebGL2 queries with the
 * EXT_disjoint_timer_query_webgl2 extension for timing constants.
 *
 * Query results arrive 1-2 frames late, so the class maintains a queue of
 * pending queries and drains completed ones each frame.
 */
export class GpuTimer {
  private readonly ext: TimerQueryExt | null;
  private readonly gl: WebGL2RenderingContext;
  private pending: WebGLQuery[] = [];
  private active = false;
  lastTimeMs = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExt | null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    if (!this.ext) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.pending.push(query);
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = true;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.active = false;
  }

  /** Drain completed queries and update `lastTimeMs`. */
  poll(): void {
    if (!this.ext || this.pending.length === 0) return;

    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;

    for (;;) {
      const query = this.pending[0];
      if (!query) break;
      const available = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) break;

      this.pending.shift();
      if (!disjoint) {
        const ns = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number;
        this.lastTimeMs = ns / 1_000_000;
      }
      this.gl.deleteQuery(query);
    }
  }
}
