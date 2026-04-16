export function getLookDirection(yaw: number, pitch: number) {
  const cosPitch = Math.cos(pitch);
  return {
    x: cosPitch * Math.sin(yaw),
    y: Math.sin(pitch),
    z: -cosPitch * Math.cos(yaw),
  };
}
