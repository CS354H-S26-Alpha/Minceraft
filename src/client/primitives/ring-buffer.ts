/**
 * Fixed-size circular buffer. Values are pushed in FIFO order;
 * `ordered()` returns the contents from oldest to newest.
 */
export function createRingBuffer(size: number) {
  const buffer = new Array<number>(size).fill(0);
  let index = 0;

  return {
    push(value: number) {
      buffer[index] = value;
      index = (index + 1) % size;
    },
    ordered(): number[] {
      return [...buffer.slice(index), ...buffer.slice(0, index)];
    },
  } as const;
}

export type RingBuffer = ReturnType<typeof createRingBuffer>;
