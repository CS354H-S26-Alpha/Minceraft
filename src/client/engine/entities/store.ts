/** Server tick interval — used as the default interpolation period. */
const SERVER_TICK_MS = 50;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  delta -= Math.round(delta / (2 * Math.PI)) * (2 * Math.PI);
  return a + delta * t;
}

interface TrackedEntity<S> {
  prev: S;
  curr: S;
  updatedAt: number;
}

/**
 * Buffers the two most recent snapshots for each remote entity and
 * interpolates between them. Adds one tick of visual latency (~50 ms) but
 * produces smooth movement at any client frame rate.
 */
export class RemoteEntityStore<S> {
  private entities = new Map<string, TrackedEntity<S>>();

  constructor(private interpolateFn: (prev: S, curr: S, t: number) => S) {}

  /** Feed the latest snapshot keyed by entity id. */
  update(entities: Record<string, S>, now: number) {
    const seen = new Set<string>();
    for (const [id, state] of Object.entries(entities)) {
      seen.add(id);
      const entry = this.entities.get(id);
      if (entry) {
        entry.prev = entry.curr;
        entry.curr = state;
        entry.updatedAt = now;
      } else {
        this.entities.set(id, { prev: state, curr: state, updatedAt: now });
      }
    }
    for (const id of this.entities.keys()) {
      if (!seen.has(id)) this.entities.delete(id);
    }
  }

  /** Returns interpolated state for every tracked entity. */
  interpolated(now: number): S[] {
    const result: S[] = [];
    for (const entry of this.entities.values()) {
      const t = Math.min((now - entry.updatedAt) / SERVER_TICK_MS, 1);
      result.push(this.interpolateFn(entry.prev, entry.curr, t));
    }
    return result;
  }
}
