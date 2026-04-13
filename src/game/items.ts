export interface ItemDefinition {
  id: string;
  name: string;
  icon: string;
  maxStack: number;
}

const woodIcon = new URL("../assets/icons/wood.png", import.meta.url).href;
const woodPlankIcon = new URL("../assets/icons/wood_plank.png", import.meta.url).href;
const stickIcon = new URL("../assets/icons/stick.png", import.meta.url).href;
const dirtIcon = new URL("../assets/icons/dirt.png", import.meta.url).href;

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
