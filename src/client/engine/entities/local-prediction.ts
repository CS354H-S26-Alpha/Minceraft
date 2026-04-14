import type { Entity } from "@/game/entity";

/**
 * Client-side entity wrapper for the local player.
 *
 * The client advances immediately from local controls. The server simulates
 * from the latest control intent independently, so normal movement no longer
 * needs per-frame reconciliation. `initialize` remains for the first snapshot
 * and teleports; `acknowledge` is a compatibility no-op.
 */
export class LocalPrediction<S extends object, I> {
  constructor(public entity: Entity<S, I>) {}

  predict(input: I) {
    this.entity.step(input);
  }

  /** Clears prediction history and snaps the entity to the given state. */
  teleport(authoritative: Partial<S>) {
    Object.assign(this.entity.state, authoritative);
  }

  acknowledge(_acked: number) {}

  initialize(authoritative: S) {
    Object.assign(this.entity.state, authoritative);
  }
}
