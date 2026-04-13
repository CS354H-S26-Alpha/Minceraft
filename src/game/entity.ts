/**
 * Base class for all game entities.
 * @template S - the serialisable state type
 * @template I - the input type consumed by `step`
 */
export abstract class Entity<S, I> {
  constructor(public state: S) {}

  /** Advance the entity by one input frame. */
  abstract step(input: I): void;
}
