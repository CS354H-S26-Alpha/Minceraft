import { createEventListener } from "@solid-primitives/event-listener";
import { createEffect, createSignal, on, Show } from "solid-js";
import { HOTBAR_SLOT_COUNT } from "@/game/player";
import { DeathScreen } from "../components/DeathScreen";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { InventoryPanel } from "../components/InventoryPanel";
import { Minimap } from "../components/Minimap";
import { PauseMenu } from "../components/PauseMenu";
import { PlayerHud } from "../components/PlayerHud";
import { SettingsMenu } from "../components/SettingsMenu";
import { createGame, requestPointerLock } from "../engine";
import { createGameplayPreferences } from "../primitives/gameplay-preferences";
import { createGameplayUiState } from "../primitives/gameplay-ui-state";
import { joinWorld } from "../primitives/join-world";
import { setWorldReady } from "../state/loading";

const DEATH_Y_THRESHOLD = -20;

export default function GameView() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [inventoryOpen, setInventoryOpen] = createSignal(false);
  const [hudHidden, setHudHidden] = createSignal(false);
  const [debugVisible, setDebugVisible] = createSignal(false);

  const room = joinWorld("world-1");
  const {
    preferences,
    setPendingPlayerName,
    commitPlayerName,
    setMouseSensitivity,
    setInvertY,
    setRenderDistance,
    setShowDiagnostics,
  } = createGameplayPreferences();
  const ui = createGameplayUiState();
  const [spawnPoint, setSpawnPoint] = createSignal<{ x: number; y: number; z: number }>();

  const anyOverlayOpen = () => ui.pauseMenuOpen() || ui.settingsOpen() || ui.deathScreenOpen();

  const game = createGame({
    glCanvas,
    room,
    preferences: {
      mouseSensitivity: () => preferences.mouseSensitivity,
      invertY: () => preferences.invertY,
      renderDistance: () => preferences.renderDistance,
    },
    inputEnabled: () => !inventoryOpen() && !anyOverlayOpen(),
    shortcuts: {
      onToggleInventory: toggleInventory,
      onCloseInventory: closeInventory,
      onToggleHud: () => setHudHidden((hidden) => !hidden),
      onToggleDebug: () => setDebugVisible((visible) => !visible),
      onSelectHotbarSlot: selectHotbarSlot,
      onCycleHotbar: (direction) => {
        const player = room.player();
        if (!player) return;
        selectHotbarSlot(mod(player.state.selectedHotbarSlot + direction, HOTBAR_SLOT_COUNT));
      },
    },
  });

  createEffect(() => {
    const playerState = room.player()?.state;
    if (!playerState || spawnPoint()) return;
    setSpawnPoint({ x: playerState.x, y: playerState.y, z: playerState.z });
  });

  createEffect(
    on(
      () => room.player()?.state.y,
      (y) => {
        if (y === undefined || y > DEATH_Y_THRESHOLD || ui.deathScreenOpen()) return;
        document.exitPointerLock?.();
        ui.showDeathScreen();
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    if (!anyOverlayOpen()) return;
    document.exitPointerLock?.();
  });

  createEffect(() => {
    if (game.minimap.terrainVersion() > 0) setWorldReady(true);
  });

  createEventListener(window, "keydown", (event) => {
    if (event.key !== "Escape" || ui.deathScreenOpen()) return;
    event.preventDefault();
    if (ui.settingsOpen()) {
      ui.closeSettings();
      return;
    }
    ui.togglePauseMenu();
  });

  const respawn = () => {
    const spawn = spawnPoint();
    const session = room.session();
    if (!spawn || !session) return;
    room.replicated()?.teleport(spawn);
    session.teleportTo(spawn.x, spawn.y, spawn.z);
    ui.hideDeathScreen();
  };

  function selectHotbarSlot(slotIndex: number) {
    room.player()?.setSelectedHotbarSlot(slotIndex);
    room.session()?.selectHotbarSlot(slotIndex);
  }

  function openInventory() {
    if (inventoryOpen() || anyOverlayOpen()) return;
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
      <Show when={ui.pauseMenuOpen() && !ui.settingsOpen() && room.player()?.state}>
        {(playerState) => (
          <PauseMenu
            currentPlayerName={playerState().name}
            pendingPlayerName={preferences.pendingPlayerName}
            renderDistance={preferences.renderDistance}
            mouseSensitivity={preferences.mouseSensitivity}
            onResume={() => ui.closePauseMenu()}
            onOpenSettings={() => ui.openSettings()}
            onRespawn={respawn}
          />
        )}
      </Show>
      <Show when={ui.settingsOpen()}>
        <SettingsMenu
          preferences={preferences}
          onBack={() => ui.closeSettings()}
          onNameInput={setPendingPlayerName}
          onNameBlur={commitPlayerName}
          onMouseSensitivityInput={setMouseSensitivity}
          onInvertYInput={setInvertY}
          onRenderDistanceInput={setRenderDistance}
          onShowDiagnosticsInput={setShowDiagnostics}
        />
      </Show>
      <Show when={ui.deathScreenOpen()}>
        <DeathScreen onRespawn={respawn} />
      </Show>
      <Show when={!hudHidden()}>
        <Minimap
          hidden={inventoryOpen() || anyOverlayOpen()}
          minimap={game.minimap}
          player={room.player}
          players={() => room.remotePlayers}
        />
        <Show when={!inventoryOpen() && !anyOverlayOpen()}>
          <div class="pointer-events-none absolute inset-0 z-20">
            <div class="absolute top-1/2 left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2">
              <div class="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/85 shadow-[0_0_4px_rgba(0,0,0,0.7)]" />
              <div class="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-white/85 shadow-[0_0_4px_rgba(0,0,0,0.7)]" />
            </div>
          </div>
        </Show>
        <PlayerHud
          hidden={inventoryOpen() || anyOverlayOpen()}
          onSelectHotbarSlot={selectHotbarSlot}
          player={room.player}
        />
      </Show>
      <InventoryPanel
        player={room.player}
        inventoryUi={room.inventoryUi}
        open={inventoryOpen()}
        onClickSlot={(target) => room.session()?.clickInventory(target)}
      />
      <Show when={(debugVisible() || preferences.showDiagnostics) && room.player()?.state}>
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
