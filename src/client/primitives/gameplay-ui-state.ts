import { createSignal } from "solid-js";

export function createGameplayUiState() {
  const [pauseMenuOpen, setPauseMenuOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [deathScreenOpen, setDeathScreenOpen] = createSignal(false);

  return {
    pauseMenuOpen,
    settingsOpen,
    deathScreenOpen,
    openPauseMenu() {
      if (deathScreenOpen()) return;
      setPauseMenuOpen(true);
      setSettingsOpen(false);
    },
    closePauseMenu() {
      setPauseMenuOpen(false);
      setSettingsOpen(false);
    },
    togglePauseMenu() {
      if (deathScreenOpen()) return;
      const next = !pauseMenuOpen();
      setPauseMenuOpen(next);
      if (!next) setSettingsOpen(false);
    },
    openSettings() {
      if (deathScreenOpen()) return;
      setPauseMenuOpen(true);
      setSettingsOpen(true);
    },
    closeSettings() {
      setSettingsOpen(false);
    },
    showDeathScreen() {
      setPauseMenuOpen(false);
      setSettingsOpen(false);
      setDeathScreenOpen(true);
    },
    hideDeathScreen() {
      setDeathScreenOpen(false);
    },
  } as const;
}
