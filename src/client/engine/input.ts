import { createEventListener } from "@solid-primitives/event-listener";
import { createShortcut } from "@solid-primitives/keyboard";
import { onCleanup } from "solid-js";

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
}

export interface MouseDiagnostics {
  pointerLocked: boolean;
}

export interface InputHandle {
  walkKeys(): Readonly<WalkKeys>;
  consumeMouseDelta(): { dx: number; dy: number };
  diagnostics(): Readonly<MouseDiagnostics>;
}

/**
 * SolidJS input primitive. Handles pointer lock, keyboard state, and mouse
 * deltas for the game canvas.
 *
 * Prefers `pointerrawupdate` events (lower latency) when available, falling
 * back to `mousemove`. Keyboard listeners are attached/detached with pointer
 * lock to prevent ghost key state after losing focus.
 *
 * Must be called inside a Solid reactive scope; cleans up listeners via `onCleanup`.
 */
export function createInput(canvas: HTMLCanvasElement, opts: InputOptions = {}): InputHandle {
  if (opts.onReset) createShortcut(["R"], opts.onReset);

  const held: WalkKeys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    shift: false,
  };

  let pendingMouseDx = 0;
  let pendingMouseDy = 0;
  let pendingRawDx = 0;
  let pendingRawDy = 0;
  let hasRawMouseDelta = false;
  let removeKeyboardListeners: (() => void) | null = null;

  const diagnostics: MouseDiagnostics = {
    pointerLocked: false,
  };

  const clearHeldKeys = () => {
    held.w = false;
    held.a = false;
    held.s = false;
    held.d = false;
    held.space = false;
    held.shift = false;
  };

  const updateHeldKey = (event: KeyboardEvent, pressed: boolean) => {
    switch (event.code) {
      case "KeyW":
        held.w = pressed;
        return;
      case "KeyA":
        held.a = pressed;
        return;
      case "KeyS":
        held.s = pressed;
        return;
      case "KeyD":
        held.d = pressed;
        return;
      case "Space":
        held.space = pressed;
        return;
      case "ShiftLeft":
      case "ShiftRight":
        held.shift = pressed;
        return;
    }
  };

  const detachKeyboardListeners = () => {
    removeKeyboardListeners?.();
    removeKeyboardListeners = null;
    clearHeldKeys();
  };

  const attachKeyboardListeners = () => {
    if (removeKeyboardListeners) return;

    const onKeyDown = (event: KeyboardEvent) => {
      updateHeldKey(event, true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      updateHeldKey(event, false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    removeKeyboardListeners = () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  };

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    pendingMouseDx += e.movementX;
    pendingMouseDy += e.movementY;
  };
  const onPointerRawUpdate = (event: Event) => {
    if (document.pointerLockElement !== canvas) return;
    const e = event as PointerEvent;
    pendingRawDx += e.movementX;
    pendingRawDy += e.movementY;
    hasRawMouseDelta = true;
  };
  const onPointerLockChange = () => {
    pendingMouseDx = 0;
    pendingMouseDy = 0;
    pendingRawDx = 0;
    pendingRawDy = 0;
    hasRawMouseDelta = false;
    diagnostics.pointerLocked = document.pointerLockElement === canvas;
    if (diagnostics.pointerLocked) {
      attachKeyboardListeners();
    } else {
      detachKeyboardListeners();
    }
  };
  const onContextMenu = (e: MouseEvent) => {
    if (document.pointerLockElement === canvas) e.preventDefault();
  };
  const onClick = () => {
    if (document.pointerLockElement === canvas) return;
    void requestPointerLock(canvas);
  };

  createEventListener(canvas, "click", onClick);
  createEventListener(document, "pointerlockchange", onPointerLockChange);
  createEventListener(document, "contextmenu", onContextMenu);
  createEventListener(document, "mousemove", onMouseMove);
  if ("onpointerrawupdate" in document) {
    createEventListener(document, "pointerrawupdate", onPointerRawUpdate);
  }
  onCleanup(() => {
    detachKeyboardListeners();
  });

  return {
    walkKeys() {
      return {
        w: held.w,
        a: held.a,
        s: held.s,
        d: held.d,
        space: held.space,
        shift: held.shift,
      };
    },
    consumeMouseDelta() {
      const dx = hasRawMouseDelta ? pendingRawDx : pendingMouseDx;
      const dy = hasRawMouseDelta ? pendingRawDy : pendingMouseDy;
      pendingMouseDx = 0;
      pendingMouseDy = 0;
      pendingRawDx = 0;
      pendingRawDy = 0;
      hasRawMouseDelta = false;
      return { dx, dy };
    },
    diagnostics() {
      return diagnostics;
    },
  };
}

/**
 * Requests pointer lock with `unadjustedMovement: true` for raw mouse input.
 * Falls back to standard pointer lock if the option is unsupported.
 */
async function requestPointerLock(canvas: HTMLCanvasElement): Promise<void> {
  const maybePointerLock = canvas.requestPointerLock as (options?: {
    unadjustedMovement?: boolean;
  }) => Promise<void> | void;

  try {
    await maybePointerLock({ unadjustedMovement: true });
  } catch {
    canvas.requestPointerLock();
  }
}
