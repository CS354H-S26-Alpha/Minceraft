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

    this.normals = new Float32Array([
      0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
    ]);

    this.uvs = new Float32Array([0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]);
  }

  positionsFlat(): Float32Array {
    return this.positions;
  }

  indicesFlat(): Uint32Array {
    return this.indices;
  }

  normalsFlat(): Float32Array {
    return this.normals;
  }

  uvFlat(): Float32Array {
    return this.uvs;
  }
}
