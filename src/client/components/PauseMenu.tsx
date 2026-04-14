interface PauseMenuProps {
  currentPlayerName: string;
  pendingPlayerName: string;
  renderDistance: number;
  mouseSensitivity: number;
  onResume: () => void;
  onOpenSettings: () => void;
  onRespawn: () => void;
}

export function PauseMenu(props: PauseMenuProps) {
  return (
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-[linear-gradient(rgba(0,0,0,0.42),rgba(0,0,0,0.58)),linear-gradient(45deg,rgba(255,255,255,0.05)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.05)_50%,rgba(255,255,255,0.05)_75%,transparent_75%,transparent)] bg-[length:100%_100%,16px_16px] px-4 py-6">
      <div class="w-full max-w-md">
        <h2 class="mb-7 text-center font-mono text-[32px] font-bold tracking-[0.04em] text-white [text-shadow:0_3px_0_rgba(0,0,0,0.88)]">
          Game Menu
        </h2>

        <div class="space-y-3">
          <MenuButton label="Back To Game" onClick={props.onResume} />
          <MenuButton label="Settings..." onClick={props.onOpenSettings} />
          <MenuButton label="Respawn" onClick={props.onRespawn} />
        </div>

        <div class="mt-6 border border-black/70 bg-black/28 px-4 py-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[#e6e6e6] [text-shadow:0_1px_0_rgba(0,0,0,0.85)]">
          <div>{props.currentPlayerName}</div>
          <div class="mt-1">
            Next name: {props.pendingPlayerName} · Render: {props.renderDistance} · Sens:{" "}
            {props.mouseSensitivity.toFixed(2)}x
          </div>
        </div>

        <div class="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[#d6d6d6] [text-shadow:0_1px_0_rgba(0,0,0,0.85)]">
          Press Esc to resume. Click the world to relock the camera.
        </div>
      </div>
    </div>
  );
}

function MenuButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="w-full border-2 border-black bg-[linear-gradient(180deg,#b8b8b8,#8d8d8d)] px-4 py-3 text-center font-mono text-[15px] font-bold tracking-[0.04em] text-white [box-shadow:inset_0_1px_0_rgba(255,255,255,0.38),inset_0_-2px_0_rgba(0,0,0,0.32)] [text-shadow:0_2px_0_rgba(0,0,0,0.72)] transition hover:bg-[linear-gradient(180deg,#cdcdcd,#9a9a9a)] focus:outline-none focus:ring-2 focus:ring-white/70"
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
