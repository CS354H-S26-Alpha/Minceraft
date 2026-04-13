import { createEventListener } from "@solid-primitives/event-listener";
import { createSignal, onCleanup, Show } from "solid-js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { InventoryPanel } from "../components/InventoryPanel";
import { createGame } from "../engine";
import { joinWorld } from "../primitives/join-world";

export default function GameView() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [inventoryOpen, setInventoryOpen] = createSignal(false);

  const room = joinWorld("world-1");

  const game = createGame({
    glCanvas,
    room,
    inputEnabled: () => !inventoryOpen(),
  });

  function openInventory() {
    if (inventoryOpen()) return;
    setInventoryOpen(true);
    room.requestState();
    void document.exitPointerLock?.();
  }

  function closeInventory() {
    if (!inventoryOpen()) return;
    setInventoryOpen(false);
    room.closeInventory();
  }

  function toggleInventory() {
    if (inventoryOpen()) {
      closeInventory();
    } else {
      openInventory();
    }
  }

  createEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();

    if (key === "e") {
      event.preventDefault();
      toggleInventory();
      return;
    }

    if (key === "escape" && inventoryOpen()) {
      event.preventDefault();
      closeInventory();
      return;
    }

    const hotbarSlot = Number.parseInt(event.key, 10);
    if (Number.isNaN(hotbarSlot) || hotbarSlot < 1 || hotbarSlot > 9) return;
    room.selectHotbarSlot(hotbarSlot - 1);
  });

  onCleanup(() => {
    if (inventoryOpen()) {
      room.closeInventory();
    }
  });

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <canvas ref={setGlCanvas} class="absolute inset-0 h-full w-full" />
      <InventoryPanel
        player={room.player}
        playerVersion={room.selfStateVersion}
        inventoryUi={room.inventoryUi}
        open={inventoryOpen()}
        onClose={closeInventory}
        onClickSlot={room.clickInventory}
        onSelectHotbarSlot={room.selectHotbarSlot}
      />
      <Show when={room.player()?.state}>
        {(playerState) => (
          <DiagnosticsPanel
            playerState={playerState()}
            fps={game.diagnostics.client.fps}
            computeTimeMs={game.diagnostics.client.computeTimeMs}
            computeTimeHistory={game.diagnostics.client.computeTimeHistory}
            tps={game.diagnostics.server.tps}
            mspt={game.diagnostics.server.mspt}
            msptHistory={game.diagnostics.server.msptHistory}
            snapsPerSec={game.diagnostics.server.snapsPerSec}
            onlinePlayers={Object.values(room.snapshot.players)}
            onTeleportTo={(id) => {
              const target = room.snapshot.players[id];
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
