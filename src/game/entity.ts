import { createMutable, type StoreNode } from "solid-js/store";

/**
 * Base class for all game entities.
 * @template S - the serialisable state type
 * @template I - the input type consumed by `step`
 */
export abstract class Entity<S extends StoreNode, I> {
  constructor(public state: S) {
    // Allow reactive tracking of state changes
    this.state = createMutable(state);
  }

  /** Advance the entity by one input frame. */
  abstract step(input: I): void;
}
