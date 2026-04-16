import dirtIcon from "@/assets/icons/dirt.png";
import stickIcon from "@/assets/icons/stick.png";
import woodIcon from "@/assets/icons/wood.png";
import woodPlankIcon from "@/assets/icons/wood_plank.png";

export interface ItemDefinition {
  id: string;
  name: string;
  icon: string;
  maxStack: number;
  damage?: number;
}

export const DEFAULT_ITEM_DAMAGE = 1;

const itemDefinitions = [
  {
    id: "wood",
    name: "Wood",
    icon: woodIcon,
    maxStack: 64,
  },
  {
    id: "wood_plank",
    name: "Wood Plank",
    icon: woodPlankIcon,
    maxStack: 64,
  },
  {
    id: "stick",
    name: "Stick",
    icon: stickIcon,
    maxStack: 64,
    damage: 2,
  },
  {
    id: "dirt",
    name: "Dirt",
    icon: dirtIcon,
    maxStack: 64,
  },
] as const satisfies readonly ItemDefinition[];

export type ItemId = (typeof itemDefinitions)[number]["id"];

export const ITEM_DEFINITIONS: readonly (ItemDefinition & { id: ItemId })[] = itemDefinitions;

export const ITEM_DEFINITIONS_BY_ID = Object.fromEntries(ITEM_DEFINITIONS.map((item) => [item.id, item])) as Record<
  ItemId,
  ItemDefinition & { id: ItemId }
>;

export function isItemId(value: string): value is ItemId {
  return value in ITEM_DEFINITIONS_BY_ID;
}

export function getItemDamage(itemId: ItemId | null | undefined): number {
  if (!itemId) return DEFAULT_ITEM_DAMAGE;
  return normalizeDamage(ITEM_DEFINITIONS_BY_ID[itemId].damage);
}

function normalizeDamage(damage?: number): number {
  if (damage === undefined || !Number.isFinite(damage)) return DEFAULT_ITEM_DAMAGE;
  const normalized = Math.trunc(damage);
  return normalized > 0 ? normalized : DEFAULT_ITEM_DAMAGE;
}
