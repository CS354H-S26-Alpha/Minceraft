import { describe, expect, it } from "vitest";
import { LowPolyRock } from "../src/client/engine/render/low-poly-rock";

describe("LowPolyRock", () => {
  it("builds indexed low-poly geometry for instanced rock rendering", () => {
    const rock = new LowPolyRock();

    expect(rock.positionsFlat().length).toBeGreaterThan(0);
    expect(rock.normalsFlat().length).toBe(rock.positionsFlat().length);
    expect(rock.indicesFlat().length).toBeGreaterThanOrEqual(18);
    expect(rock.uvFlat().length).toBe((rock.positionsFlat().length / 4) * 2);
  });
});
