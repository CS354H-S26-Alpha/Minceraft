import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createStarterInventory, PLAYER_MAX_HEALTH } from "../game/player";

const STARTER_INVENTORY_JSON = JSON.stringify(createStarterInventory());

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  z: real("z").notNull(),
  yaw: real("yaw").notNull().default(0),
  pitch: real("pitch").notNull().default(0),
  health: integer("health").notNull().default(PLAYER_MAX_HEALTH),
  inventory: text("inventory").notNull().default(STARTER_INVENTORY_JSON),
  selectedHotbarSlot: integer("selected_hotbar_slot").notNull().default(0),
});
