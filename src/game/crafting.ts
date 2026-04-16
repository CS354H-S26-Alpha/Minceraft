import type { ItemId } from "./items";
import { cloneInventorySlot, type InventorySlot } from "./player";

export const CRAFTING_GRID_WIDTH = 2;
export const CRAFTING_GRID_HEIGHT = 2;
export const CRAFTING_GRID_SLOT_COUNT = CRAFTING_GRID_WIDTH * CRAFTING_GRID_HEIGHT;

export interface CraftingRecipe {
  id: string;
  width: 1 | 2;
  height: 1 | 2;
  pattern: readonly (ItemId | null)[];
  output: {
    itemId: ItemId;
    quantity: number;
  };
}

export interface InventoryUiState {
  craftingGrid: InventorySlot[];
  cursor: InventorySlot;
  result: InventorySlot;
}

export type InventoryClickTarget =
  | {
      container: "inventory" | "crafting";
      index: number;
    }
  | {
      container: "result";
    };

const RECIPES: readonly CraftingRecipe[] = [
  {
    id: "wood-to-planks",
    width: 1,
    height: 1,
    pattern: ["wood"],
    output: {
      itemId: "wood_plank",
      quantity: 4,
    },
  },
  {
    id: "planks-to-sticks",
    width: 1,
    height: 2,
    pattern: ["wood_plank", "wood_plank"],
    output: {
      itemId: "stick",
      quantity: 4,
    },
  },
] as const;

export function createEmptyCraftingGrid(): InventorySlot[] {
  return Array.from({ length: CRAFTING_GRID_SLOT_COUNT }, () => null);
}

export function createInventoryUiState(): InventoryUiState {
  return {
    craftingGrid: createEmptyCraftingGrid(),
    cursor: null,
    result: null,
  };
}

export function cloneInventoryUiState(state: InventoryUiState): InventoryUiState {
  return {
    craftingGrid: state.craftingGrid.map((slot) => cloneInventorySlot(slot)),
    cursor: cloneInventorySlot(state.cursor),
    result: cloneInventorySlot(state.result),
  };
}

export function getCraftingResult(craftingGrid: readonly InventorySlot[]): InventorySlot {
  const normalized = normalizeCraftingPattern(craftingGrid);
  if (!normalized) return null;
  const recipe = RECIPES.find(
    (candidate) =>
      candidate.width === normalized.width &&
      candidate.height === normalized.height &&
      candidate.pattern.every((itemId, index) => itemId === normalized.pattern[index]),
  );
  if (!recipe) return null;
  return {
    itemId: recipe.output.itemId,
    quantity: recipe.output.quantity,
  };
}

export function consumeCraftingIngredients(craftingGrid: InventorySlot[]): void {
  for (let index = 0; index < craftingGrid.length; index++) {
    const slot = craftingGrid[index];
    if (!slot) continue;
    const nextQuantity = slot.quantity - 1;
    craftingGrid[index] = nextQuantity > 0 ? { itemId: slot.itemId, quantity: nextQuantity } : null;
  }
}

function normalizeCraftingPattern(craftingGrid: readonly InventorySlot[]): {
  width: 1 | 2;
  height: 1 | 2;
  pattern: (ItemId | null)[];
} | null {
  const occupiedIndices = craftingGrid.map((slot, index) => (slot ? index : -1)).filter((index) => index >= 0);

  if (occupiedIndices.length === 0) return null;

  const columns = occupiedIndices.map((index) => index % CRAFTING_GRID_WIDTH);
  const rows = occupiedIndices.map((index) => Math.floor(index / CRAFTING_GRID_WIDTH));
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const width = maxColumn - minColumn + 1;
  const height = maxRow - minRow + 1;

  const pattern: (ItemId | null)[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let column = minColumn; column <= maxColumn; column++) {
      const slot = craftingGrid[row * CRAFTING_GRID_WIDTH + column];
      pattern.push(slot?.itemId ?? null);
    }
  }

  return {
    width: width as 1 | 2,
    height: height as 1 | 2,
    pattern,
  };
}
