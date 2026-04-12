import type { Entity } from "../game/entity";

const DEFAULT_DRIFT_SQ = 4;

/**
 * Client-side entity wrapper that implements client-side prediction and server
 * reconciliation.
 *
 * Inputs are applied locally the moment they are generated (`predict`), then
 * queued for the server. When the server acknowledges inputs via a snapshot,
 * `reconcile` trims the history and re-applies any un-acked inputs on top of
 * the authoritative state.
 */
export class ClientEntity<S extends object, I> {
  private inputHistory: I[] = [];
  private lastAcked = 0;
  private initialized = false;

  constructor(
    public entity: Entity<S, I>,
    private distanceSq: (a: S, b: S) => number,
    private threshold: number = DEFAULT_DRIFT_SQ,
  ) {}

  /**
   * Applies the input immediately to the local entity and appends it to the
   * unacknowledged input history.
   */
  predict(input: I) {
    this.entity.step(input);
    this.inputHistory.push(input);
  }

  /**
   * Reconciles the local entity against an authoritative server state.
   *
   * 1. Trims the input history by the number of newly acknowledged inputs.
   * 2. If the entity hasn't been initialised yet, or if the local state has
   *    drifted past the threshold, snaps to the server state and re-replays
   *    unacknowledged inputs.
   * 3. Returns `true` if the snap was applied (caller may want to reset orientation).
   */
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
