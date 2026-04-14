import { createEventListener } from "@solid-primitives/event-listener";
import { createEffect, createSignal, on, Show } from "solid-js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { DeathScreen } from "../components/DeathScreen";
import { PauseMenu } from "../components/PauseMenu";
import { SettingsMenu } from "../components/SettingsMenu";
import { createGame } from "../engine";
import { createGameplayPreferences } from "../primitives/gameplay-preferences";
import { createGameplayUiState } from "../primitives/gameplay-ui-state";
import { joinWorld } from "../primitives/join-world";

const DEATH_Y_THRESHOLD = -20;

export default function GameView() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const room = joinWorld("world-1");
  const { preferences, setPendingPlayerName, setMouseSensitivity, setInvertY, setRenderDistance, setShowDiagnostics } =
    createGameplayPreferences();
  const ui = createGameplayUiState();
  const [spawnPoint, setSpawnPoint] = createSignal<{ x: number; y: number; z: number }>();

  const game = createGame({
    glCanvas,
    room,
    preferences: {
      mouseSensitivity: () => preferences.mouseSensitivity,
      invertY: () => preferences.invertY,
      renderDistance: () => preferences.renderDistance,
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
    ),
  );

  createEffect(() => {
    if (!ui.pauseMenuOpen() && !ui.settingsOpen() && !ui.deathScreenOpen()) return;
    document.exitPointerLock?.();
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
          onMouseSensitivityInput={setMouseSensitivity}
          onInvertYInput={setInvertY}
          onRenderDistanceInput={setRenderDistance}
          onShowDiagnosticsInput={setShowDiagnostics}
        />
      </Show>
      <Show when={ui.deathScreenOpen()}>
        <DeathScreen onRespawn={respawn} />
      </Show>
      <Show when={room.player()?.state}>
        {(playerState) => (
          <Show when={preferences.showDiagnostics}>
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
          </Show>
        )}
      </Show>
    </div>
  );
}
