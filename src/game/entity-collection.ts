import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type * as schema from "../server/schema";

export interface EntityCollection {
  readonly key: string;
  hydrate(db: DrizzleSqliteDODatabase<typeof schema>): void;
  tick(): boolean;
  hasDirty(): boolean;
  flush(db: DrizzleSqliteDODatabase<typeof schema>): void;
}
