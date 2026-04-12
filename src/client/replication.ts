import type { Entity } from "../game/entity";

const DEFAULT_DRIFT_SQ = 4;

export class ClientEntity<S extends object, I> {
  private inputHistory: I[] = [];
  private lastAcked = 0;
  private initialized = false;

  constructor(
    public entity: Entity<S, I>,
    private distanceSq: (a: S, b: S) => number,
    private threshold: number = DEFAULT_DRIFT_SQ,
  ) {}

  predict(input: I) {
    this.entity.step(input);
    this.inputHistory.push(input);
  }

  reconcile(authoritative: S, acked: number): boolean {
    const newlyAcked = acked - this.lastAcked;
    this.lastAcked = acked;
    this.inputHistory.splice(0, newlyAcked);

    if (this.initialized && this.distanceSq(this.entity.state, authoritative) < this.threshold) return false;

    this.initialized = true;
    Object.assign(this.entity.state, authoritative);
    for (const input of this.inputHistory) {
      this.entity.step(input);
    }
    return true;
  }
}
