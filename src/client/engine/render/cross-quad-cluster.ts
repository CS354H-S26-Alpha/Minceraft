/**
 * Three crossed vertical quads sharing a center point.
 *
 * This keeps the object pass cheap and instanced while giving foliage and
 * trees some volume when viewed from different angles.
 */
export class CrossQuadCluster {
  private positions: Float32Array;
  private indices: Uint32Array;
  private normals: Float32Array;
  private uvs: Float32Array;

  constructor() {
    const planeAngles = [0, Math.PI / 3, (2 * Math.PI) / 3];
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let plane = 0; plane < planeAngles.length; plane++) {
      const angle = planeAngles[plane] ?? 0;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const baseIndex = plane * 4;

      const planeVertices = [
        [-0.5, -0.5, 0.0, 1.0],
        [0.5, -0.5, 0.0, 1.0],
        [0.5, 0.5, 0.0, 1.0],
        [-0.5, 0.5, 0.0, 1.0],
      ];

      for (const vertex of planeVertices) {
        const x = vertex[0] ?? 0;
        const y = vertex[1] ?? 0;
        const z = vertex[2] ?? 0;
        const rotatedX = x * cosA + z * sinA;
        const rotatedZ = -x * sinA + z * cosA;
        positions.push(rotatedX, y, rotatedZ, 1.0);
      }

      const nx = Math.sin(angle);
      const nz = Math.cos(angle);
      for (let i = 0; i < 4; i++) {
        normals.push(nx, 0.0, nz, 0.0);
      }

      uvs.push(0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0);
      indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
    }

    this.positions = new Float32Array(positions);
    this.indices = new Uint32Array(indices);
    this.normals = new Float32Array(normals);
    this.uvs = new Float32Array(uvs);
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
