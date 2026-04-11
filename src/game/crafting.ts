import { ITEM_IDS } from "./item.ts";

export type ItemStack = {
  itemId: number;
  count: number;
};

export type Recipe = {
  inputs: ItemStack[];
  output: ItemStack;
  pattern?: number[][];
};

export const recipes: Recipe[] = [
  {
    inputs: [{ itemId: ITEM_IDS.WOOD, count: 1 }],
    output: { itemId: ITEM_IDS.WOOD_PLANK, count: 4 },
  },
  {
    inputs: [{ itemId: ITEM_IDS.WOOD_PLANK, count: 2 }],
    output: { itemId: ITEM_IDS.STICK, count: 4 },
    pattern: [[ITEM_IDS.WOOD_PLANK], [ITEM_IDS.WOOD_PLANK]],
  },
];
