import { createEventListener } from "@solid-primitives/event-listener";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

/**
 * Tracks held physical keys (by `KeyboardEvent.code`), gated by an `active`
 * signal. All held state clears on window blur, page visibility change, and
 * when `active` becomes false.
 */
export function createHeldCodes(active: Accessor<boolean>) {
  const held = new Set<string>();
  const [rev, setRev] = createSignal(0);

  const clear = () => {
    if (held.size === 0) return;
    held.clear();
    setRev((r) => r + 1);
  };

  createEffect(() => {
    if (!active()) {
      clear();
      return;
    }

    createEventListener(document, "keydown", (e: KeyboardEvent) => {
      if (e.repeat || held.has(e.code)) return;
      held.add(e.code);
      setRev((r) => r + 1);
    });
    createEventListener(document, "keyup", (e: KeyboardEvent) => {
      if (!held.has(e.code)) return;
      held.delete(e.code);
      setRev((r) => r + 1);
    });
    createEventListener(window, "blur", clear);
    createEventListener(document, "visibilitychange", () => {
      if (document.hidden) clear();
    });

    onCleanup(clear);
  });

  /** Reactive accessor — true when any of the given codes are currently held. */
  function isHeld(...codes: string[]): Accessor<boolean> {
    return createMemo(() => {
      rev();
      return codes.some((c) => held.has(c));
    });
  }

  return { isHeld };
}
