import Rand from "rand-seed";

export class Chunk {
    private cubes: number; // Number of cubes that should be *drawn* each frame
    private cubePositionsF32!: Float32Array; // (4 x cubes) array of cube translations, in homogeneous coordinates
    private minX : number; // minimum x coordinate of the chunk (inclusive)
    private minZ : number; // minimum z coordinate of the chunk (inclusive)
    private size: number; // Number of cubes along each side of the chunk
    
    constructor(minX : number, minZ : number, size: number) {
        this.minX = minX;
        this.minZ = minZ;
        this.size = size;
        this.cubes = size*size;        
        this.generateCubes();
    }
    
    
    private generateCubes() {
        
      //TODO: The real landscape-generation logic. The example code below shows you how to use the pseudorandom number generator to create a few cubes.
      this.cubes = this.size * this.size;
      this.cubePositionsF32 = new Float32Array(4 * this.cubes);

      const seed = "42";
      let rng = new Rand(seed);
      for(let i=0; i<this.size; i++)
      {
          for(let j=0; j<this.size; j++)
          {
            const height = Math.floor(10.0 * rng.next());
            const idx = this.size * i + j;
            this.cubePositionsF32[4*idx + 0] = this.minX + j;
            this.cubePositionsF32[4*idx + 1] = height;
            this.cubePositionsF32[4*idx + 2] = this.minZ + i;
            this.cubePositionsF32[4*idx + 3] = 0;
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
