import { createSignal, Show } from "solid-js";
import { HOTBAR_SLOT_COUNT } from "@/game/player";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { InventoryPanel } from "../components/InventoryPanel";
import { Minimap } from "../components/Minimap";
import { PlayerHud } from "../components/PlayerHud";
import { createGame, requestPointerLock } from "../engine";
import { joinWorld } from "../primitives/join-world";

export default function GameView() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [inventoryOpen, setInventoryOpen] = createSignal(false);

  const room = joinWorld("world-1");

  const game = createGame({
    glCanvas,
    room,
    inputEnabled: () => !inventoryOpen(),
    shortcuts: {
      onToggleInventory: toggleInventory,
      onCloseInventory: closeInventory,
      onSelectHotbarSlot: selectHotbarSlot,
      onCycleHotbar: (direction) => {
        const player = room.player();
        if (!player) return;
        selectHotbarSlot(mod(player.state.selectedHotbarSlot + direction, HOTBAR_SLOT_COUNT));
      },
    },
  });

  function selectHotbarSlot(slotIndex: number) {
    room.player()?.setSelectedHotbarSlot(slotIndex);
    room.session()?.selectHotbarSlot(slotIndex);
  }

  function openInventory() {
    if (inventoryOpen()) return;
    setInventoryOpen(true);
    void document.exitPointerLock?.();
  }

  function closeInventory() {
    if (!inventoryOpen()) return;
    setInventoryOpen(false);
    room.session()?.closeInventory();
    void requestPointerLock(glCanvas());
  }

  function toggleInventory() {
    if (inventoryOpen()) {
      closeInventory();
    } else {
      openInventory();
    }
  }

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <canvas ref={setGlCanvas} class="absolute inset-0 h-full w-full" />
      <Minimap
        hidden={inventoryOpen()}
        minimap={game.minimap}
        player={room.player}
        players={() => room.remotePlayers}
      />
      <PlayerHud hidden={inventoryOpen()} onSelectHotbarSlot={selectHotbarSlot} player={room.player} />
      <InventoryPanel
        player={room.player}
        inventoryUi={room.inventoryUi}
        open={inventoryOpen()}
        onClickSlot={(target) => room.session()?.clickInventory(target)}
      />
      <Show when={room.player()?.state}>
        {(playerState) => (
          <DiagnosticsPanel
            playerState={playerState()}
            fps={game.diagnostics.client.fps}
            computeTimeMs={game.diagnostics.client.computeTimeMs}
            computeTimeHistory={game.diagnostics.client.computeTimeHistory}
            gpuTimeMs={game.diagnostics.client.gpuTimeMs}
            gpuTimeHistory={game.diagnostics.client.gpuTimeHistory}
            mspt={game.diagnostics.server.mspt}
            msptHistory={game.diagnostics.server.msptHistory}
            snapsPerSec={game.diagnostics.server.snapsPerSec}
            packetsPerSec={game.diagnostics.server.packetsPerSec}
            timeOfDayS={game.diagnostics.server.timeOfDayS}
            onSetTimeOfDay={(timeS) => room.session()?.setTimeOfDay(timeS)}
            onlinePlayers={Object.values(room.remotePlayers)}
            onTeleportTo={(id) => {
              const target = room.remotePlayers[id];
              const s = room.session();
              if (!target || !s) return;
              room.replicated()?.teleport({ x: target.x, y: target.y, z: target.z });
              s.teleportTo(target.x, target.y, target.z);
            }}
            pointerLocked={game.diagnostics.client.pointerLocked}
          />
        )}
      </Show>
    </div>
  );
}

function mod(value: number, base: number) {
  return ((value % base) + base) % base;
}
