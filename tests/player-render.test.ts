import { describe, expect, it } from "vitest";
import { PLAYER_EYE_OFFSET, PLAYER_SPEED, type PlayerPublicState } from "../src/game/player";
import {
  interpolatePlayerRenderState,
  packPlayerRenderStates,
} from "../src/client/engine/entities/player-render-state";

function createPublicPlayerState(overrides: Partial<PlayerPublicState> = {}): PlayerPublicState {
  return {
    id: "player-1",
    name: "Player One",
    x: 0,
    y: 70,
    z: 0,
    yaw: 0,
    pitch: 0,
    ...overrides,
  };
}

describe("playerPipelineConfig", () => {
  it("interpolates remote players and packs walk animation inputs", () => {
    const prev = createPublicPlayerState();
    const curr = createPublicPlayerState({
      x: PLAYER_SPEED * 0.05,
      z: PLAYER_SPEED * 0.025,
      yaw: Math.PI / 2,
      pitch: 0.25,
    });

    const state = interpolatePlayerRenderState(prev, curr, 0.5);
    const buffers: Record<string, Float32Array> = {};
    const count = packPlayerRenderStates([state], buffers);

    expect(count).toBe(1);
    expect(state.x).toBeCloseTo(curr.x * 0.5);
    expect(state.z).toBeCloseTo(curr.z * 0.5);
    expect(state.yaw).toBeCloseTo(Math.PI / 4);
    expect(state.walkSpeed).toBeCloseTo(Math.hypot(curr.x - prev.x, curr.z - prev.z) / 0.05);
    expect(state.phaseOffset).toBeGreaterThanOrEqual(0);
    expect(state.phaseOffset).toBeLessThanOrEqual(Math.PI * 2);

    expect(buffers.aOffset[0]).toBeCloseTo(state.x);
    expect(buffers.aOffset[1]).toBeCloseTo(state.y - PLAYER_EYE_OFFSET);
    expect(buffers.aOffset[2]).toBeCloseTo(state.z);
    expect(buffers.aOffset[3]).toBeCloseTo(state.yaw);
    expect(buffers.aPitch[0]).toBeCloseTo(state.pitch);
    expect(buffers.aMotion[0]).toBeCloseTo(state.walkSpeed);
    expect(buffers.aMotion[1]).toBeCloseTo(state.phaseOffset);
  });

  it("keeps stationary remote players idle", () => {
    const state = interpolatePlayerRenderState(createPublicPlayerState(), createPublicPlayerState(), 0.75);

    expect(state.walkSpeed).toBe(0);
    expect(state.phaseOffset).toBeCloseTo(interpolatePlayerRenderState(state, state, 0.5).phaseOffset);
  });
});
