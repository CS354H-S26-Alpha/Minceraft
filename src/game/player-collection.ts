import { eq } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type * as schema from "../server/schema";
import * as playerSchema from "../server/schema";
import {
  cloneInventoryUiState,
  consumeCraftingIngredients,
  createInventoryUiState,
  getCraftingResult,
  type InventoryClickTarget,
  type InventoryUiState,
} from "./crafting";
import type { EntityCollection } from "./entity-collection";
import { ITEM_DEFINITIONS_BY_ID } from "./items";
import {
  cloneInventorySlot,
  clonePlayerState,
  createPlayerState,
  createStarterInventory,
  HOTBAR_SLOT_COUNT,
  INVENTORY_SLOT_COUNT,
  type InventorySlot,
  normalizeInventory,
  Player,
  type PlayerInput,
  type PlayerPublicState,
  type PlayerState,
  toPublicPlayerState,
} from "./player";

const SPAWN_POSITION = { x: 0, y: 70, z: 20, yaw: 0, pitch: 0 };
const MAX_QUEUED_INPUTS = 20;

/**
 * Manages the set of players in a room — their in-memory state, pending input
 * queues, ack counters, and dirty tracking for SQLite persistence.
 */
export class PlayerCollection implements EntityCollection {
  readonly key = "players";

  private players = new Map<string, Player>();
  private inputQueues = new Map<string, PlayerInput[]>();
  private acks = new Map<string, number>();
  private dirty = new Set<string>();
  private inventoryUi = new Map<string, InventoryUiState>();

  /** Restores all players from SQLite on DO startup. */
  hydrate(db: DrizzleSqliteDODatabase<typeof schema>): void {
    for (const row of db.select().from(playerSchema.players).all()) {
      this.players.set(
        row.id,
        new Player(
          createPlayerState({
            id: row.id,
            name: row.name,
            x: row.x,
            y: row.y,
            z: row.z,
            yaw: row.yaw,
            pitch: row.pitch,
            health: row.health,
            inventory: parsePersistedInventory(row.inventory),
            selectedHotbarSlot: row.selectedHotbarSlot,
          }),
        ),
      );
      this.inventoryUi.set(row.id, createInventoryUiState());
    }
  }

  /** Adds a new player at the spawn position if they aren't already tracked. */
  join(playerId: string, name: string): void {
    if (!this.players.has(playerId)) {
      this.players.set(
        playerId,
        new Player(
          createPlayerState({
            id: playerId,
            name,
            ...SPAWN_POSITION,
          }),
        ),
      );
      this.dirty.add(playerId);
    }
    this.inventoryUi.set(playerId, createInventoryUiState());
  }

  /** Clears the departing player's input queue; their state remains for persistence. */
  leave(playerId: string): void {
    this.inputQueues.delete(playerId);
    const player = this.players.get(playerId);
    const ui = this.inventoryUi.get(playerId);
    if (player && ui && this.returnCraftingItems(player, ui)) {
      this.dirty.add(playerId);
    }
    this.inventoryUi.delete(playerId);
  }

  /**
   * Appends inputs to a player's queue, capped at `MAX_QUEUED_INPUTS` to
   * bound memory usage and prevent lag exploitation.
   */
  queueInputs(playerId: string, inputs: PlayerInput[]): void {
    const queue = this.inputQueues.get(playerId);
    const remaining = MAX_QUEUED_INPUTS - (queue?.length ?? 0);
    if (remaining <= 0) return;
    const toAdd = inputs.slice(0, remaining);
    if (queue) {
      queue.push(...toAdd);
    } else {
      this.inputQueues.set(playerId, [...toAdd]);
    }
  }

  /**
   * Teleports a player to the given coordinates. Clears pending inputs
   * and bumps the ack counter so the client trims its prediction history.
   */
  teleportTo(playerId: string, x: number, y: number, z: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    player.state.x = x;
    player.state.y = y;
    player.state.z = z;

    const queue = this.inputQueues.get(playerId);
    if (queue) {
      this.acks.set(playerId, (this.acks.get(playerId) ?? 0) + queue.length);
      queue.length = 0;
    }

    this.dirty.add(playerId);
    return true;
  }

  /**
   * Drains all input queues, steps each player, increments ack counters, and
   * marks changed players as dirty. Returns `true` if any player moved.
   */
  tick(): boolean {
    let changed = false;
    for (const [id, queue] of this.inputQueues) {
      if (queue.length === 0) continue;
      const player = this.players.get(id);
      if (!player) continue;
      const prev = toPublicPlayerState(player.state);
      for (const input of queue) {
        player.step(input);
      }
      this.acks.set(id, (this.acks.get(id) ?? 0) + queue.length);
      queue.length = 0;
      if (playerMoved(prev, player.state)) {
        this.dirty.add(id);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Returns a state snapshot of all players. When `visiblePlayerIds` is
   * provided, only those players are included (used to hide offline players).
   */
  snapshot(visiblePlayerIds?: ReadonlySet<string>): Record<string, PlayerPublicState> {
    const result: Record<string, PlayerPublicState> = {};
    for (const [id, player] of this.players) {
      if (visiblePlayerIds && !visiblePlayerIds.has(id)) continue;
      result[id] = player.publicState();
    }
    return result;
  }

  selfState(playerId: string): PlayerState | undefined {
    const player = this.players.get(playerId);
    return player ? clonePlayerState(player.state) : undefined;
  }

  getInventoryUi(playerId: string): InventoryUiState | undefined {
    const state = this.inventoryUi.get(playerId);
    return state ? cloneInventoryUiState(state) : undefined;
  }

  interactInventory(playerId: string, target: InventoryClickTarget): boolean {
    const player = this.players.get(playerId);
    const ui = this.inventoryUi.get(playerId);
    if (!player || !ui) return false;

    let changed = false;
    if (target.container === "inventory") {
      if (!isValidInventoryIndex(target.index)) return false;
      changed = clickSlot(
        ui,
        () => player.state.inventory[target.index] ?? null,
        (slot) => {
          player.state.inventory[target.index] = slot;
        },
      );
    } else if (target.container === "crafting") {
      if (!isValidCraftingIndex(target.index, ui.craftingGrid)) return false;
      changed = clickSlot(
        ui,
        () => ui.craftingGrid[target.index] ?? null,
        (slot) => {
          ui.craftingGrid[target.index] = slot;
        },
      );
      this.refreshCraftingResult(ui);
    } else {
      changed = this.takeCraftingResult(ui);
    }

    if (!changed) return false;
    this.dirty.add(playerId);
    return true;
  }

  closeInventory(playerId: string): boolean {
    const player = this.players.get(playerId);
    const ui = this.inventoryUi.get(playerId);
    if (!player || !ui) return false;
    const changed = this.returnCraftingItems(player, ui);
    if (changed) {
      this.dirty.add(playerId);
    }
    return changed;
  }

  setSelectedHotbarSlot(playerId: string, slotIndex: number): boolean {
    if (slotIndex < 0 || slotIndex >= HOTBAR_SLOT_COUNT) return false;
    const player = this.players.get(playerId);
    if (!player?.setSelectedHotbarSlot(slotIndex)) return false;
    this.dirty.add(playerId);
    return true;
  }

  /**
   * Returns per-player ack counters, optionally filtered to online players.
   * The client uses these to trim its input history.
   */
  getAcks(visiblePlayerIds?: ReadonlySet<string>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id] of this.players) {
      if (visiblePlayerIds && !visiblePlayerIds.has(id)) continue;
      result[id] = this.acks.get(id) ?? 0;
    }
    return result;
  }

  /** Returns `true` if any player has unsaved changes. */
  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /** UPSERTs all dirty players to SQLite and clears the dirty set. */
  flush(db: DrizzleSqliteDODatabase<typeof schema>): void {
    for (const id of this.dirty) {
      const player = this.players.get(id);
      if (player) {
        const { id: playerId, ...state } = player.state;
        const row = { ...state, inventory: JSON.stringify(state.inventory) };
        db.insert(playerSchema.players)
          .values({ id: playerId, ...row })
          .onConflictDoUpdate({ target: playerSchema.players.id, set: row })
          .run();
      } else {
        db.delete(playerSchema.players).where(eq(playerSchema.players.id, id)).run();
      }
    }
    this.dirty.clear();
  }

  private refreshCraftingResult(ui: InventoryUiState) {
    ui.result = getCraftingResult(ui.craftingGrid);
  }

  private takeCraftingResult(ui: InventoryUiState): boolean {
    const result = ui.result;
    if (!result) return false;
    const maxStack = ITEM_DEFINITIONS_BY_ID[result.itemId].maxStack;

    const cursor = ui.cursor;
    if (!cursor) {
      ui.cursor = { ...result };
    } else if (cursor.itemId === result.itemId) {
      if (cursor.quantity + result.quantity > maxStack) return false;
      ui.cursor = {
        itemId: cursor.itemId,
        quantity: cursor.quantity + result.quantity,
      };
    } else {
      return false;
    }

    consumeCraftingIngredients(ui.craftingGrid);
    this.refreshCraftingResult(ui);
    return true;
  }

  private returnCraftingItems(player: Player, ui: InventoryUiState): boolean {
    let changed = false;
    for (let index = 0; index < ui.craftingGrid.length; index++) {
      const slot = ui.craftingGrid[index];
      if (!slot) continue;
      const leftover = player.addItem(slot);
      if (leftover) {
        ui.craftingGrid[index] = leftover;
      } else {
        ui.craftingGrid[index] = null;
        changed = true;
      }
    }

    if (ui.cursor) {
      const leftover = player.addItem(ui.cursor);
      if (!leftover) {
        ui.cursor = null;
        changed = true;
      } else {
        ui.cursor = leftover;
      }
    }

    this.refreshCraftingResult(ui);
    return changed;
  }
}

function clickSlot(
  ui: InventoryUiState,
  getSlot: () => InventorySlot,
  setSlot: (slot: InventorySlot) => void,
): boolean {
  const slot = getSlot();
  const cursor = ui.cursor;

  if (!slot && !cursor) return false;

  if (!cursor) {
    ui.cursor = cloneInventorySlot(slot);
    setSlot(null);
    return true;
  }

  if (!slot) {
    setSlot(cloneInventorySlot(cursor));
    ui.cursor = null;
    return true;
  }

  if (slot.itemId === cursor.itemId) {
    const merged = slot.quantity + cursor.quantity;
    const maxStack = ITEM_DEFINITIONS_BY_ID[slot.itemId].maxStack;
    if (merged <= maxStack) {
      setSlot({
        itemId: slot.itemId,
        quantity: merged,
      });
      ui.cursor = null;
      return true;
    }
    if (slot.quantity >= maxStack) return false;
    setSlot({
      itemId: slot.itemId,
      quantity: maxStack,
    });
    ui.cursor = {
      itemId: cursor.itemId,
      quantity: merged - maxStack,
    };
    return true;
  }

  setSlot(cloneInventorySlot(cursor));
  ui.cursor = cloneInventorySlot(slot);
  return true;
}

function isValidInventoryIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < INVENTORY_SLOT_COUNT;
}

function isValidCraftingIndex(index: number, craftingGrid: readonly InventorySlot[]): boolean {
  return Number.isInteger(index) && index >= 0 && index < craftingGrid.length;
}

function playerMoved(prev: PlayerPublicState, next: PlayerState): boolean {
  return (
    prev.x !== next.x || prev.y !== next.y || prev.z !== next.z || prev.yaw !== next.yaw || prev.pitch !== next.pitch
  );
}

function parsePersistedInventory(serialized: string): InventorySlot[] {
  try {
    return normalizeInventory(JSON.parse(serialized) as InventorySlot[] | null);
  } catch {
    return createStarterInventory();
  }
}
