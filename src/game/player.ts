import { Vec3 } from "gl-matrix";
import { Entity } from "./entity";
import { ITEM_DEFINITIONS_BY_ID, type ItemId, isItemId } from "./items";

export const PLAYER_SPEED = 30;
export const PLAYER_MAX_HEALTH = 20;
export const HOTBAR_SLOT_COUNT = 9;
export const MAIN_INVENTORY_SLOT_COUNT = 27;
export const INVENTORY_SLOT_COUNT = MAIN_INVENTORY_SLOT_COUNT + HOTBAR_SLOT_COUNT;
export const HOTBAR_START_INDEX = MAIN_INVENTORY_SLOT_COUNT;

const MAX_DT_SECONDS = 2;
const MAX_COORDINATE = 100_000;
const DEFAULT_SELECTED_HOTBAR_SLOT = 0;

export interface ItemStack {
  itemId: ItemId;
  quantity: number;
}

export type InventorySlot = ItemStack | null;

export interface PlayerPublicState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PlayerState extends PlayerPublicState {
  health: number;
  inventory: InventorySlot[];
  selectedHotbarSlot: number;
}

export interface PlayerInput {
  dx: number;
  dy: number;
  dz: number;
  dtSeconds: number;
  yaw: number;
  pitch: number;
}

export function createEmptyInventory(): InventorySlot[] {
  return Array.from({ length: INVENTORY_SLOT_COUNT }, () => null);
}

export function createStarterInventory(): InventorySlot[] {
  const inventory = createEmptyInventory();
  inventory[HOTBAR_START_INDEX] = { itemId: "wood", quantity: 8 };
  inventory[HOTBAR_START_INDEX + 1] = { itemId: "wood_plank", quantity: 16 };
  inventory[HOTBAR_START_INDEX + 2] = { itemId: "stick", quantity: 6 };
  inventory[HOTBAR_START_INDEX + 3] = { itemId: "dirt", quantity: 32 };
  inventory[0] = { itemId: "wood", quantity: 12 };
  inventory[1] = { itemId: "dirt", quantity: 64 };
  return inventory;
}

export function cloneInventorySlot(slot: InventorySlot): InventorySlot {
  return slot ? { ...slot } : null;
}

export function cloneInventory(inventory: readonly InventorySlot[]): InventorySlot[] {
  return inventory.map((slot) => cloneInventorySlot(slot));
}

export function normalizeInventory(inventory?: readonly InventorySlot[] | null): InventorySlot[] {
  const normalized = createEmptyInventory();
  const source = inventory ?? [];
  for (let index = 0; index < Math.min(source.length, INVENTORY_SLOT_COUNT); index++) {
    normalized[index] = normalizeInventorySlot(source[index]);
  }
  return normalized;
}

export function clampHotbarSlot(slotIndex: number): number {
  if (!Number.isFinite(slotIndex)) return DEFAULT_SELECTED_HOTBAR_SLOT;
  return Math.min(HOTBAR_SLOT_COUNT - 1, Math.max(0, Math.trunc(slotIndex)));
}

export function createPlayerState(
  args: PlayerPublicState & {
    health?: number;
    inventory?: readonly InventorySlot[] | null;
    selectedHotbarSlot?: number;
  },
): PlayerState {
  return {
    ...args,
    health: normalizeHealth(args.health),
    inventory: args.inventory === undefined ? createStarterInventory() : normalizeInventory(args.inventory),
    selectedHotbarSlot: clampHotbarSlot(args.selectedHotbarSlot ?? DEFAULT_SELECTED_HOTBAR_SLOT),
  };
}

export function clonePlayerState(state: PlayerState): PlayerState {
  return {
    ...state,
    inventory: cloneInventory(state.inventory),
  };
}

export function toPublicPlayerState(state: PlayerState): PlayerPublicState {
  const { health: _health, inventory: _inventory, selectedHotbarSlot: _selectedHotbarSlot, ...publicState } = state;
  return publicState;
}

export function addItemToInventory(inventory: InventorySlot[], stack: ItemStack): ItemStack | null {
  const item = ITEM_DEFINITIONS_BY_ID[stack.itemId];
  let remaining = Math.trunc(stack.quantity);
  if (remaining <= 0) return null;

  for (let index = 0; index < inventory.length; index++) {
    const slot = inventory[index];
    if (!slot || slot.itemId !== stack.itemId) continue;
    if (slot.quantity >= item.maxStack) continue;
    const space = item.maxStack - slot.quantity;
    const added = Math.min(space, remaining);
    inventory[index] = {
      itemId: slot.itemId,
      quantity: slot.quantity + added,
    };
    remaining -= added;
    if (remaining === 0) return null;
  }

  for (let index = 0; index < inventory.length; index++) {
    if (inventory[index]) continue;
    const added = Math.min(item.maxStack, remaining);
    inventory[index] = {
      itemId: stack.itemId,
      quantity: added,
    };
    remaining -= added;
    if (remaining === 0) return null;
  }

  return {
    itemId: stack.itemId,
    quantity: remaining,
  };
}

/** Server/client-shared player entity. The same class runs on both sides. */
export class Player extends Entity<PlayerState, PlayerInput> {
  /** Unique player identifier (alias for `state.id`). */
  get id() {
    return this.state.id;
  }

  /** Current world-space position as a Vec3. */
  get position(): Vec3 {
    return new Vec3([this.state.x, this.state.y, this.state.z]);
  }

  get hotbarInventory(): readonly InventorySlot[] {
    return this.state.inventory.slice(HOTBAR_START_INDEX);
  }

  setSelectedHotbarSlot(slotIndex: number): boolean {
    const normalized = clampHotbarSlot(slotIndex);
    if (normalized === this.state.selectedHotbarSlot) return false;
    this.state.selectedHotbarSlot = normalized;
    return true;
  }

  addItem(stack: ItemStack): ItemStack | null {
    return addItemToInventory(this.state.inventory, stack);
  }

  publicState(): PlayerPublicState {
    return toPublicPlayerState(this.state);
  }

  /**
   * Applies one input frame: validates the input, normalises the movement
   * vector to a constant speed, and clamps coordinates within world bounds.
   * TODO: Handle sending new snapshot to client when movement on server is unexpected.
   */
  step({ dx, dy, dz, dtSeconds, yaw, pitch }: PlayerInput) {
    if (
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      !Number.isFinite(dz) ||
      !Number.isFinite(dtSeconds) ||
      !Number.isFinite(yaw) ||
      !Number.isFinite(pitch) ||
      dtSeconds <= 0 ||
      dtSeconds > MAX_DT_SECONDS
    )
      return;

    this.state.yaw = yaw;
    this.state.pitch = pitch;
    const mag2 = dx * dx + dy * dy + dz * dz;
    if (mag2 === 0) return;
    const inv = (PLAYER_SPEED * dtSeconds) / Math.sqrt(mag2);
    this.state.x = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.x + dx * inv));
    this.state.y = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.y + dy * inv));
    this.state.z = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, this.state.z + dz * inv));
  }
}

function normalizeInventorySlot(slot: InventorySlot | undefined): InventorySlot {
  if (!slot) return null;
  if (!isItemId(slot.itemId)) return null;
  if (!Number.isFinite(slot.quantity)) return null;
  const maxStack = ITEM_DEFINITIONS_BY_ID[slot.itemId].maxStack;
  const quantity = Math.trunc(slot.quantity);
  if (quantity <= 0) return null;
  return {
    itemId: slot.itemId,
    quantity: Math.min(maxStack, quantity),
  };
}

function normalizeHealth(health?: number): number {
  if (health === undefined || !Number.isFinite(health)) return PLAYER_MAX_HEALTH;
  return Math.max(0, Math.min(PLAYER_MAX_HEALTH, Math.trunc(health)));
}
