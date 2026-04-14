import { createEventListener } from "@solid-primitives/event-listener";
import { createShortcut } from "@solid-primitives/keyboard";
import { type Accessor, createEffect, createSignal } from "solid-js";
import { HOTBAR_SLOT_COUNT } from "@/game/player";
import { createHeldCodes } from "../primitives";

export interface WalkKeys {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  space: boolean;
  shift: boolean;
}

export interface InputOptions {
  onReset?: () => void;
  onToggleInventory?: () => void;
  onCloseInventory?: () => void;
  onSelectHotbarSlot?: (slotIndex: number) => void;
  onCycleHotbar?: (direction: 1 | -1) => void;
  /** Press P to skip forward one phase in the day/night cycle. */
  onCycleDayPhase?: () => void;
}

export interface InputHandle {
  walkKeys(): Readonly<WalkKeys>;
  consumeMouseDelta(): { dx: number; dy: number };
  pointerLocked: Accessor<boolean>;
}

/**
 * SolidJS input primitive. Accepts a canvas signal — pointer lock and keyboard
 * state activate when the canvas resolves.
 *
 * Prefers `pointerrawupdate` events (lower latency) when available, falling
 * back to `mousemove`. Keyboard listeners are reactively attached/detached
 * with pointer lock to prevent ghost key state after losing focus.
 *
 * Must be called inside a Solid reactive scope; cleans up via `onCleanup`.
 */
export function createInput(canvas: Accessor<HTMLCanvasElement | undefined>, opts: InputOptions = {}): InputHandle {
  if (opts.onReset) createShortcut(["R"], opts.onReset);
  if (opts.onCycleDayPhase) createShortcut(["P"], opts.onCycleDayPhase);
  if (opts.onToggleInventory) createShortcut(["E"], opts.onToggleInventory);
  if (opts.onCloseInventory) createShortcut(["Escape"], opts.onCloseInventory);
  if (opts.onSelectHotbarSlot) {
    const onSelect = opts.onSelectHotbarSlot;
    for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
      createShortcut([String(i + 1)], () => onSelect(i));
    }
  }

  let pendingMouseDx = 0;
  let pendingMouseDy = 0;
  let pendingRawDx = 0;
  let pendingRawDy = 0;
  let hasRawMouseDelta = false;

  const [pointerLocked, setPointerLocked] = createSignal(false);
  const { isHeld } = createHeldCodes(pointerLocked);

  const w = isHeld("KeyW");
  const a = isHeld("KeyA");
  const s = isHeld("KeyS");
  const d = isHeld("KeyD");
  const space = isHeld("Space");
  const shift = isHeld("ShiftLeft", "ShiftRight");

  const clearMouseDelta = () => {
    pendingMouseDx = 0;
    pendingMouseDy = 0;
    pendingRawDx = 0;
    pendingRawDy = 0;
    hasRawMouseDelta = false;
  };

  // Click → request pointer lock (attaches when canvas resolves).
  createEffect(() => {
    const el = canvas();
    if (!el) return;
    createEventListener(el, "click", () => {
      if (document.pointerLockElement === el) return;
      void requestPointerLock(el);
    });
  });

  // Pointer lock state → signal.
  createEventListener(document, "pointerlockchange", () => {
    clearMouseDelta();
    setPointerLocked(document.pointerLockElement === canvas());
  });

  // Mouse movement — accumulates deltas while pointer is locked.
  createEventListener(document, "mousemove", (e) => {
    if (document.pointerLockElement !== canvas()) return;
    pendingMouseDx += e.movementX;
    pendingMouseDy += e.movementY;
  });
  if ("onpointerrawupdate" in document) {
    createEventListener(document, "pointerrawupdate", (event) => {
      if (document.pointerLockElement !== canvas()) return;
      const e = event as PointerEvent;
      pendingRawDx += e.movementX;
      pendingRawDy += e.movementY;
      hasRawMouseDelta = true;
    });
  }
  createEventListener(document, "contextmenu", (e) => {
    if (document.pointerLockElement === canvas()) e.preventDefault();
  });
  if (opts.onCycleHotbar) {
    const onCycle = opts.onCycleHotbar;
    createEventListener(window, "wheel", (event: WheelEvent) => {
      const direction = Math.sign(event.deltaY);
      if (direction === 0) return;
      event.preventDefault();
      onCycle(direction as 1 | -1);
    });
  }

  return {
    walkKeys() {
      return { w: w(), a: a(), s: s(), d: d(), space: space(), shift: shift() };
    },
    consumeMouseDelta() {
      const dx = hasRawMouseDelta ? pendingRawDx : pendingMouseDx;
      const dy = hasRawMouseDelta ? pendingRawDy : pendingMouseDy;
      clearMouseDelta();
      return { dx, dy };
    },
    pointerLocked,
  };
}

/**
 * Requests pointer lock with `unadjustedMovement: true` for raw mouse input.
 * Falls back to standard pointer lock if the option is unsupported.
 */
export async function requestPointerLock(canvas: HTMLCanvasElement | undefined): Promise<void> {
  if (!canvas) return;

  const maybePointerLock = canvas.requestPointerLock as (options?: {
    unadjustedMovement?: boolean;
  }) => Promise<void> | void;

  try {
    await maybePointerLock({ unadjustedMovement: true });
  } catch {
    canvas.requestPointerLock();
  }
}
