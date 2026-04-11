type ItemId = "dirt" | "wood";

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

type InventoryLayout = {
  dividerY: number;
  hintY: number;
  panelRect: Rect;
  slotRects: Rect[];
  slotSize: number;
  titleY: number;
};

type InventoryItem = {
  count: number;
  id: ItemId;
  name: string;
  texture: HTMLImageElement;
};

type InventorySlot = InventoryItem | null;

type InventoryDragState = {
  pointer: Point;
  sourceIndex: number;
};

const TOTAL_SLOTS = 36;
const HOTBAR_START_INDEX = 27;
const SLOT_COLUMNS = 9;

const dirtTexture = new URL("../../assets/dirt.bmp", import.meta.url).href;
const woodTexture = new URL("../../assets/wood.bmp", import.meta.url).href;

function loadTexture(src: string): HTMLImageElement {
  const image = new Image();
  image.src = src;
  return image;
}

function createInitialSlots(textures: Record<ItemId, HTMLImageElement>): InventorySlot[] {
  const slots = Array<InventorySlot>(TOTAL_SLOTS).fill(null);
  slots[13] = {
    id: "dirt",
    name: "Dirt",
    texture: textures.dirt,
    count: 32,
  };
  slots[30] = {
    id: "wood",
    name: "Wood",
    texture: textures.wood,
    count: 8,
  };
  return slots;
}

export class InventoryOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly textures: Record<ItemId, HTMLImageElement>;
  private dragState: InventoryDragState | null;
  private hoveredSlotIndex: number | null;
  private open: boolean;
  private slots: InventorySlot[];

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
    this.slots = createInitialSlots(this.textures);
    this.open = false;
    this.dragState = null;
    this.hoveredSlotIndex = null;
  }

  public setOpen(open: boolean): void {
    this.open = open;
    this.hoveredSlotIndex = null;
    if (!open) this.dragState = null;
  }

  public isDragging(): boolean {
    return this.dragState !== null;
  }

  public handleMouseDown(mouse: MouseEvent): boolean {
    if (!this.open) return false;

    const point = this.toCanvasPoint(mouse);
    const slotIndex = this.slotIndexAtPoint(point);
    this.hoveredSlotIndex = slotIndex;

    if (slotIndex === null || !this.slots[slotIndex]) return true;

    this.dragState = {
      pointer: point,
      sourceIndex: slotIndex,
    };
    return true;
  }

  public handleMouseMove(mouse: MouseEvent): boolean {
    if (!this.open) return false;

    const point = this.toCanvasPoint(mouse);
    this.hoveredSlotIndex = this.slotIndexAtPoint(point);

    if (this.dragState) {
      this.dragState.pointer = point;
    }

    return true;
  }

  public handleMouseUp(mouse: MouseEvent): boolean {
    if (!this.open) return false;

    const point = this.toCanvasPoint(mouse);
    const targetIndex = this.slotIndexAtPoint(point);

    if (this.dragState && targetIndex !== null && targetIndex !== this.dragState.sourceIndex) {
      const sourceIndex = this.dragState.sourceIndex;
      const sourceItem = this.slots[sourceIndex];
      this.slots[sourceIndex] = this.slots[targetIndex];
      this.slots[targetIndex] = sourceItem;
    }

    this.dragState = null;
    this.hoveredSlotIndex = targetIndex;
    return true;
  }

  public handleMouseLeave(): void {
    if (!this.dragState) {
      this.hoveredSlotIndex = null;
    }
  }

  public cancelDrag(): void {
    this.dragState = null;
    this.hoveredSlotIndex = null;
  }

  public draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.open) return;

    const layout = this.getLayout();

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawPanel(layout);

    for (let slotIndex = 0; slotIndex < layout.slotRects.length; slotIndex += 1) {
      const rect = layout.slotRects[slotIndex];
      const slot = this.slots[slotIndex];
      const draggedHere = this.dragState?.sourceIndex === slotIndex;
      const targetHere = this.hoveredSlotIndex === slotIndex;

      this.drawSlot(rect, {
        activeDropTarget: this.dragState !== null && targetHere,
        dimmed: draggedHere,
        filled: slot !== null,
        hovered: this.dragState === null && targetHere,
      });

      if (slot && !draggedHere) {
        this.drawItem(slot, rect, layout.slotSize);
      }
    }

    this.drawDivider(layout);

    if (this.dragState) {
      const draggedItem = this.slots[this.dragState.sourceIndex];
      if (draggedItem) {
        this.drawDragPreview(draggedItem, this.dragState.pointer, layout.slotSize);
      }
    }

    ctx.restore();
  }

  private toCanvasPoint(mouse: MouseEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: ((mouse.clientX - bounds.left) * this.canvas.width) / bounds.width,
      y: ((mouse.clientY - bounds.top) * this.canvas.height) / bounds.height,
    };
  }

  private slotIndexAtPoint(point: Point): number | null {
    const layout = this.getLayout();

    for (let slotIndex = 0; slotIndex < layout.slotRects.length; slotIndex += 1) {
      const rect = layout.slotRects[slotIndex];
      const insideX = point.x >= rect.x && point.x <= rect.x + rect.width;
      const insideY = point.y >= rect.y && point.y <= rect.y + rect.height;
      if (insideX && insideY) return slotIndex;
    }

    return null;
  }

  private getLayout(): InventoryLayout {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const gap = Math.max(8, Math.floor(Math.min(width, height) * 0.009));
    const slotSize = Math.max(44, Math.floor(Math.min((width * 0.58 - gap * 8) / 9, 62)));
    const panelPaddingX = Math.round(slotSize * 0.45);
    const panelPaddingTop = Math.round(slotSize * 0.55);
    const panelPaddingBottom = Math.round(slotSize * 0.45);
    const headerHeight = Math.round(slotSize * 1.05);
    const dividerGap = Math.round(slotSize * 0.6);

    const gridWidth = SLOT_COLUMNS * slotSize + (SLOT_COLUMNS - 1) * gap;
    const mainGridHeight = slotSize * 3 + gap * 2;
    const hotbarHeight = slotSize;

    const panelWidth = gridWidth + panelPaddingX * 2;
    const panelHeight =
      panelPaddingTop + headerHeight + mainGridHeight + dividerGap + hotbarHeight + panelPaddingBottom;

    const panelRect: Rect = {
      x: Math.round((width - panelWidth) / 2),
      y: Math.round((height - panelHeight) / 2),
      width: panelWidth,
      height: panelHeight,
    };

    const gridX = panelRect.x + panelPaddingX;
    const mainGridY = panelRect.y + panelPaddingTop + headerHeight;
    const hotbarY = mainGridY + mainGridHeight + dividerGap;

    const slotRects: Rect[] = [];

    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < SLOT_COLUMNS; column += 1) {
        slotRects.push({
          x: gridX + column * (slotSize + gap),
          y: mainGridY + row * (slotSize + gap),
          width: slotSize,
          height: slotSize,
        });
      }
    }

    for (let column = 0; column < SLOT_COLUMNS; column += 1) {
      slotRects.push({
        x: gridX + column * (slotSize + gap),
        y: hotbarY,
        width: slotSize,
        height: slotSize,
      });
    }

    return {
      dividerY: hotbarY - Math.round(dividerGap / 2),
      hintY: panelRect.y + panelPaddingTop + Math.round(slotSize * 0.16),
      panelRect,
      slotRects,
      slotSize,
      titleY: panelRect.y + panelPaddingTop + Math.round(slotSize * 0.56),
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

  private drawDivider(layout: InventoryLayout): void {
    const ctx = this.ctx;
    const dividerWidth = layout.panelRect.width - 48;
    const dividerX = layout.panelRect.x + 24;

    ctx.fillStyle = "rgba(36, 27, 18, 0.35)";
    ctx.fillRect(dividerX, layout.dividerY, dividerWidth, 3);
  }

  private drawSlot(
    rect: Rect,
    state: {
      activeDropTarget: boolean;
      dimmed: boolean;
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

    if (state.dimmed) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  private drawItem(item: InventoryItem, rect: Rect, slotSize: number): void {
    const ctx = this.ctx;
    const iconPadding = Math.max(6, Math.round(slotSize * 0.12));
    const iconSize = rect.width - iconPadding * 2;

    if (item.texture.complete) {
      ctx.drawImage(item.texture, rect.x + iconPadding, rect.y + iconPadding, iconSize, iconSize);
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

  private drawDragPreview(item: InventoryItem, pointer: Point, slotSize: number): void {
    const previewSize = Math.round(slotSize * 1.08);
    const previewRect: Rect = {
      x: Math.round(pointer.x - previewSize / 2),
      y: Math.round(pointer.y - previewSize / 2),
      width: previewSize,
      height: previewSize,
    };

    this.drawSlot(previewRect, {
      activeDropTarget: false,
      dimmed: false,
      filled: true,
      hovered: false,
    });
    this.drawItem(item, previewRect, previewSize);
  }
}
