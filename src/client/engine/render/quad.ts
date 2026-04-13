/**
 * Axis-aligned vertical quad geometry: a 1×1 square in the XY plane, centred
 * at the origin. Used as the billboard geometry for player sprites.
 */
export class Quad {
  private positions: Float32Array;
  private indices: Uint32Array;
  private normals: Float32Array;
  private uvs: Float32Array;

  constructor() {
    // Vertical plane: 1.0 x 1.0 square, centered at origin
    this.positions = new Float32Array([
      // bottom-left, bottom-right, top-right, top-left
      -0.5, -0.5, 0.0, 1.0, 0.5, -0.5, 0.0, 1.0, 0.5, 0.5, 0.0, 1.0, -0.5, 0.5, 0.0, 1.0,
    ]);

    this.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    this.normals = new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);

    this.uvs = new Float32Array([0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]);
  }

  /** Flat `Float32Array` of vertex positions `[x, y, z, w]` per vertex. */
  positionsFlat(): Float32Array {
    return this.positions;
  }

  /** Flat `Uint32Array` of triangle indices. */
  indicesFlat(): Uint32Array {
    return this.indices;
  }

  /** Flat `Float32Array` of per-vertex normals `[nx, ny, nz, 0]`. */
  normalsFlat(): Float32Array {
    return this.normals;
  }

  /** Flat `Float32Array` of per-vertex UV coordinates `[u, v]`. */
  uvFlat(): Float32Array {
    return this.uvs;
  }
}
