import { createEffect } from "solid-js";
import { createStore } from "solid-js/store";
import { DEFAULT_RENDER_DISTANCE, MAX_RENDER_DISTANCE, MIN_RENDER_DISTANCE } from "../engine/chunks";

const STORAGE_KEY = "gameplay-preferences";
const PLAYER_NAME_STORAGE_KEY = "player-name";
const MAX_PLAYER_NAME_LENGTH = 32;
const DEFAULT_PLAYER_NAME = "Player";
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
  pendingPlayerName: DEFAULT_PLAYER_NAME,
  mouseSensitivity: 1,
  invertY: false,
  renderDistance: DEFAULT_RENDER_DISTANCE,
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
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, JSON.stringify(preferences.pendingPlayerName));
  });

  return {
    preferences,
    setPendingPlayerName(name: string) {
      setPreferences("pendingPlayerName", name.slice(0, MAX_PLAYER_NAME_LENGTH));
    },
    commitPlayerName() {
      setPreferences("pendingPlayerName", sanitizePlayerName(preferences.pendingPlayerName));
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

  const storedName = readStoredPlayerName();
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
      pendingPlayerName: sanitizePlayerName(
        parsed.pendingPlayerName ?? storedName ?? DEFAULT_PREFERENCES.pendingPlayerName,
      ),
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

function readStoredPlayerName(): string {
  const raw = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed.trim();
  } catch {
    // Legacy raw-string value — fall through.
  }
  return raw.trim();
}

function sanitizePlayerName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
  return trimmed || DEFAULT_PLAYER_NAME;
}

function clampMouseSensitivity(value: number): number {
  return Math.min(MAX_MOUSE_SENSITIVITY, Math.max(MIN_MOUSE_SENSITIVITY, Math.round(value * 100) / 100));
}

function clampRenderDistance(value: number): number {
  return Math.min(MAX_RENDER_DISTANCE, Math.max(MIN_RENDER_DISTANCE, Math.round(value)));
}
