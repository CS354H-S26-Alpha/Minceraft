interface DeathScreenProps {
  onRespawn: () => void;
}

export function DeathScreen(props: DeathScreenProps) {
  return (
    <div class="absolute inset-0 z-50 flex items-center justify-center bg-[linear-gradient(rgba(18,0,0,0.48),rgba(0,0,0,0.72)),linear-gradient(45deg,rgba(255,255,255,0.04)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.04)_50%,rgba(255,255,255,0.04)_75%,transparent_75%,transparent)] bg-[length:100%_100%,16px_16px] px-4 py-6">
      <div class="w-full max-w-md">
        <h2 class="mb-7 text-center font-mono text-[34px] font-bold tracking-[0.04em] text-[#ff9f9f] [text-shadow:0_3px_0_rgba(0,0,0,0.88)]">
          You Died!
        </h2>
        <button
          type="button"
          class="w-full border-2 border-black bg-[linear-gradient(180deg,#b8b8b8,#8d8d8d)] px-4 py-3 text-center font-mono text-[15px] font-bold tracking-[0.04em] text-white [box-shadow:inset_0_1px_0_rgba(255,255,255,0.38),inset_0_-2px_0_rgba(0,0,0,0.32)] [text-shadow:0_2px_0_rgba(0,0,0,0.72)] transition hover:bg-[linear-gradient(180deg,#cdcdcd,#9a9a9a)] focus:outline-none focus:ring-2 focus:ring-white/70"
          onClick={props.onRespawn}
        >
          Respawn
        </button>

        <div class="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[#dedede] [text-shadow:0_1px_0_rgba(0,0,0,0.85)]">
          Return to the original spawn point.
        </div>
      </div>
    </div>
  );
}
