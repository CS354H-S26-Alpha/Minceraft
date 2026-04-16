import gruntSoundUrl from "@/assets/sounds/grunt.m4a";

const PLAYER_HIT_VOLUME = 0.7;

export interface SoundEffects {
  playPlayerHit(): void;
}

export function createSoundEffects(): SoundEffects {
  const playerHitSound = new Audio(gruntSoundUrl);
  playerHitSound.preload = "auto";
  playerHitSound.volume = PLAYER_HIT_VOLUME;

  return {
    playPlayerHit() {
      playerHitSound.pause();
      playerHitSound.currentTime = 0;
      void playerHitSound.play().catch(() => {});
    },
  };
}
