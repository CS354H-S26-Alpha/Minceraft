import { Show } from "solid-js";
import { ITEM_DEFINITIONS_BY_ID } from "@/game/items";
import type { InventorySlot } from "@/game/player";

export function InventorySlotButton(props: {
  slot: InventorySlot | undefined;
  label: string;
  selected?: boolean;
  emphasized?: boolean;
  hotbarNumber?: number;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={props.label}
      class="block"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClick?.();
      }}
      tabIndex={-1}
      title={slotTitle(props.slot, props.label)}
      type="button"
    >
      <InventorySlotVisual
        emphasized={props.emphasized}
        hotbarNumber={props.hotbarNumber}
        selected={props.selected}
        slot={props.slot}
      />
    </button>
  );
}

export function InventorySlotVisual(props: {
  slot: InventorySlot | undefined;
  selected?: boolean;
  emphasized?: boolean;
  hotbarNumber?: number;
  class?: string;
}) {
  const item = () => (props.slot ? ITEM_DEFINITIONS_BY_ID[props.slot.itemId] : undefined);

  return (
    <div
      class={`relative flex h-12 w-12 items-center justify-center border-[3px] border-[#463728] bg-[#5c4e3b] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)] sm:h-14 sm:w-14 md:h-16 md:w-16 ${
        props.class ?? ""
      }`}
      classList={{
        "border-[#fff3bf] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,243,191,0.55)]": Boolean(
          props.selected,
        ),
        "border-[#f1df9f] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35),0_0_0_1px_rgba(241,223,159,0.55)]": Boolean(
          props.emphasized,
        ),
      }}
    >
      <div class="pointer-events-none absolute inset-0.75 border border-white/10" />

      <Show when={props.hotbarNumber !== undefined}>
        <span class="pointer-events-none absolute top-1 left-1 font-mono text-[10px] font-bold text-[rgba(245,239,226,0.72)]">
          {props.hotbarNumber}
        </span>
      </Show>

      <Show when={item()}>
        {(resolvedItem) => (
          <>
            <img
              alt=""
              class="pointer-events-none h-7 w-7 object-contain drop-shadow-[0_2px_1px_rgba(0,0,0,0.7)] sm:h-8 sm:w-8 md:h-10 md:w-10"
              src={resolvedItem().icon}
            />
            <Show when={props.slot && props.slot.quantity > 1}>
              <span class="pointer-events-none absolute right-1 bottom-1 font-mono text-[10px] font-bold text-[#f5efe2] [text-shadow:0_1px_0_rgba(0,0,0,0.85),1px_0_0_rgba(0,0,0,0.85),-1px_0_0_rgba(0,0,0,0.85),0_-1px_0_rgba(0,0,0,0.85)] sm:text-[11px]">
                {props.slot?.quantity}
              </span>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function slotTitle(slot: InventorySlot | undefined, label: string): string {
  if (!slot) return label;
  const item = ITEM_DEFINITIONS_BY_ID[slot.itemId];
  return `${item.name} x${slot.quantity}`;
}
