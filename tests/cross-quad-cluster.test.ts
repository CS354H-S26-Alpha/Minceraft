import { describe, expect, it } from "vitest";
import { CrossQuadCluster } from "../src/client/engine/render/cross-quad-cluster";

describe("CrossQuadCluster", () => {
  it("builds three crossed planes worth of geometry", () => {
    const cluster = new CrossQuadCluster();

    expect(cluster.positionsFlat().length).toBe(3 * 4 * 4);
    expect(cluster.normalsFlat().length).toBe(3 * 4 * 4);
    expect(cluster.uvFlat().length).toBe(3 * 4 * 2);
    expect(cluster.indicesFlat().length).toBe(3 * 6);
  });
});
