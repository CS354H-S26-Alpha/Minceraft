import createRAF, { targetFPS } from "@solid-primitives/raf";
import { batch } from "solid-js";
import { createPageVisibility } from "../primitives";

const BLURRED_FPS = 5;

export interface RenderLoopOptions {
  /** Target FPS when the tab is blurred. Default 5. */
  blurredFps?: number;
}

/**
 * Scheduling primitive for a client render loop.
 */
export function createRenderLoop(callback: (dt: number, now: number) => void, options: RenderLoopOptions = {}): void {
  const blurredFps = options.blurredFps ?? BLURRED_FPS;
  const isVisible = createPageVisibility();

  let lastTime = performance.now();

  const tick: FrameRequestCallback = (now) => {
    const dt = now - lastTime;
    lastTime = now;
    batch(() => callback(dt, now));
  };

  const [, start] = createRAF(targetFPS(tick, () => (isVisible() ? Infinity : blurredFps)));
  start();
}
