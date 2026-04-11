export type Item = {
  id: number;
  name: string;
  icon: string; // file path
};

export const items: Item[] = [
  { id: 0, name: "Dirt", icon: "../../assets/icons/dirt.png" },
  { id: 1, name: "Wood", icon: "../../assets/icons/wood.png" },
  { id: 2, name: "Wood Plank", icon: "../../assets/icons/wood_plank.png" },
  { id: 3, name: "Stick", icon: "../../assets/icons/stick.png" },
];

export const itemsById = new Map(items.map((item) => [item.id, item] as const));

export function getItemById(itemId: number): Item | undefined {
  return itemsById.get(itemId);
}

export const ITEM_IDS = {
  DIRT: 0,
  WOOD: 1,
  WOOD_PLANK: 2,
  STICK: 3,
} as const;
