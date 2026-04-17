import type { JSX } from "solid-js";
import { MAX_RENDER_DISTANCE, MIN_RENDER_DISTANCE } from "../engine/chunks";
import type { GameplayPreferences } from "../primitives/gameplay-preferences";
import { Button } from "./Button";

interface SettingsMenuProps {
  preferences: GameplayPreferences;
  onBack: () => void;
  onNameInput: (name: string) => void;
  onNameBlur: () => void;
  onMouseSensitivityInput: (value: number) => void;
  onInvertYInput: (value: boolean) => void;
  onRenderDistanceInput: (value: number) => void;
  onShowDiagnosticsInput: (value: boolean) => void;
}

export function SettingsMenu(props: SettingsMenuProps) {
  return (
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-[linear-gradient(rgba(0,0,0,0.46),rgba(0,0,0,0.62)),linear-gradient(45deg,rgba(255,255,255,0.05)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.05)_50%,rgba(255,255,255,0.05)_75%,transparent_75%,transparent)] bg-[length:100%_100%,16px_16px] px-4 py-6">
      <div class="w-full max-w-2xl">
        <div class="mb-6 flex items-center justify-between gap-4">
          <h2 class="text-[32px] font-bold tracking-[0.04em] text-white [text-shadow:0_3px_0_rgba(0,0,0,0.88)]">
            Settings
          </h2>
          <Button class="px-4 py-2 text-sm" onClick={props.onBack}>
            Back
          </Button>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <SettingCard label="Display Name">
            <input
              type="text"
              value={props.preferences.pendingPlayerName}
              maxLength={32}
              class="w-full border-2 border-black bg-[#d7d7d7] px-3 py-2 font-mono text-sm text-black focus:outline-none focus:ring-2 focus:ring-white/70"
              onInput={(event) => props.onNameInput(event.currentTarget.value)}
              onBlur={() => props.onNameBlur()}
            />
            <p class="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#dcdcdc]">
              Applies next time you reconnect.
            </p>
          </SettingCard>

          <SettingCard label="Mouse Sensitivity">
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="0.25"
                max="2"
                step="0.05"
                value={props.preferences.mouseSensitivity}
                class="w-full accent-[#d7d7d7]"
                onInput={(event) => props.onMouseSensitivityInput(Number(event.currentTarget.value))}
              />
              <div class="w-14 text-right font-mono text-sm font-bold tracking-[0.04em] text-white [text-shadow:0_1px_0_rgba(0,0,0,0.7)]">
                {props.preferences.mouseSensitivity.toFixed(2)}x
              </div>
            </div>
          </SettingCard>

          <SettingCard label="Invert Look">
            <ToggleRow
              checked={props.preferences.invertY}
              description="Reverse vertical mouse look."
              label="Invert Y"
              onInput={props.onInvertYInput}
            />
          </SettingCard>

          <SettingCard label="Diagnostics">
            <ToggleRow
              checked={props.preferences.showDiagnostics}
              description="Show FPS, TPS, and online player diagnostics."
              label="Show diagnostics"
              onInput={props.onShowDiagnosticsInput}
            />
          </SettingCard>
        </div>

        <div class="mt-4">
          <SettingCard label="Chunk Render Distance">
            <div class="flex items-center gap-3">
              <input
                type="range"
                min={MIN_RENDER_DISTANCE}
                max={MAX_RENDER_DISTANCE}
                step="1"
                value={props.preferences.renderDistance}
                class="w-full accent-[#d7d7d7]"
                onInput={(event) => props.onRenderDistanceInput(Number(event.currentTarget.value))}
              />
              <div class="w-24 text-right font-mono text-sm font-bold tracking-[0.04em] text-white [text-shadow:0_1px_0_rgba(0,0,0,0.7)]">
                {props.preferences.renderDistance} chunk{props.preferences.renderDistance === 1 ? "" : "s"}
              </div>
            </div>
          </SettingCard>
        </div>
      </div>
    </div>
  );
}

function SettingCard(props: { label: string; children: JSX.Element }) {
  return (
    <div class="border-2 border-black bg-black/28 p-4">
      <div class="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white [text-shadow:0_1px_0_rgba(0,0,0,0.85)]">
        {props.label}
      </div>
      {props.children}
    </div>
  );
}

function ToggleRow(props: {
  label: string;
  description: string;
  checked: boolean;
  onInput: (checked: boolean) => void;
}) {
  return (
    <label class="flex cursor-pointer items-center justify-between gap-3">
      <div>
        <div class="font-mono text-sm font-bold tracking-[0.04em] text-white [text-shadow:0_1px_0_rgba(0,0,0,0.85)]">
          {props.label}
        </div>
        <div class="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[#dcdcdc]">{props.description}</div>
      </div>

      <input
        type="checkbox"
        checked={props.checked}
        class="h-5 w-5 accent-[#d7d7d7]"
        onInput={(event) => props.onInput(event.currentTarget.checked)}
      />
    </label>
  );
}
