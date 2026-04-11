type ItemId = "dirt" | "wood" | "plank";

type Point = {
  x: number;
  y: number;
};

type Rect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type SlotLocation =
  | {
      index: number;
      kind: "craft";
    }
  | {
      index: number;
      kind: "inventory";
    };

type SlotTarget = SlotLocation | { kind: "output" };

type InventoryLayout = {
  craftGridLabel: Point;
  craftSlotRects: Rect[];
  dividerY: number;
  hintY: number;
  inventorySlotRects: Rect[];
  outputRect: Rect;
  panelRect: Rect;
  slotSize: number;
  titleY: number;
};

type InventoryItem = {
  count: number;
  id: ItemId;
  name: string;
  texture: HTMLImageElement | null;
};

type CraftingResult = {
  item: InventoryItem;
  sourceIndex: number;
};

const INVENTORY_SLOT_COUNT = 36;
const CRAFT_SLOT_COUNT = 4;
const SLOT_COLUMNS = 9;
const CRAFT_COLUMNS = 2;
const MAX_STACK_SIZE = 64;

const dirtTexture = new URL("../../assets/dirt.bmp", import.meta.url).href;
const woodTexture = new URL("../../assets/wood.bmp", import.meta.url).href;

function loadTexture(src: string): HTMLImageElement {
  const image = new Image();
  image.src = src;
  return image;
}

function targetKey(target: SlotTarget | null): string | null {
  if (!target) return null;
  if (target.kind === "output") return "output";
  return `${target.kind}:${target.index}`;
}

export class InventoryOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly textures: {
    dirt: HTMLImageElement;
    wood: HTMLImageElement;
  };
  private carriedItem: InventoryItem | null;
  private carriedPointer: Point;
  private craftSlots: (InventoryItem | null)[];
  private distributedDuringPress: boolean;
  private hoveredTargetKey: string | null;
  private inventorySlots: (InventoryItem | null)[];
  private lastDistributedTargetKey: string | null;
  private mouseIsDown: boolean;
  private open: boolean;
  private pressTarget: SlotTarget | null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context not available for inventory overlay");
    }

    this.canvas = canvas;
    this.ctx = ctx;
    this.textures = {
      dirt: loadTexture(dirtTexture),
      wood: loadTexture(woodTexture),
    };
    this.inventorySlots = Array<InventoryItem | null>(INVENTORY_SLOT_COUNT).fill(null);
    this.craftSlots = Array<InventoryItem | null>(CRAFT_SLOT_COUNT).fill(null);
    this.carriedItem = null;
    this.carriedPointer = { x: canvas.width / 2, y: canvas.height / 2 };
    this.distributedDuringPress = false;
    this.hoveredTargetKey = null;
    this.lastDistributedTargetKey = null;
    this.mouseIsDown = false;
    this.open = false;
    this.pressTarget = null;
    this.reset();
  }

  public reset(): void {
    this.inventorySlots = Array<InventoryItem | null>(INVENTORY_SLOT_COUNT).fill(null);
    this.inventorySlots[13] = this.createItem("dirt", 32);
    this.inventorySlots[30] = this.createItem("wood", 8);
    this.craftSlots = Array<InventoryItem | null>(CRAFT_SLOT_COUNT).fill(null);
    this.carriedItem = null;
    this.cancelDrag();
  }

  public setOpen(open: boolean): void {
    this.open = open;
    this.hoveredTargetKey = null;
    this.lastDistributedTargetKey = null;
    this.mouseIsDown = false;
    this.distributedDuringPress = false;
    this.pressTarget = null;
  }

  public isDragging(): boolean {
    return this.carriedItem !== null;
  }

  public handleMouseDown(mouse: MouseEvent): boolean {
    if (!this.open) return false;

    const point = this.toCanvasPoint(mouse);
    const target = this.targetAtPoint(point);
    const key = targetKey(target);
    this.mouseIsDown = true;
    this.pressTarget = target;
    this.distributedDuringPress = false;
    this.carriedPointer = point;
    this.hoveredTargetKey = key;
    this.lastDistributedTargetKey = key;

    if (this.carriedItem) {
      if (target?.kind === "output") {
        this.pickupCraftingOutput();
        this.pressTarget = null;
      }
      return true;
    }

    if (!target) {
      this.lastDistributedTargetKey = null;
      return true;
    }

    if (target.kind === "output") {
      this.pickupCraftingOutput();
      this.pressTarget = null;
      return true;
    }

    this.pickupFromSlot(target);
    this.pressTarget = null;
    return true;
  }

  public handleMouseMove(mouse: MouseEvent): boolean {
    if (!this.open) return false;

    const point = this.toCanvasPoint(mouse);
    const target = this.targetAtPoint(point);
    const key = targetKey(target);
    this.carriedPointer = point;
    this.hoveredTargetKey = key;

    if (this.mouseIsDown && this.carriedItem && key !== this.lastDistributedTargetKey) {
      if (target && target.kind !== "output") {
        const didDistribute = this.placeOneIntoSlot(target);
        this.distributedDuringPress = this.distributedDuringPress || didDistribute;
      }
    }

    this.lastDistributedTargetKey = key;
    return true;
  }

  public handleMouseUp(mouse: MouseEvent): boolean {
    if (!this.open) return false;

    const point = this.toCanvasPoint(mouse);
    const target = this.targetAtPoint(point);
    const releaseKey = targetKey(target);
    this.carriedPointer = point;
    this.hoveredTargetKey = releaseKey;

    if (
      this.mouseIsDown &&
      this.carriedItem &&
      !this.distributedDuringPress &&
      target &&
      target.kind !== "output" &&
      releaseKey === targetKey(this.pressTarget)
    ) {
      this.placeFullIntoSlot(target);
    }

    this.mouseIsDown = false;
    this.distributedDuringPress = false;
    this.pressTarget = null;
    this.lastDistributedTargetKey = releaseKey;
    return true;
  }

  public handleMouseLeave(): void {
    this.hoveredTargetKey = null;
    this.lastDistributedTargetKey = null;
  }

  public cancelDrag(): void {
    this.hoveredTargetKey = null;
    this.lastDistributedTargetKey = null;
    this.mouseIsDown = false;
    this.distributedDuringPress = false;
    this.pressTarget = null;
  }

  public draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.open) return;

    const layout = this.getLayout();
    const craftingResult = this.getCraftingResult();

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawPanel(layout);
    this.drawCraftingGuide(layout, craftingResult !== null);

    for (let slotIndex = 0; slotIndex < this.inventorySlots.length; slotIndex += 1) {
      const rect = layout.inventorySlotRects[slotIndex];
      const slot = this.inventorySlots[slotIndex];
      const key = targetKey({ kind: "inventory", index: slotIndex });

      this.drawSlot(rect, {
        activeDropTarget: this.carriedItem !== null && this.hoveredTargetKey === key,
        filled: slot !== null,
        hovered: this.carriedItem === null && this.hoveredTargetKey === key,
      });

      if (slot) {
        this.drawItem(slot, rect, layout.slotSize);
      }
    }

    for (let slotIndex = 0; slotIndex < this.craftSlots.length; slotIndex += 1) {
      const rect = layout.craftSlotRects[slotIndex];
      const slot = this.craftSlots[slotIndex];
      const key = targetKey({ kind: "craft", index: slotIndex });

      this.drawSlot(rect, {
        activeDropTarget: this.carriedItem !== null && this.hoveredTargetKey === key,
        filled: slot !== null,
        hovered: this.carriedItem === null && this.hoveredTargetKey === key,
      });

      if (slot) {
        this.drawItem(slot, rect, layout.slotSize);
      }
    }

    this.drawOutputSlot(layout.outputRect, craftingResult, this.hoveredTargetKey === "output");
    this.drawDivider(layout);

    if (this.carriedItem) {
      this.drawCarriedItem(this.carriedItem, this.carriedPointer, layout.slotSize);
    }

    ctx.restore();
  }

  private createItem(id: ItemId, count: number): InventoryItem {
    switch (id) {
      case "dirt":
        return { count, id, name: "Dirt", texture: this.textures.dirt };
      case "wood":
        return { count, id, name: "Wood", texture: this.textures.wood };
      case "plank":
        return { count, id, name: "Planks", texture: null };
      default:
        throw new Error(`Unknown item id: ${id satisfies never}`);
    }
  }

  private cloneItem(item: InventoryItem): InventoryItem {
    return this.createItem(item.id, item.count);
  }

  private toCanvasPoint(mouse: MouseEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: ((mouse.clientX - bounds.left) * this.canvas.width) / bounds.width,
      y: ((mouse.clientY - bounds.top) * this.canvas.height) / bounds.height,
    };
  }

  private targetAtPoint(point: Point): SlotTarget | null {
    const layout = this.getLayout();

    for (let slotIndex = 0; slotIndex < layout.inventorySlotRects.length; slotIndex += 1) {
      if (this.pointInRect(point, layout.inventorySlotRects[slotIndex])) {
        return { kind: "inventory", index: slotIndex };
      }
    }

    for (let slotIndex = 0; slotIndex < layout.craftSlotRects.length; slotIndex += 1) {
      if (this.pointInRect(point, layout.craftSlotRects[slotIndex])) {
        return { kind: "craft", index: slotIndex };
      }
    }

    if (this.pointInRect(point, layout.outputRect)) {
      return { kind: "output" };
    }

    return null;
  }

  private pointInRect(point: Point, rect: Rect): boolean {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  private getSlotItem(location: SlotLocation): InventoryItem | null {
    return location.kind === "inventory" ? this.inventorySlots[location.index] : this.craftSlots[location.index];
  }

  private setSlotItem(location: SlotLocation, item: InventoryItem | null): void {
    if (location.kind === "inventory") {
      this.inventorySlots[location.index] = item;
      return;
    }

    this.craftSlots[location.index] = item;
  }

  private pickupFromSlot(location: SlotLocation): boolean {
    const slot = this.getSlotItem(location);
    if (!slot) return false;

    this.carriedItem = this.cloneItem(slot);
    this.setSlotItem(location, null);
    return true;
  }

  private placeOneIntoSlot(target: SlotLocation): boolean {
    if (!this.carriedItem) return false;

    const targetSlot = this.getSlotItem(target);

    if (!targetSlot) {
      this.setSlotItem(target, this.createItem(this.carriedItem.id, 1));
      this.consumeCarriedItem(1);
      return true;
    }

    if (targetSlot.id !== this.carriedItem.id || targetSlot.count >= MAX_STACK_SIZE) {
      return false;
    }

    targetSlot.count += 1;
    this.consumeCarriedItem(1);
    return true;
  }

  private placeFullIntoSlot(target: SlotLocation): boolean {
    if (!this.carriedItem) return false;

    const targetSlot = this.getSlotItem(target);

    if (!targetSlot) {
      this.setSlotItem(target, this.cloneItem(this.carriedItem));
      this.carriedItem = null;
      return true;
    }

    if (targetSlot.id === this.carriedItem.id) {
      const availableSpace = MAX_STACK_SIZE - targetSlot.count;
      if (availableSpace <= 0) return false;

      const movedAmount = Math.min(availableSpace, this.carriedItem.count);
      targetSlot.count += movedAmount;
      this.consumeCarriedItem(movedAmount);
      return movedAmount > 0;
    }

    const swappedItem = this.cloneItem(targetSlot);
    this.setSlotItem(target, this.cloneItem(this.carriedItem));
    this.carriedItem = swappedItem;
    return true;
  }

  private consumeCarriedItem(amount: number): void {
    if (!this.carriedItem) return;

    this.carriedItem.count -= amount;
    if (this.carriedItem.count <= 0) {
      this.carriedItem = null;
      this.lastDistributedTargetKey = null;
    }
  }

  private getCraftingResult(): CraftingResult | null {
    let woodSourceIndex: number | null = null;

    for (let slotIndex = 0; slotIndex < this.craftSlots.length; slotIndex += 1) {
      const slot = this.craftSlots[slotIndex];
      if (!slot) continue;
      if (slot.id !== "wood" || woodSourceIndex !== null) return null;
      woodSourceIndex = slotIndex;
    }

    if (woodSourceIndex === null) return null;

    return {
      item: this.createItem("plank", 4),
      sourceIndex: woodSourceIndex,
    };
  }

  private pickupCraftingOutput(): boolean {
    const result = this.getCraftingResult();
    if (!result) return false;

    if (!this.canAcceptCraftingResult(result.item)) return false;

    if (!this.carriedItem) {
      this.carriedItem = this.cloneItem(result.item);
    } else {
      this.carriedItem.count += result.item.count;
    }

    const sourceSlot = this.craftSlots[result.sourceIndex];
    if (!sourceSlot) return false;

    if (sourceSlot.count <= 1) {
      this.craftSlots[result.sourceIndex] = null;
    } else {
      sourceSlot.count -= 1;
    }

    return true;
  }

  private canAcceptCraftingResult(item: InventoryItem): boolean {
    if (!this.carriedItem) return true;
    if (this.carriedItem.id !== item.id) return false;
    return this.carriedItem.count + item.count <= MAX_STACK_SIZE;
  }

  private getLayout(): InventoryLayout {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const gap = Math.max(8, Math.floor(Math.min(width, height) * 0.009));
    const slotSize = Math.max(44, Math.floor(Math.min((width * 0.58 - gap * 8) / 9, 62)));
    const panelPaddingX = Math.round(slotSize * 0.45);
    const panelPaddingTop = Math.round(slotSize * 0.38);
    const panelPaddingBottom = Math.round(slotSize * 0.45);
    const craftLabelHeight = 18;
    const craftGridHeight = slotSize * 2 + gap;
    const headerHeight = Math.max(Math.round(slotSize * 1.25), craftLabelHeight + craftGridHeight + 10);
    const headerGap = Math.round(slotSize * 0.28);
    const dividerGap = Math.round(slotSize * 0.62);

    const gridWidth = SLOT_COLUMNS * slotSize + (SLOT_COLUMNS - 1) * gap;
    const mainGridHeight = slotSize * 3 + gap * 2;
    const hotbarHeight = slotSize;

    const panelWidth = gridWidth + panelPaddingX * 2;
    const panelHeight =
      panelPaddingTop + headerHeight + headerGap + mainGridHeight + dividerGap + hotbarHeight + panelPaddingBottom;

    const panelRect: Rect = {
      x: Math.round((width - panelWidth) / 2),
      y: Math.round((height - panelHeight) / 2),
      width: panelWidth,
      height: panelHeight,
    };

    const outputRect: Rect = {
      x: panelRect.x + panelRect.width - panelPaddingX - slotSize,
      y: panelRect.y + panelPaddingTop + craftLabelHeight + Math.round((craftGridHeight - slotSize) / 2),
      width: slotSize,
      height: slotSize,
    };

    const craftGridX = outputRect.x - Math.round(slotSize * 1.2) - (slotSize * CRAFT_COLUMNS + gap);
    const craftGridY = panelRect.y + panelPaddingTop + craftLabelHeight + 4;
    const craftSlotRects: Rect[] = [];

    for (let row = 0; row < CRAFT_COLUMNS; row += 1) {
      for (let column = 0; column < CRAFT_COLUMNS; column += 1) {
        craftSlotRects.push({
          x: craftGridX + column * (slotSize + gap),
          y: craftGridY + row * (slotSize + gap),
          width: slotSize,
          height: slotSize,
        });
      }
    }

    const inventoryGridX = panelRect.x + panelPaddingX;
    const mainGridY = panelRect.y + panelPaddingTop + headerHeight + headerGap;
    const hotbarY = mainGridY + mainGridHeight + dividerGap;

    const inventorySlotRects: Rect[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < SLOT_COLUMNS; column += 1) {
        inventorySlotRects.push({
          x: inventoryGridX + column * (slotSize + gap),
          y: mainGridY + row * (slotSize + gap),
          width: slotSize,
          height: slotSize,
        });
      }
    }

    for (let column = 0; column < SLOT_COLUMNS; column += 1) {
      inventorySlotRects.push({
        x: inventoryGridX + column * (slotSize + gap),
        y: hotbarY,
        width: slotSize,
        height: slotSize,
      });
    }

    return {
      craftGridLabel: {
        x: craftGridX,
        y: panelRect.y + panelPaddingTop,
      },
      craftSlotRects,
      dividerY: hotbarY - Math.round(dividerGap / 2),
      hintY: panelRect.y + panelPaddingTop - 2,
      inventorySlotRects,
      outputRect,
      panelRect,
      slotSize,
      titleY: panelRect.y + panelPaddingTop + 16,
    };
  }

  private drawPanel(layout: InventoryLayout): void {
    const ctx = this.ctx;
    const { panelRect } = layout;

    ctx.fillStyle = "rgba(197, 186, 164, 0.94)";
    ctx.fillRect(panelRect.x, panelRect.y, panelRect.width, panelRect.height);

    ctx.strokeStyle = "#20180f";
    ctx.lineWidth = 4;
    ctx.strokeRect(panelRect.x, panelRect.y, panelRect.width, panelRect.height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(panelRect.x + 6, panelRect.y + 6, panelRect.width - 12, panelRect.height - 12);

    ctx.fillStyle = "#5a4a36";
    ctx.font = "700 13px monospace";
    ctx.textBaseline = "top";
    ctx.fillText("PRESS E TO CLOSE", panelRect.x + 24, layout.hintY);

    ctx.fillStyle = "#241b12";
    ctx.font = "700 30px monospace";
    ctx.fillText("INVENTORY", panelRect.x + 24, layout.titleY);
  }

  private drawCraftingGuide(layout: InventoryLayout, hasResult: boolean): void {
    const ctx = this.ctx;
    const label = layout.craftGridLabel;
    const leftCraftRect = layout.craftSlotRects[1];
    const outputRect = layout.outputRect;
    const arrowStartX = leftCraftRect.x + leftCraftRect.width + 12;
    const arrowEndX = outputRect.x - 12;
    const arrowY = outputRect.y + outputRect.height / 2;

    ctx.fillStyle = "#5a4a36";
    ctx.font = "700 14px monospace";
    ctx.textBaseline = "top";
    ctx.fillText("CRAFTING", label.x, label.y);

    ctx.strokeStyle = hasResult ? "#f1df9f" : "#6f624c";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(arrowStartX, arrowY);
    ctx.lineTo(arrowEndX, arrowY);
    ctx.stroke();

    ctx.fillStyle = hasResult ? "#f1df9f" : "#6f624c";
    ctx.beginPath();
    ctx.moveTo(arrowEndX, arrowY);
    ctx.lineTo(arrowEndX - 12, arrowY - 8);
    ctx.lineTo(arrowEndX - 12, arrowY + 8);
    ctx.closePath();
    ctx.fill();
  }

  private drawDivider(layout: InventoryLayout): void {
    const ctx = this.ctx;
    const dividerWidth = layout.panelRect.width - 48;
    const dividerX = layout.panelRect.x + 24;

    ctx.fillStyle = "rgba(36, 27, 18, 0.35)";
    ctx.fillRect(dividerX, layout.dividerY, dividerWidth, 3);
  }

  private drawOutputSlot(rect: Rect, result: CraftingResult | null, hovered: boolean): void {
    this.drawSlot(rect, {
      activeDropTarget: false,
      filled: result !== null,
      hovered: this.carriedItem === null && hovered,
    });

    if (result) {
      this.drawItem(result.item, rect, rect.width);
    }
  }

  private drawSlot(
    rect: Rect,
    state: {
      activeDropTarget: boolean;
      filled: boolean;
      hovered: boolean;
    },
  ): void {
    const ctx = this.ctx;

    ctx.fillStyle = state.filled ? "#8f7c5a" : "#5c4e3b";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.strokeStyle = state.activeDropTarget ? "#f1df9f" : state.hovered ? "#cfc2a4" : "#463728";
    ctx.lineWidth = state.activeDropTarget ? 4 : 3;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 6);
  }

  private drawItem(item: InventoryItem, rect: Rect, slotSize: number): void {
    const ctx = this.ctx;
    const iconPadding = Math.max(6, Math.round(slotSize * 0.12));
    const iconSize = rect.width - iconPadding * 2;

    if (item.texture && item.texture.complete && item.texture.naturalWidth > 0) {
      ctx.drawImage(item.texture, rect.x + iconPadding, rect.y + iconPadding, iconSize, iconSize);
    } else {
      this.drawGeneratedItemIcon(item.id, rect.x + iconPadding, rect.y + iconPadding, iconSize);
    }

    ctx.fillStyle = "#f5efe2";
    ctx.font = `700 ${Math.max(14, Math.round(slotSize * 0.28))}px monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 3;
    const textX = rect.x + rect.width - 6;
    const textY = rect.y + rect.height - 4;
    const countText = String(item.count);
    ctx.strokeText(countText, textX, textY);
    ctx.fillText(countText, textX, textY);
    ctx.textAlign = "start";
  }

  private drawGeneratedItemIcon(id: ItemId, x: number, y: number, size: number): void {
    const ctx = this.ctx;

    switch (id) {
      case "dirt":
        ctx.fillStyle = "#6a4327";
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = "#547f39";
        ctx.fillRect(x, y, size, Math.max(6, Math.round(size * 0.28)));
        break;
      case "wood":
        ctx.fillStyle = "#8b6945";
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = "#6d5034";
        ctx.fillRect(x + size * 0.16, y, Math.max(4, size * 0.12), size);
        ctx.fillRect(x + size * 0.52, y, Math.max(4, size * 0.12), size);
        break;
      case "plank": {
        ctx.fillStyle = "#b58a57";
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = "#8e693d";
        const stripHeight = Math.max(4, Math.round(size * 0.18));
        ctx.fillRect(x, y + stripHeight, size, Math.max(2, Math.round(size * 0.06)));
        ctx.fillRect(x, y + stripHeight * 3, size, Math.max(2, Math.round(size * 0.06)));
        ctx.fillRect(x, y + stripHeight * 5, size, Math.max(2, Math.round(size * 0.06)));
        break;
      }
      default:
        break;
    }
  }

  private drawCarriedItem(item: InventoryItem, pointer: Point, slotSize: number): void {
    const previewSize = Math.round(slotSize * 1.08);
    const previewRect: Rect = {
      x: Math.round(pointer.x - previewSize / 2),
      y: Math.round(pointer.y - previewSize / 2),
      width: previewSize,
      height: previewSize,
    };

    this.drawSlot(previewRect, {
      activeDropTarget: false,
      filled: true,
      hovered: false,
    });
    this.drawItem(item, previewRect, previewSize);
  }
}
