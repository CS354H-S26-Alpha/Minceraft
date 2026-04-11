export class Chunk {
  private cubes: number; // Number of cubes that should be *drawn* each frame
  private cubePositionsF32!: Float32Array; // (4 x cubes) array of cube translations, in homogeneous coordinates
  private x: number; // Center of the chunk
  private y: number;
  private size: number; // Number of cubes along each side of the chunk
  private seed: number; // Seed for terrain generation

  constructor(centerX: number, centerY: number, size: number, seed?: number) {
    this.x = centerX;
    this.y = centerY;
    this.size = size;
    this.cubes = size * size;
    this.seed = seed !== undefined ? seed : Math.floor(Math.random() * 1000000);
    console.log("Chunk seed:", this.seed);
    this.generateCubes();
  }

  // Hash function: maps integer coordinates (x, z) to a pseudorandom value in [0, 1]
  private hash2D(x: number, z: number): number {
    let hash = this.seed;
    hash = (hash ^ (x * 374761393)) & 0x7fffffff;
    hash = (hash ^ (z * 668265263)) & 0x7fffffff;
    hash = (hash * 1274126177) & 0x7fffffff;
    return hash / 0x7fffffff; // Normalize to [0, 1]
  }

  // Smooth interpolation function (smoothstep)
  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  // Bilinear interpolation with smoothstep
  private bilerp(
    v00: number,
    v10: number,
    v01: number,
    v11: number,
    tx: number,
    tz: number,
  ): number {
    const sx = this.smoothstep(tx);
    const sz = this.smoothstep(tz);
    const v0 = v00 * (1 - sx) + v10 * sx;
    const v1 = v01 * (1 - sx) + v11 * sx;
    return v0 * (1 - sz) + v1 * sz;
  }

  // Value noise [0, 1] at a given frequency
  private valueNoise(x: number, z: number, frequency: number): number {
    // Scale coordinates by frequency
    const sx = x * frequency;
    const sz = z * frequency;

    // Get integer lattice coordinates
    const x0 = Math.floor(sx);
    const z0 = Math.floor(sz);
    const x1 = x0 + 1;
    const z1 = z0 + 1;

    // Get fractional part for interpolation
    const tx = sx - x0;
    const tz = sz - z0;

    // Get random values at lattice points
    const v00 = this.hash2D(x0, z0);
    const v10 = this.hash2D(x1, z0);
    const v01 = this.hash2D(x0, z1);
    const v11 = this.hash2D(x1, z1);

    // Bilinear interpolation
    return this.bilerp(v00, v10, v01, v11, tx, tz);
  }

  // Multi-octave terrain: 3 octaves with different grid sizes, upsampled & combined
  private terrainHeight(x: number, z: number): number {
    // Octave 1: 4x4 grid upsampled (large mountains/valleys)
    const octave1 = this.valueNoise(x, z, 1.0 / 16.0);

    // Octave 2: 8x8 grid upsampled (medium hills)
    const octave2 = this.valueNoise(x, z, 1.0 / 8.0);

    // Octave 3: 16x16 grid upsampled (local detail)
    const octave3 = this.valueNoise(x, z, 1.0 / 4.0);

    // Combine with decreasing weights (50 + 25 + 12.5 = 87.5 max)
    const height = octave1 * 50 + octave2 * 25 + octave3 * 12.5;

    // Scale to [0, 100]
    return Math.floor((height / 87.5) * 100);
  }

  private generateCubes() {
    const topleftx = this.x - this.size / 2;
    const toplefty = this.y - this.size / 2;

    this.cubes = this.size * this.size;
    this.cubePositionsF32 = new Float32Array(4 * this.cubes);

    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        // Use global coordinates for seamless chunks
        const globalX = topleftx + j;
        const globalZ = toplefty + i;

        // Get height using 3 octaves [0, 100]
        const height = this.terrainHeight(globalX, globalZ);

        const idx = this.size * i + j;
        this.cubePositionsF32[4 * idx + 0] = globalX;
        this.cubePositionsF32[4 * idx + 1] = height;
        this.cubePositionsF32[4 * idx + 2] = globalZ;
        this.cubePositionsF32[4 * idx + 3] = 0;
      }
    }
  }

  public cubePositions(): Float32Array {
    return this.cubePositionsF32;
  }

  public numCubes(): number {
    return this.cubes;
  }
}
