// Spinner styling adapted from hc-tcg (https://github.com/hc-tcg/hc-tcg).
import { Index } from "solid-js";

const CELLS = Array.from({ length: 16 });

export function Spinner() {
  return (
    <div class="spinner" role="status" aria-label="Loading">
      <Index each={CELLS}>{() => <div class="spinner-cell" />}</Index>
    </div>
  );
}
