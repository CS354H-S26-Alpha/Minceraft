import { createSignal, onCleanup, Show } from "solid-js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { InventoryPanel } from "../components/InventoryPanel";
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
    gameplayShortcuts: {
      inventoryOpen,
      player: room.player,
      onToggleInventory: toggleInventory,
      onCloseInventory: closeInventory,
      onSelectHotbarSlot: room.selectHotbarSlot,
    },
  });

  function openInventory() {
    if (inventoryOpen()) return;
    setInventoryOpen(true);
    void document.exitPointerLock?.();
  }

  function closeInventory() {
    if (!inventoryOpen()) return;
    setInventoryOpen(false);
    room.closeInventory();
    void requestPointerLock(glCanvas());
  }

  function toggleInventory() {
    if (inventoryOpen()) {
      closeInventory();
    } else {
      openInventory();
    }
  }

  onCleanup(() => {
    if (inventoryOpen()) {
      room.closeInventory();
    }
  });

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <canvas ref={setGlCanvas} class="absolute inset-0 h-full w-full" />
      <PlayerHud hidden={inventoryOpen()} onSelectHotbarSlot={room.selectHotbarSlot} player={room.player} />
      <InventoryPanel
        player={room.player}
        inventoryUi={room.inventoryUi}
        open={inventoryOpen()}
        onClickSlot={room.clickInventory}
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
