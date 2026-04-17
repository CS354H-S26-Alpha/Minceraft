import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type * as schema from "../server/schema";
import type { ServerPacket } from "./protocol";

/** Context passed to `packetsFor()` so systems can scope per-client output. */
export interface SystemContext {
  /** IDs of all currently connected players in the room. */
  readonly onlinePlayerIds: ReadonlySet<string>;
}

/**
 * A self-contained unit of server game state. Systems own their in-memory
 * state, know how to hydrate/flush to SQLite, advance on each tick, and emit
 * typed packets for every connected client.
 */
export interface GameSystem {
  /** Unique storage key used to identify this system in the DB. */
  readonly key: string;
  /** Load all persisted state from SQLite into memory. */
  hydrate(db: DrizzleSqliteDODatabase<typeof schema>): void;
  /** Advance the system by one tick; return `true` if any client-visible state changed. */
  tick(): boolean | Promise<boolean>;
  /** Build the set of packets this system wants to send to the given player. */
  packetsFor(playerId: string, ctx: SystemContext): ServerPacket[];
  /** Clear any per-broadcast pending flags set during this tick. */
  clearPending(): void;
  /** Returns `true` if any persistent state is unsaved. */
  hasDirty(): boolean;
  /** Write all dirty state to SQLite and clear the dirty set. */
  flush(db: DrizzleSqliteDODatabase<typeof schema>): void;
}
