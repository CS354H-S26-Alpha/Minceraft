/**
 * Low-poly rock mesh with a grounded base and irregular silhouette.
 *
 * The footprint is compact so rocks sit convincingly on the voxel terrain
 * without overwhelming the terrain silhouette from a distance.
 */
export class LowPolyRock {
  private positions: Float32Array;
  private normals: Float32Array;
  private indices: Uint32Array;
  private uvs: Float32Array;

  constructor() {
    const vertices = [
      [0.0, 0.78, 0.0],
      [0.62, 0.42, 0.08],
      [0.28, 0.36, 0.58],
      [-0.36, 0.4, 0.54],
      [-0.66, 0.3, -0.02],
      [-0.22, 0.34, -0.62],
      [0.42, 0.28, -0.5],
      [0.42, 0.0, 0.26],
      [0.06, 0.0, 0.52],
      [-0.4, 0.0, 0.26],
      [-0.48, 0.0, -0.2],
      [0.02, 0.0, -0.48],
      [0.46, 0.0, -0.14],
    ];

    const faces = [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
      [0, 4, 5],
      [0, 5, 6],
      [0, 6, 1],
      [1, 7, 2],
      [2, 7, 8],
      [2, 8, 3],
      [3, 8, 9],
      [3, 9, 4],
      [4, 9, 10],
      [4, 10, 5],
      [5, 10, 11],
      [5, 11, 6],
      [6, 11, 12],
      [6, 12, 1],
      [1, 12, 7],
      [7, 12, 8],
      [8, 12, 11],
      [8, 11, 9],
      [9, 11, 10],
    ];

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    let vertexIndex = 0;
    for (const face of faces) {
      const a = vertices[face[0] ?? 0] ?? [0, 0, 0];
      const b = vertices[face[1] ?? 0] ?? [0, 0, 0];
      const c = vertices[face[2] ?? 0] ?? [0, 0, 0];

      const abX = (b[0] ?? 0) - (a[0] ?? 0);
      const abY = (b[1] ?? 0) - (a[1] ?? 0);
      const abZ = (b[2] ?? 0) - (a[2] ?? 0);
      const acX = (c[0] ?? 0) - (a[0] ?? 0);
      const acY = (c[1] ?? 0) - (a[1] ?? 0);
      const acZ = (c[2] ?? 0) - (a[2] ?? 0);
      const normal = [abY * acZ - abZ * acY, abZ * acX - abX * acZ, abX * acY - abY * acX];
      const normalLength = Math.hypot(normal[0] ?? 0, normal[1] ?? 0, normal[2] ?? 0) || 1;
      const nx = (normal[0] ?? 0) / normalLength;
      const ny = (normal[1] ?? 0) / normalLength;
      const nz = (normal[2] ?? 0) / normalLength;

      for (const vertex of [a, b, c]) {
        positions.push(vertex[0] ?? 0, vertex[1] ?? 0, vertex[2] ?? 0, 1.0);
        normals.push(nx, ny, nz, 0.0);
        uvs.push((vertex[0] ?? 0) * 0.5 + 0.5, (vertex[2] ?? 0) * 0.5 + 0.5);
      }

      indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
      vertexIndex += 3;
    }

    this.positions = new Float32Array(positions);
    this.normals = new Float32Array(normals);
    this.indices = new Uint32Array(indices);
    this.uvs = new Float32Array(uvs);
  }

  positionsFlat(): Float32Array {
    return this.positions;
  }

  normalsFlat(): Float32Array {
    return this.normals;
  }

  indicesFlat(): Uint32Array {
    return this.indices;
  }

  uvFlat(): Float32Array {
    return this.uvs;
  }
}
