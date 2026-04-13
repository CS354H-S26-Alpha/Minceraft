import { createEventListener } from "@solid-primitives/event-listener";
import { type Accessor, createSignal } from "solid-js";

/**
 * Reactive signal that tracks whether the current page/tab is visible.
 * Updates on `visibilitychange`, window `focus`, and window `blur`.
 */
export function createPageVisibility(): Accessor<boolean> {
  const [visible, setVisible] = createSignal(document.visibilityState === "visible" && document.hasFocus());
  const update = () => setVisible(document.visibilityState === "visible" && document.hasFocus());

  createEventListener(window, "focus", update);
  createEventListener(window, "blur", update);
  createEventListener(document, "visibilitychange", update);

  return visible;
}
