import { createMousePosition, getPositionToScreen } from "@solid-primitives/mouse";
import { createMemo, For, Show } from "solid-js";
import { CRAFTING_GRID_SLOT_COUNT, type InventoryClickTarget, type InventoryUiState } from "@/game/crafting";
import {
  HOTBAR_SLOT_COUNT,
  HOTBAR_START_INDEX,
  type InventorySlot,
  MAIN_INVENTORY_SLOT_COUNT,
  type Player,
} from "@/game/player";
import { InventorySlotButton, InventorySlotVisual } from "./InventorySlot";

interface InventoryPanelProps {
  player: () => Player | undefined;
  inventoryUi: InventoryUiState;
  open: boolean;
  onClickSlot: (target: InventoryClickTarget) => void;
}

const MAIN_SLOT_INDICES = Array.from({ length: MAIN_INVENTORY_SLOT_COUNT }, (_, index) => index);
const HOTBAR_SLOT_INDICES = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, index) => index);
const CRAFTING_SLOT_INDICES = Array.from({ length: CRAFTING_GRID_SLOT_COUNT }, (_, index) => index);

export function InventoryPanel(props: InventoryPanelProps) {
  const mouse = createMousePosition(window, {
    touch: false,
    initialValue: defaultPointerPosition(),
  });
  const pointer = createMemo(() => getPositionToScreen(mouse.x, mouse.y));

  const inventory = createMemo(() => props.player()?.state.inventory ?? []);
  const selectedHotbarSlot = createMemo(() => props.player()?.state.selectedHotbarSlot ?? 0);

  return (
    <>
      <Show when={props.open && props.player()}>
        <div class="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(0,0,0,0.18)] px-4 py-6 backdrop-blur-[1px]">
          <div class="w-full max-w-[min(96vw,46rem)] border-4 border-[#20180f] bg-[#c5baa4] px-4 pt-4 pb-5 text-[#241b12] shadow-[0_28px_80px_rgba(0,0,0,0.45)] sm:px-6 sm:pt-5 sm:pb-6">
            <div class="mb-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#5a4a36]">
              Press E to close
            </div>

            <div class="mb-5 flex items-start justify-between gap-5">
              <div class="min-w-0">
                <div class="font-mono text-[28px] font-bold uppercase tracking-[0.08em] text-[#241b12] sm:text-[30px]">
                  Inventory
                </div>
                <div class="mt-1 font-mono text-xs font-bold uppercase tracking-[0.14em] text-[#5a4a36]">
                  {props.player()?.state.name}
                </div>
              </div>

              <div class="shrink-0">
                <div class="mb-2 text-right font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#5a4a36]">
                  Crafting
                </div>
                <div class="flex items-center gap-2 border-2 border-[#463728] bg-[#b2a286] p-2">
                  <div class="grid grid-cols-2 gap-2">
                    <For each={CRAFTING_SLOT_INDICES}>
                      {(slotIndex) => (
                        <InventorySlotButton
                          label={`Crafting slot ${slotIndex + 1}`}
                          onClick={() => props.onClickSlot({ container: "crafting", index: slotIndex })}
                          slot={props.inventoryUi.craftingGrid[slotIndex]}
                        />
                      )}
                    </For>
                  </div>

                  <div class="px-1 font-mono text-lg font-bold uppercase text-[#6f624c]">{"->"}</div>

                  <InventorySlotButton
                    emphasized={Boolean(props.inventoryUi.result)}
                    label="Crafting result"
                    onClick={() => props.onClickSlot({ container: "result" })}
                    slot={props.inventoryUi.result}
                  />
                </div>
              </div>
            </div>

            <div class="border-2 border-[#463728] bg-[#ad9d82] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
              <div class="grid grid-cols-9 gap-2">
                <For each={MAIN_SLOT_INDICES}>
                  {(slotIndex) => (
                    <InventorySlotButton
                      label={`Inventory slot ${slotIndex + 1}`}
                      onClick={() => props.onClickSlot({ container: "inventory", index: slotIndex })}
                      slot={inventory()[slotIndex]}
                    />
                  )}
                </For>
              </div>

              <div class="my-4 h-0.75 bg-[rgba(36,27,18,0.35)]" />

              <div class="grid grid-cols-9 gap-2">
                <For each={HOTBAR_SLOT_INDICES}>
                  {(slotIndex) => (
                    <InventorySlotButton
                      hotbarNumber={slotIndex + 1}
                      label={`Hotbar inventory slot ${slotIndex + 1}`}
                      onClick={() =>
                        props.onClickSlot({ container: "inventory", index: HOTBAR_START_INDEX + slotIndex })
                      }
                      selected={selectedHotbarSlot() === slotIndex}
                      slot={inventory()[HOTBAR_START_INDEX + slotIndex]}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={props.open && props.inventoryUi.cursor}>
        {(slot) => <FloatingInventoryItem pointer={pointer()} slot={slot()} />}
      </Show>
    </>
  );
}

function FloatingInventoryItem(props: {
  slot: InventorySlot;
  pointer: {
    x: number;
    y: number;
  };
}) {
  return (
    <div
      class="pointer-events-none fixed z-50 opacity-95"
      style={{
        left: `${props.pointer.x - 28}px`,
        top: `${props.pointer.y - 28}px`,
      }}
    >
      <InventorySlotVisual class="scale-105 shadow-[0_10px_22px_rgba(0,0,0,0.32)]" slot={props.slot} />
    </div>
  );
}

function defaultPointerPosition() {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 };
  }

  return {
    x: window.scrollX + Math.round(window.innerWidth / 2),
    y: window.scrollY + Math.round(window.innerHeight / 2),
  };
}
