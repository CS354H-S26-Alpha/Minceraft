import gruntSoundUrl from "@/assets/sounds/grunt.m4a";

const PLAYER_HIT_VOLUME = 0.7;

export interface SoundEffects {
  playPlayerHit(): void;
}

export function createSoundEffects(): SoundEffects {
  const playerHitSound = new Audio(gruntSoundUrl);
  playerHitSound.preload = "auto";
  playerHitSound.volume = PLAYER_HIT_VOLUME;
  playerHitSound.load();

  if (typeof window !== "undefined") {
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);

      const wasMuted = playerHitSound.muted;
      playerHitSound.muted = true;
      void playerHitSound
        .play()
        .then(() => {
          playerHitSound.pause();
          playerHitSound.currentTime = 0;
        })
        .catch(() => {})
        .finally(() => {
          playerHitSound.muted = wasMuted;
        });
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
  }

  return {
    playPlayerHit() {
      playerHitSound.pause();
      playerHitSound.currentTime = 0;
      void playerHitSound.play().catch(() => {});
    },
  };
}
