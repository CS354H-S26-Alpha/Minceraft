import type { Entity } from "@/game/entity";

/**
 * Client-side entity wrapper that implements client-side prediction with
 * server ack trimming.
 *
 * Inputs are applied locally the moment they are generated (`predict`), then
 * queued for the server. When the server acknowledges inputs via a snapshot,
 * `acknowledge` trims the history. `initialize` is called once with the
 * authoritative state from the first snapshot (or on teleport).
 */
export class LocalPrediction<S extends object, I> {
  private inputHistory: I[] = [];
  private lastAcked = 0;

  constructor(public entity: Entity<S, I>) {}

  /**
   * Applies the input immediately to the local entity and appends it to the
   * unacknowledged input history.
   */
  predict(input: I) {
    this.entity.step(input);
    this.inputHistory.push(input);
  }

  /** Clears prediction history and snaps the entity to the given state. */
  teleport(authoritative: Partial<S>) {
    this.inputHistory = [];
    Object.assign(this.entity.state, authoritative);
  }

  /** Trims acknowledged inputs from the history. */
  acknowledge(acked: number) {
    const newlyAcked = acked - this.lastAcked;
    this.lastAcked = acked;
    this.inputHistory.splice(0, newlyAcked);
  }

  /**
   * Sets entity to the authoritative state and replays any unacknowledged
   * inputs on top. Used for initialization (first join) or teleport.
   */
  initialize(authoritative: S) {
    Object.assign(this.entity.state, authoritative);
    for (const input of this.inputHistory) {
      this.entity.step(input);
    }
  }
}
