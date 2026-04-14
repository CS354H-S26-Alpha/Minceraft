import { createEffect } from "solid-js";
import { createStore } from "solid-js/store";

const STORAGE_KEY = "gameplay-preferences";
const PLAYER_NAME_STORAGE_KEY = "player-name";
const MIN_RENDER_DISTANCE = 1;
const MAX_RENDER_DISTANCE = 4;
const MIN_MOUSE_SENSITIVITY = 0.25;
const MAX_MOUSE_SENSITIVITY = 2;

export interface GameplayPreferences {
  pendingPlayerName: string;
  mouseSensitivity: number;
  invertY: boolean;
  renderDistance: number;
  showDiagnostics: boolean;
}

const DEFAULT_PREFERENCES: GameplayPreferences = {
  pendingPlayerName: "Player",
  mouseSensitivity: 1,
  invertY: false,
  renderDistance: 4,
  showDiagnostics: true,
};

export function createGameplayPreferences() {
  const [preferences, setPreferences] = createStore<GameplayPreferences>(readGameplayPreferences());

  createEffect(() => {
    if (typeof window === "undefined") return;

    const serialized = JSON.stringify({
      pendingPlayerName: preferences.pendingPlayerName,
      mouseSensitivity: preferences.mouseSensitivity,
      invertY: preferences.invertY,
      renderDistance: preferences.renderDistance,
      showDiagnostics: preferences.showDiagnostics,
    } satisfies GameplayPreferences);

    window.localStorage.setItem(STORAGE_KEY, serialized);
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, preferences.pendingPlayerName);
  });

  return {
    preferences,
    setPendingPlayerName(name: string) {
      setPreferences("pendingPlayerName", sanitizePlayerName(name));
    },
    setMouseSensitivity(sensitivity: number) {
      setPreferences("mouseSensitivity", clampMouseSensitivity(sensitivity));
    },
    setInvertY(invertY: boolean) {
      setPreferences("invertY", invertY);
    },
    setRenderDistance(renderDistance: number) {
      setPreferences("renderDistance", clampRenderDistance(renderDistance));
    },
    setShowDiagnostics(showDiagnostics: boolean) {
      setPreferences("showDiagnostics", showDiagnostics);
    },
  } as const;
}

function readGameplayPreferences(): GameplayPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  const storedName = sanitizePlayerName(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "");
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      ...DEFAULT_PREFERENCES,
      pendingPlayerName: storedName || DEFAULT_PREFERENCES.pendingPlayerName,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GameplayPreferences>;
    return {
      pendingPlayerName: sanitizePlayerName(parsed.pendingPlayerName ?? storedName ?? DEFAULT_PREFERENCES.pendingPlayerName),
      mouseSensitivity: clampMouseSensitivity(parsed.mouseSensitivity ?? DEFAULT_PREFERENCES.mouseSensitivity),
      invertY: Boolean(parsed.invertY),
      renderDistance: clampRenderDistance(parsed.renderDistance ?? DEFAULT_PREFERENCES.renderDistance),
      showDiagnostics: parsed.showDiagnostics ?? DEFAULT_PREFERENCES.showDiagnostics,
    };
  } catch {
    return {
      ...DEFAULT_PREFERENCES,
      pendingPlayerName: storedName || DEFAULT_PREFERENCES.pendingPlayerName,
    };
  }
}

function sanitizePlayerName(name: string): string {
  const trimmed = name.trim().slice(0, 32);
  return trimmed || DEFAULT_PREFERENCES.pendingPlayerName;
}

function clampMouseSensitivity(value: number): number {
  return Math.min(MAX_MOUSE_SENSITIVITY, Math.max(MIN_MOUSE_SENSITIVITY, roundToTwoPlaces(value)));
}

function clampRenderDistance(value: number): number {
  return Math.min(MAX_RENDER_DISTANCE, Math.max(MIN_RENDER_DISTANCE, Math.round(value)));
}

function roundToTwoPlaces(value: number): number {
  return Math.round(value * 100) / 100;
}
