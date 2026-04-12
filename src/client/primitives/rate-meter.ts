/**
 * Windowed event-rate tracker. Call `sample()` each frame with the elapsed
 * time and the number of events that occurred. Read `rate` for the most
 * recently computed events-per-second average.
 */
export function createRateMeter(windowMs: number) {
  let accumMs = 0;
  let accumCount = 0;
  let currentRate = 0;

  return {
    sample(dtMs: number, count = 1) {
      accumMs += dtMs;
      accumCount += count;
      if (accumMs >= windowMs) {
        currentRate = Math.round((accumCount * 1000) / accumMs);
        accumMs = 0;
        accumCount = 0;
      }
    },
    get rate() {
      return currentRate;
    },
  } as const;
}

export type RateMeter = ReturnType<typeof createRateMeter>;
