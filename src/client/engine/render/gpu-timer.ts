interface TimerQueryExt {
  createQueryEXT(): object | null;
  deleteQueryEXT(query: object): void;
  beginQueryEXT(target: number, query: object): void;
  endQueryEXT(target: number): void;
  getQueryObjectEXT(query: object, pname: number): unknown;
  readonly TIME_ELAPSED_EXT: number;
  readonly QUERY_RESULT_AVAILABLE_EXT: number;
  readonly QUERY_RESULT_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/**
 * Async GPU timer using the EXT_disjoint_timer_query extension.
 *
 * Query results arrive 1-2 frames late, so the class maintains a queue of
 * pending queries and drains completed ones each frame.
 */
export class GpuTimer {
  private readonly ext: TimerQueryExt | null;
  private readonly gl: WebGLRenderingContext;
  private pending: object[] = [];
  private active = false;
  lastTimeMs = 0;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query") as TimerQueryExt | null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    if (!this.ext) return;
    const query = this.ext.createQueryEXT();
    if (!query) return;
    this.pending.push(query);
    this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, query);
    this.active = true;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT);
    this.active = false;
  }

  /** Drain completed queries and update `lastTimeMs`. */
  poll(): void {
    if (!this.ext || this.pending.length === 0) return;

    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;

    for (;;) {
      const query = this.pending[0];
      if (!query) break;
      const available = this.ext.getQueryObjectEXT(query, this.ext.QUERY_RESULT_AVAILABLE_EXT) as boolean;
      if (!available) break;

      this.pending.shift();
      if (!disjoint) {
        const ns = this.ext.getQueryObjectEXT(query, this.ext.QUERY_RESULT_EXT) as number;
        this.lastTimeMs = ns / 1_000_000;
      }
      this.ext.deleteQueryEXT(query);
    }
  }
}
