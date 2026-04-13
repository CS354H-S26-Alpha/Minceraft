import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type * as schema from "../server/schema";

/** Manages a group of entities within the game room — hydration, ticking, and SQLite persistence. */
export interface EntityCollection {
  /** Unique storage key used to identify this collection in the DB. */
  readonly key: string;
  /** Load all persisted entities from SQLite into memory. */
  hydrate(db: DrizzleSqliteDODatabase<typeof schema>): void;
  /** Apply all queued inputs and return `true` if any entity changed. */
  tick(): boolean;
  /** Returns `true` if any entity has unsaved state. */
  hasDirty(): boolean;
  /** Write all dirty entities to SQLite and clear the dirty set. */
  flush(db: DrizzleSqliteDODatabase<typeof schema>): void;
}
