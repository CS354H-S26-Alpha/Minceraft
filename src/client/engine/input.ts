export interface WalkKeys {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
}

export interface InputControllerOptions {
  canLook?: () => boolean;
  canMove?: () => boolean;
  onHotbarCycle?: (delta: number) => void;
  onHotbarSelect?: (index: number) => void;
  onInventoryToggle?: () => void;
  onMouseDown?: (event: MouseEvent) => boolean;
  onMouseLeave?: () => void;
  onMouseMove?: (event: MouseEvent) => boolean;
  onMouseUp?: (event: MouseEvent) => boolean;
  onReset?: () => void;
  onJump?: () => void;
}

export class InputController {
  private readonly abortController = new AbortController();
  private readonly keys: WalkKeys = { w: false, a: false, s: false, d: false };

  private dragging = false;
  private prevX = 0;
  private prevY = 0;
  private pendingMouseDx = 0;
  private pendingMouseDy = 0;

  constructor(canvas: HTMLCanvasElement, opts: InputControllerOptions = {}) {
    const { signal } = this.abortController;

    window.addEventListener("keydown", (e) => this.handleKeyDown(e, opts), { signal });
    window.addEventListener("keyup", (e) => this.handleKeyUp(e), { signal });
    canvas.addEventListener(
      "mousedown",
      (e) => {
        const handled = opts.onMouseDown?.(e) ?? false;
        if (handled || opts.canLook?.() === false) {
          this.dragging = false;
          return;
        }
        this.dragging = true;
        this.prevX = e.screenX;
        this.prevY = e.screenY;
      },
      { signal },
    );
    canvas.addEventListener(
      "mousemove",
      (e) => {
        const handled = opts.onMouseMove?.(e) ?? false;
        if (handled || !this.dragging || opts.canLook?.() === false) return;
        this.pendingMouseDx += e.screenX - this.prevX;
        this.pendingMouseDy += e.screenY - this.prevY;
        this.prevX = e.screenX;
        this.prevY = e.screenY;
      },
      { signal },
    );
    canvas.addEventListener(
      "mouseup",
      (e) => {
        opts.onMouseUp?.(e);
        this.dragging = false;
      },
      { signal },
    );
    canvas.addEventListener(
      "mouseleave",
      () => {
        opts.onMouseLeave?.();
        this.dragging = false;
      },
      { signal },
    );
    canvas.addEventListener(
      "wheel",
      (e) => {
        opts.onHotbarCycle?.(e.deltaY);
        if (opts.onHotbarCycle) {
          e.preventDefault();
        }
      },
      { signal, passive: false },
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
  }

  walkKeys(): Readonly<WalkKeys> {
    return this.keys;
  }

  clearWalkKeys(): void {
    this.keys.w = false;
    this.keys.a = false;
    this.keys.s = false;
    this.keys.d = false;
  }

  cancelPointerDrag(): void {
    this.dragging = false;
    this.pendingMouseDx = 0;
    this.pendingMouseDy = 0;
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const dx = this.pendingMouseDx;
    const dy = this.pendingMouseDy;
    this.pendingMouseDx = 0;
    this.pendingMouseDy = 0;
    return { dx, dy };
  }

  destroy(): void {
    this.abortController.abort();
  }

  private handleKeyDown(e: KeyboardEvent, opts: InputControllerOptions): void {
    if (e.code.startsWith("Digit")) {
      const hotbarIndex = Number(e.code.slice("Digit".length)) - 1;
      if (Number.isInteger(hotbarIndex) && hotbarIndex >= 0 && hotbarIndex < 9) {
        opts.onHotbarSelect?.(hotbarIndex);
        return;
      }
    }

    switch (e.code) {
      case "KeyE":
        opts.onInventoryToggle?.();
        break;
      case "KeyW":
        if (opts.canMove?.() === false) break;
        this.keys.w = true;
        break;
      case "KeyA":
        if (opts.canMove?.() === false) break;
        this.keys.a = true;
        break;
      case "KeyS":
        if (opts.canMove?.() === false) break;
        this.keys.s = true;
        break;
      case "KeyD":
        if (opts.canMove?.() === false) break;
        this.keys.d = true;
        break;
      case "KeyR":
        opts.onReset?.();
        break;
      case "Space":
        if (opts.canMove?.() === false) break;
        opts.onJump?.();
        break;
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case "KeyW":
        this.keys.w = false;
        break;
      case "KeyA":
        this.keys.a = false;
        break;
      case "KeyS":
        this.keys.s = false;
        break;
      case "KeyD":
        this.keys.d = false;
        break;
    }
  }
}
