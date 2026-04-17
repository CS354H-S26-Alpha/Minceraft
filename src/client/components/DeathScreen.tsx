import { Button } from "./Button";

interface DeathScreenProps {
  onRespawn: () => void;
}

export function DeathScreen(props: DeathScreenProps) {
  return (
    <div class="absolute inset-0 z-50 flex items-center justify-center bg-[linear-gradient(rgba(18,0,0,0.48),rgba(0,0,0,0.72)),linear-gradient(45deg,rgba(255,255,255,0.04)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.04)_50%,rgba(255,255,255,0.04)_75%,transparent_75%,transparent)] bg-[length:100%_100%,16px_16px] px-4 py-6">
      <div class="w-full max-w-md">
        <h2 class="mb-7 text-center text-[34px] font-bold tracking-[0.04em] text-[#ff9f9f] [text-shadow:0_3px_0_rgba(0,0,0,0.88)]">
          You Died!
        </h2>
        <Button class="w-full py-3 text-[17px]" onClick={props.onRespawn}>
          Respawn
        </Button>

        <div class="mt-4 text-center text-[11px] uppercase tracking-[0.14em] text-[#dedede] [text-shadow:0_1px_0_rgba(0,0,0,0.85)]">
          Return to the original spawn point.
        </div>
      </div>
    </div>
  );
}
