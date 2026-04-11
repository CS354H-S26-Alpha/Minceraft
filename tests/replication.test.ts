import { describe, expect, it } from "vitest";
import { ClientEntity } from "../src/client/replication";
import { PLAYER_SPEED, Player, playerDistanceSq } from "../src/game/player";

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
  return { player, replicated: new ClientEntity(player, playerDistanceSq) };
}

describe("ClientEntity", () => {
  it("leaves local state alone when authoritative matches", () => {
    const { player, replicated } = makeReplicated(10, 20);
    replicated.reconcile(S({ x: 10, z: 20 }), 0);
    expect(player.state.x).toBeCloseTo(10);
    expect(player.state.z).toBeCloseTo(20);
  });

  it("ignores small drift under the default threshold after initialization", () => {
    const { player, replicated } = makeReplicated();
    replicated.reconcile(S(), 0);
    replicated.reconcile(S({ x: 1, z: 1 }), 0);
    expect(player.state.x).toBeCloseTo(0);
    expect(player.state.z).toBeCloseTo(0);
  });

  it("applies server state with no predictions even for small drift", () => {
    const { player, replicated } = makeReplicated();
    replicated.reconcile(S({ x: 1, z: 1 }), 0);
    expect(player.state.x).toBeCloseTo(1);
    expect(player.state.z).toBeCloseTo(1);
  });

  it("snaps to authoritative state when drift exceeds threshold", () => {
    const { player, replicated } = makeReplicated();
    replicated.reconcile(S({ x: 50, z: 50 }), 0);
    expect(player.state.x).toBeCloseTo(50);
    expect(player.state.z).toBeCloseTo(50);
  });

  it("replays unacknowledged inputs after snap", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    replicated.predict(I(1, 0, 0));
    replicated.predict(I(1, 0, 0));

    replicated.reconcile(S({ x: PLAYER_SPEED }), 1);

    expect(player.state.x).toBeCloseTo(PLAYER_SPEED * 3);
  });

  it("no-ops reconciliation when prediction matches server", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    replicated.predict(I(1, 0, 0));

    replicated.reconcile(S({ x: PLAYER_SPEED * 2 }), 2);

    expect(player.state.x).toBeCloseTo(PLAYER_SPEED * 2);
  });

  it("corrects misprediction by resetting and replaying", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    replicated.predict(I(1, 0, 0));

    replicated.reconcile(S({ x: 10 }), 1);

    expect(player.state.x).toBeCloseTo(10 + PLAYER_SPEED);
  });

  it("trims history correctly across multiple reconciliations", () => {
    const { player, replicated } = makeReplicated();

    replicated.predict(I(1, 0, 0));
    replicated.predict(I(0, 0, 1));
    replicated.predict(I(1, 0, 0));

    replicated.reconcile(S({ x: PLAYER_SPEED }), 1);

    replicated.predict(I(0, 0, 1));

    const expectedZ = PLAYER_SPEED;
    replicated.reconcile(S({ x: PLAYER_SPEED * 2, z: expectedZ }), 3);

    expect(player.state.x).toBeCloseTo(PLAYER_SPEED * 2);
    expect(player.state.z).toBeCloseTo(expectedZ + PLAYER_SPEED);
  });
});
