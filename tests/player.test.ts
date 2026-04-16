import { describe, expect, it } from "vitest";
import { createEmptyInventory, createPlayerState, PLAYER_MAX_HEALTH, PLAYER_SPEED, Player } from "../src/game/player";

const P = (
  overrides: Partial<{
    id: string;
    name: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }> = {},
) =>
  new Player(
    createPlayerState({
      id: "p1",
      name: "test",
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      ...overrides,
    }),
  );

const I = (dx: number, dz: number, jump = false) => ({
  dx,
  dz,
  dtSeconds: 1,
  yaw: 0,
  pitch: 0,
  jump,
});

describe("Player", () => {
  it("initializes with given position", () => {
    const player = P({ x: 10, y: 20, z: 30 });
    expect(player.id).toBe("p1");
    expect(player.state.health).toBe(PLAYER_MAX_HEALTH);
    expect(player.state.x).toBeCloseTo(10);
    expect(player.state.y).toBeCloseTo(20);
    expect(player.state.z).toBeCloseTo(30);
  });

  it("steps in the given direction", () => {
    const player = P();
    player.step(I(1, 0));
    expect(player.state.x).toBeCloseTo(PLAYER_SPEED);
    expect(player.state.y).toBeCloseTo(0);
    expect(player.state.z).toBeCloseTo(0);
  });

  it("normalizes direction so diagonal movement isn't faster", () => {
    const player = P();
    player.step(I(1, 1));
    const dist = Math.sqrt(player.state.x * player.state.x + player.state.z * player.state.z);
    expect(dist).toBeCloseTo(PLAYER_SPEED);
  });

  it("does not move on zero-length input", () => {
    const player = P({ x: 5, y: 10, z: 15 });
    player.step(I(0, 0));
    expect(player.state.x).toBeCloseTo(5);
    expect(player.state.y).toBeCloseTo(10);
    expect(player.state.z).toBeCloseTo(15);
  });

  it("is deterministic across instances", () => {
    const a = P({ y: 100 });
    const b = P({ y: 100 });
    const input = I(0.5, -0.5);
    a.step(input);
    b.step(input);
    expect(a.state.x).toBeCloseTo(b.state.x);
    expect(a.state.z).toBeCloseTo(b.state.z);
  });

  it("adds items into matching stacks before using empty slots", () => {
    const player = P();
    player.state.inventory = createEmptyInventory();
    player.state.inventory[0] = { itemId: "wood", quantity: 60 };

    const leftover = player.addItem({ itemId: "wood", quantity: 8 });

    expect(leftover).toBeNull();
    expect(player.state.inventory[0]).toEqual({ itemId: "wood", quantity: 64 });
    expect(player.state.inventory[1]).toEqual({ itemId: "wood", quantity: 4 });
  });
});
