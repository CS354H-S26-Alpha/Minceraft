import { createMemo, For, Show } from "solid-js";
import { ITEM_DEFINITIONS_BY_ID } from "@/game/items";
import { HOTBAR_SLOT_COUNT, HOTBAR_START_INDEX, PLAYER_MAX_HEALTH, type Player } from "@/game/player";
import { InventorySlotButton } from "./InventorySlot";

interface PlayerHudProps {
  player: () => Player | undefined;
  onSelectHotbarSlot: (slotIndex: number) => void;
  hidden?: boolean;
}

const HOTBAR_SLOT_INDICES = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, index) => index);
const HEART_SLOT_INDICES = Array.from({ length: PLAYER_MAX_HEALTH / 2 }, (_, index) => index);

import emptyHeartIcon from "@/assets/icons/empty_heart.png";
import fullHeartIcon from "@/assets/icons/full_heart.png";
import halfHeartIcon from "@/assets/icons/half_heart.png";

export function PlayerHud(props: PlayerHudProps) {
  const inventory = createMemo(() => props.player()?.state.inventory ?? []);
  const selectedHotbarSlot = createMemo(() => props.player()?.state.selectedHotbarSlot ?? 0);
  const health = createMemo(() => props.player()?.state.health ?? PLAYER_MAX_HEALTH);

  const selectedHotbarItemName = createMemo(() => {
    const slot = inventory()[HOTBAR_START_INDEX + selectedHotbarSlot()];
    return slot ? ITEM_DEFINITIONS_BY_ID[slot.itemId].name : "Empty Hand";
  });

  return (
    <Show when={!props.hidden && props.player()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
        <div class="pointer-events-auto flex flex-col items-center gap-3">
          <div class="flex flex-wrap items-center justify-center gap-1 rounded-sm border-2 border-[#20180f] bg-[rgba(58,40,22,0.82)] px-2 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
            <For each={HEART_SLOT_INDICES}>
              {(heartIndex) => (
                <img
                  alt=""
                  class="h-5 w-5 [image-rendering:pixelated] sm:h-6 sm:w-6"
                  src={heartIcon(health(), heartIndex)}
                />
              )}
            </For>
          </div>

          <div class="border-2 border-white/15 bg-[rgba(30,22,14,0.84)] px-3 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.4)]">
            <div class="mb-2 text-center font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#f1df9f]">
              {selectedHotbarItemName()}
            </div>
            <div class="grid grid-cols-9 gap-2">
              <For each={HOTBAR_SLOT_INDICES}>
                {(slotIndex) => (
                  <InventorySlotButton
                    hotbarNumber={slotIndex + 1}
                    label={`Hotbar slot ${slotIndex + 1}`}
                    onClick={() => props.onSelectHotbarSlot(slotIndex)}
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
  );
}

function heartIcon(health: number, heartIndex: number): string {
  const remaining = health - heartIndex * 2;
  if (remaining >= 2) return fullHeartIcon;
  if (remaining === 1) return halfHeartIcon;
  return emptyHeartIcon;
}
