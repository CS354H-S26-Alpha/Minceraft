import { Vec3 } from "gl-matrix";
import { Entity } from "./entity";
import { getItemDamage, ITEM_DEFINITIONS_BY_ID, type ItemId, isItemId } from "./items";

// minceraft yoinked
export const PLAYER_SPEED = 4.317;
export const PLAYER_GRAVITY = 32;
export const PLAYER_JUMP_VELOCITY = 8.944;
export const PLAYER_MAX_FALL_SPEED = 78.4;
export const PLAYER_MAX_HEALTH = 20;
export const PLAYER_EYE_OFFSET = 1.62;
export const HOTBAR_SLOT_COUNT = 9;
export const MAIN_INVENTORY_SLOT_COUNT = 27;
export const INVENTORY_SLOT_COUNT = MAIN_INVENTORY_SLOT_COUNT + HOTBAR_SLOT_COUNT;
export const HOTBAR_START_INDEX = MAIN_INVENTORY_SLOT_COUNT;

const MAX_DT_SECONDS = 2;
export const MAX_COORDINATE = 100_000;
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
  vy: number;
  health: number;
  inventory: InventorySlot[];
  selectedHotbarSlot: number;
}

export interface PlayerInput {
  dx: number;
  dz: number;
  dtSeconds: number;
  yaw: number;
  pitch: number;
  jump: boolean;
}

const GROUND_EPSILON = 1e-3;

export type CollisionQuery = (x: number, z: number, currentY: number) => number;

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

export function getSelectedHotbarInventoryIndex(selectedHotbarSlot: number): number {
  return HOTBAR_START_INDEX + clampHotbarSlot(selectedHotbarSlot);
}

export function getSelectedHotbarItem(state: Pick<PlayerState, "inventory" | "selectedHotbarSlot">): InventorySlot {
  return state.inventory[getSelectedHotbarInventoryIndex(state.selectedHotbarSlot)] ?? null;
}

export function getHeldItemDamage(state: Pick<PlayerState, "inventory" | "selectedHotbarSlot">): number {
  return getItemDamage(getSelectedHotbarItem(state)?.itemId);
}

export function getPlayerEyePosition(state: Pick<PlayerState, "x" | "y" | "z">) {
  return {
    x: state.x,
    y: state.y + PLAYER_EYE_OFFSET,
    z: state.z,
  };
}

export function createPlayerState(
  args: PlayerPublicState & {
    vy?: number;
    health?: number;
    inventory?: readonly InventorySlot[] | null;
    selectedHotbarSlot?: number;
  },
): PlayerState {
  return {
    ...args,
    vy: Number.isFinite(args.vy) ? (args.vy as number) : 0,
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
  const {
    vy: _vy,
    health: _health,
    inventory: _inventory,
    selectedHotbarSlot: _selectedHotbarSlot,
    ...publicState
  } = state;
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

export interface PlayerPositionPacket {
  sequence: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PlayerAttackPacket {
  targetPlayerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Server/client-shared player entity. The same class runs on both sides. */
export class Player extends Entity<PlayerState, PlayerInput> {
  public static readonly CYLINDER_RADIUS = 0.3;
  public static readonly CYLINDER_HEIGHT = 1.8;
  /** Distance from feet to camera — Minecraft eye height. */
  public static readonly EYE_OFFSET = PLAYER_EYE_OFFSET;

  public collisionQuery: CollisionQuery | undefined = undefined;

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

  takeDamage(amount: number): boolean {
    if (!Number.isFinite(amount)) return false;
    const damage = Math.max(0, Math.trunc(amount));
    if (damage <= 0 || this.state.health <= 0) return false;
    const nextHealth = Math.max(0, this.state.health - damage);
    if (nextHealth === this.state.health) return false;
    this.state.health = nextHealth;
    return true;
  }

  publicState(): PlayerPublicState {
    return toPublicPlayerState(this.state);
  }

  /**
   * Applies one input frame: updates facing, integrates horizontal intent at
   * `PLAYER_SPEED`, and — when a `collisionQuery` is wired — applies gravity,
   * jump, and per-axis collision against the voxel world.
   */
  step({ dx, dz, dtSeconds, yaw, pitch, jump }: PlayerInput) {
    if (
      !Number.isFinite(dx) ||
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

    const currentX = this.state.x;
    const currentY = this.state.y;
    const currentZ = this.state.z;

    const mag2 = dx * dx + dz * dz;
    let nextX = currentX;
    let nextZ = currentZ;
    if (mag2 > 0) {
      const inv = (PLAYER_SPEED * dtSeconds) / Math.sqrt(mag2);
      nextX = clampCoord(currentX + dx * inv);
      nextZ = clampCoord(currentZ + dz * inv);
    }

    if (this.collisionQuery === undefined) {
      this.state.x = nextX;
      this.state.z = nextZ;
      return;
    }

    const minYAtNextXCurrentZ = this.collisionQuery(nextX, currentZ, currentY);
    if (currentY < minYAtNextXCurrentZ) nextX = currentX;

    const minYAtCurrentXNextZ = this.collisionQuery(currentX, nextZ, currentY);
    if (currentY < minYAtCurrentXNextZ) nextZ = currentZ;

    let floorY = this.collisionQuery(nextX, nextZ, currentY);
    if (currentY < floorY) {
      nextX = currentX;
      nextZ = currentZ;
      floorY = this.collisionQuery(currentX, currentZ, currentY);
    }
    const grounded = currentY - floorY < GROUND_EPSILON;

    let vy = this.state.vy;
    if (grounded && jump && vy <= 0) vy = PLAYER_JUMP_VELOCITY;
    vy -= PLAYER_GRAVITY * dtSeconds;
    if (vy < -PLAYER_MAX_FALL_SPEED) vy = -PLAYER_MAX_FALL_SPEED;

    let nextY = clampCoord(currentY + vy * dtSeconds);
    if (nextY < floorY) {
      nextY = floorY;
      vy = 0;
    }

    this.state.vy = vy;
    this.state.x = nextX;
    this.state.y = nextY;
    this.state.z = nextZ;
  }
}

function clampCoord(v: number): number {
  if (v > MAX_COORDINATE) return MAX_COORDINATE;
  if (v < -MAX_COORDINATE) return -MAX_COORDINATE;
  return v;
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
