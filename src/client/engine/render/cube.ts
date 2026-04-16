import { Vec3, Vec4 } from "gl-matrix";

/**
 * Unit cube geometry: 6 faces × 4 vertices, with per-face normals and UVs.
 * Positions, normals, and indices are pre-packed into typed arrays for WebGL.
 */
export class Cube {
  private positionsRay: Vec4[];
  private indicesRay: Vec3[];
  private normalsRay: Vec4[];
  private uvRay: Vec3[];

  private positionsF32: Float32Array;
  private indicesU32: Uint32Array;
  private normalsF32: Float32Array;
  private uvF32: Float32Array;

  constructor() {
    // Unit cube spanning [0, 1] per axis. Block at integer offset (bx, by, bz)
    // occupies [bx, bx+1] in world space, matching collision conventions.
    this.positionsRay = [
      /* Top */
      new Vec4([0.0, 1.0, 0.0, 1.0]),
      new Vec4([0.0, 1.0, 1.0, 1.0]),
      new Vec4([1.0, 1.0, 1.0, 1.0]),
      new Vec4([1.0, 1.0, 0.0, 1.0]),
      /* Left */
      new Vec4([0.0, 1.0, 1.0, 1.0]),
      new Vec4([0.0, 0.0, 1.0, 1.0]),
      new Vec4([0.0, 0.0, 0.0, 1.0]),
      new Vec4([0.0, 1.0, 0.0, 1.0]),
      /* Right */
      new Vec4([1.0, 1.0, 1.0, 1.0]),
      new Vec4([1.0, 0.0, 1.0, 1.0]),
      new Vec4([1.0, 0.0, 0.0, 1.0]),
      new Vec4([1.0, 1.0, 0.0, 1.0]),
      /* Front */
      new Vec4([1.0, 1.0, 1.0, 1.0]),
      new Vec4([1.0, 0.0, 1.0, 1.0]),
      new Vec4([0.0, 0.0, 1.0, 1.0]),
      new Vec4([0.0, 1.0, 1.0, 1.0]),
      /* Back */
      new Vec4([1.0, 1.0, 0.0, 1.0]),
      new Vec4([1.0, 0.0, 0.0, 1.0]),
      new Vec4([0.0, 0.0, 0.0, 1.0]),
      new Vec4([0.0, 1.0, 0.0, 1.0]),
      /* Bottom */
      new Vec4([0.0, 0.0, 0.0, 1.0]),
      new Vec4([0.0, 0.0, 1.0, 1.0]),
      new Vec4([1.0, 0.0, 1.0, 1.0]),
      new Vec4([1.0, 0.0, 0.0, 1.0]),
    ];
    console.assert(this.positionsRay != null);
    console.assert(this.positionsRay.length === 4 * 6);
    this.positionsF32 = new Float32Array(this.positionsRay.length * 4);
    this.positionsRay.forEach((v: Vec4, i: number) => {
      this.positionsF32.set(v, i * 4);
    });
    console.assert(this.positionsF32 != null);
    console.assert(this.positionsF32.length === 4 * 6 * 4);

    this.indicesRay = [
      /* Top */
      new Vec3([0, 1, 2]),
      new Vec3([0, 2, 3]),
      /* Left */
      new Vec3([5, 4, 6]),
      new Vec3([6, 4, 7]),
      /* Right */
      new Vec3([8, 9, 10]),
      new Vec3([8, 10, 11]),
      /* Front */
      new Vec3([13, 12, 14]),
      new Vec3([15, 14, 12]),
      /* Back */
      new Vec3([16, 17, 18]),
      new Vec3([16, 18, 19]),
      /* Bottom */
      new Vec3([21, 20, 22]),
      new Vec3([22, 20, 23]),
    ];
    console.assert(this.indicesRay != null);
    console.assert(this.indicesRay.length === 12);
    this.indicesU32 = new Uint32Array(this.indicesRay.length * 3);
    this.indicesRay.forEach((v: Vec3, i: number) => {
      this.indicesU32.set(v, i * 3);
    });
    console.assert(this.indicesU32 != null);
    console.assert(this.indicesU32.length === 12 * 3);

    this.normalsRay = [
      /* Top */
      new Vec4([0.0, 1.0, 0.0, 0.0]),
      new Vec4([0.0, 1.0, 0.0, 0.0]),
      new Vec4([0.0, 1.0, 0.0, 0.0]),
      new Vec4([0.0, 1.0, 0.0, 0.0]),
      /* Left */
      new Vec4([-1.0, 0.0, 0.0, 0.0]),
      new Vec4([-1.0, 0.0, 0.0, 0.0]),
      new Vec4([-1.0, 0.0, 0.0, 0.0]),
      new Vec4([-1.0, 0.0, 0.0, 0.0]),
      /* Right */
      new Vec4([1.0, 0.0, 0.0, 0.0]),
      new Vec4([1.0, 0.0, 0.0, 0.0]),
      new Vec4([1.0, 0.0, 0.0, 0.0]),
      new Vec4([1.0, 0.0, 0.0, 0.0]),
      /* Front */
      new Vec4([0.0, 0.0, 1.0, 0.0]),
      new Vec4([0.0, 0.0, 1.0, 0.0]),
      new Vec4([0.0, 0.0, 1.0, 0.0]),
      new Vec4([0.0, 0.0, 1.0, 0.0]),
      /* Back */
      new Vec4([0.0, 0.0, -1.0, 0.0]),
      new Vec4([0.0, 0.0, -1.0, 0.0]),
      new Vec4([0.0, 0.0, -1.0, 0.0]),
      new Vec4([0.0, 0.0, -1.0, 0.0]),
      /* Bottom */
      new Vec4([0.0, -1.0, 0.0, 0.0]),
      new Vec4([0.0, -1.0, 0.0, 0.0]),
      new Vec4([0.0, -1.0, 0.0, 0.0]),
      new Vec4([0.0, -1.0, 0.0, 0.0]),
    ];
    console.assert(this.normalsRay != null);
    console.assert(this.normalsRay.length === 4 * 6);
    this.normalsF32 = new Float32Array(this.normalsRay.length * 4);
    this.normalsRay.forEach((v: Vec4, i: number) => {
      this.normalsF32.set(v, i * 4);
    });
    console.assert(this.normalsF32 != null);
    console.assert(this.normalsF32.length === 4 * 6 * 4);

    this.uvRay = [
      /* Top */
      new Vec3([0.0, 0.0, 0.0]),
      new Vec3([0.0, 1.0, 0.0]),
      new Vec3([1.0, 1.0, 0.0]),
      new Vec3([1.0, 0.0, 0.0]),
      /* Left */
      new Vec3([0.0, 0.0, 0.0]),
      new Vec3([0.0, 1.0, 0.0]),
      new Vec3([1.0, 1.0, 0.0]),
      new Vec3([1.0, 0.0, 0.0]),
      /* Right */
      new Vec3([0.0, 0.0, 0.0]),
      new Vec3([0.0, 1.0, 0.0]),
      new Vec3([1.0, 1.0, 0.0]),
      new Vec3([1.0, 0.0, 0.0]),
      /* Front */
      new Vec3([0.0, 0.0, 0.0]),
      new Vec3([0.0, 1.0, 0.0]),
      new Vec3([1.0, 1.0, 0.0]),
      new Vec3([1.0, 0.0, 0.0]),
      /* Back */
      new Vec3([0.0, 0.0, 0.0]),
      new Vec3([0.0, 1.0, 0.0]),
      new Vec3([1.0, 1.0, 0.0]),
      new Vec3([1.0, 0.0, 0.0]),
      /* Bottom */
      new Vec3([0.0, 0.0, 0.0]),
      new Vec3([0.0, 1.0, 0.0]),
      new Vec3([1.0, 1.0, 0.0]),
      new Vec3([1.0, 0.0, 0.0]),
    ];
    console.assert(this.uvRay != null);
    console.assert(this.uvRay.length === 4 * 6);
    this.uvF32 = new Float32Array(this.uvRay.length * 2);
    this.uvRay.forEach((v: Vec3, i: number) => {
      this.uvF32.set([v.x, v.y], i * 2);
    });
    console.assert(this.uvF32 != null);
    console.assert(this.uvF32.length === 4 * 6 * 2);
  }

  /** Flat `Float32Array` of vertex positions `[x, y, z, w]` per vertex. */
  public positionsFlat(): Float32Array {
    console.assert(this.positionsF32.length === 24 * 4);
    return this.positionsF32;
  }

  /** Array of triangle index triples (one `Vec3` per triangle). */
  public indices(): Vec3[] {
    console.assert(this.indicesRay.length === 12);
    return this.indicesRay;
  }

  /** Flat `Uint32Array` of triangle indices. */
  public indicesFlat(): Uint32Array {
    console.assert(this.indicesU32.length === 12 * 3);
    return this.indicesU32;
  }

  /** Array of per-vertex normals as `Vec4`. */
  public normals(): Vec4[] {
    return this.normalsRay;
  }

  /** Flat `Float32Array` of per-vertex normals `[nx, ny, nz, 0]`. */
  public normalsFlat(): Float32Array {
    return this.normalsF32;
  }

  /** Flat `Float32Array` of per-vertex UV coordinates `[u, v]`. */
  public uvFlat(): Float32Array {
    return this.uvF32;
  }
}
