import { describe, expect, it } from "vitest";
import { LocalPrediction } from "../src/client/engine/local-prediction";
import { PLAYER_SPEED, Player } from "../src/game/player";

const S = (
  overrides: Partial<{
    id: string;
    name: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }> = {},
) => ({ id: "p1", name: "test", x: 0, y: 100, z: 0, yaw: 0, pitch: 0, ...overrides });

const I = (dx: number, dy: number, dz: number) => ({
  dx,
  dy,
  dz,
  dtSeconds: 1,
  yaw: 0,
  pitch: 0,
});

function makeReplicated(x = 0, z = 0) {
  const player = new Player(S({ x, z }));
  return { player, replicated: new LocalPrediction(player) };
}

describe("LocalPrediction", () => {
  it("initializes entity to authoritative state", () => {
    const { player, replicated } = makeReplicated();
    replicated.initialize(S({ x: 10, z: 20 }));
    expect(player.state.x).toBeCloseTo(10);
    expect(player.state.z).toBeCloseTo(20);
  });

  it("replays unacked inputs after initialize", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    replicated.predict(I(1, 0, 0));

    replicated.initialize(S({ x: 5 }));

    expect(player.state.x).toBeCloseTo(5 + PLAYER_SPEED * 2);
  });

  it("trims history on acknowledge", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    replicated.predict(I(1, 0, 0));
    replicated.predict(I(1, 0, 0));

    replicated.acknowledge(2);
    replicated.initialize(S({ x: PLAYER_SPEED * 2 }));

    // Only 1 unacked input replayed
    expect(player.state.x).toBeCloseTo(PLAYER_SPEED * 3);
  });

  it("trims correctly across multiple acknowledge calls", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    replicated.predict(I(0, 0, 1));
    replicated.predict(I(1, 0, 0));

    replicated.acknowledge(1);
    replicated.predict(I(0, 0, 1));
    replicated.acknowledge(3);

    // After ack(3), only the last predict remains unacked
    replicated.initialize(S({ x: PLAYER_SPEED * 2, z: PLAYER_SPEED }));

    expect(player.state.x).toBeCloseTo(PLAYER_SPEED * 2);
    expect(player.state.z).toBeCloseTo(PLAYER_SPEED * 2);
  });

  it("predict applies input immediately", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    expect(player.state.x).toBeCloseTo(PLAYER_SPEED);

    replicated.predict(I(1, 0, 0));
    expect(player.state.x).toBeCloseTo(PLAYER_SPEED * 2);
  });
});
