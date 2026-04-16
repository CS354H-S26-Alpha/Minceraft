/** biome-ignore-all lint/style/noNonNullAssertion: checks are bounded */
import { CUBE_TYPE_INFO, CubeType } from "@/client/engine/render/cube-types";
import { BIOME_INFOS, Biome, sampleColumn, surfaceBlock } from "@/game/biome";
import { perlin3D } from "@/utils/noise";

export const CHUNK_SIZE = 64;
export const CHUNK_HEIGHT = 128;
export const SEA_LEVEL = 50; // water surface in non-desert biomes
export const DESERT_LAVA_LEVEL = 55; // lava surface in desert biome
export const CAVE_LAVA_LEVEL = 8; // deep lava fills cave air pockets at the bottom of the world

// Fluid flow parameters.
// Level 0 = source (never depleted). Level 1..MAX = "flowing" with decreasing
// reach; a block at level N can only spread to level N+1, so FLUID_MAX_LEVEL
// caps horizontal spread distance from the nearest direct drop or source.
export const FLUID_SOURCE_LEVEL = 0;
export const FLUID_MAX_LEVEL = 7;

const LATERAL_FLOW_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Pack a (x, y, z) local chunk coordinate into a single 24-bit index. */
function packPos(lx: number, ly: number, lz: number): number {
  return (ly << 16) | (lz << 8) | lx;
}

type Direction = readonly [number, number, number];

interface FaceAmbientOcclusionSpec {
  normal: Direction;
  corners: readonly (readonly [Direction, Direction])[];
}

// Face order matches Cube geometry: top, left, right, front, back, bottom.
const FACE_AMBIENT_OCCLUSION_SPECS: readonly FaceAmbientOcclusionSpec[] = buildFaceAmbientOcclusionSpecs();

/**
 * Generates AO specs for all 6 axis-aligned cube faces.
 *
 * Each face is defined by its outward normal and two tangent axes (t1, t2).
 * The four corners sample neighbours at (n ± s1*t1, n ± s2*t2); the sign
 * pairs are ordered to match the quad-vertex winding of the cube geometry so
 * that bilinear AO interpolation in the shader maps to the correct corners.
 *
 * Three winding patterns arise from the three tangent-axis families:
 *   XZ (Y-axis normals):  (−,−),(−,+),(+,+),(+,−)
 *   YZ (X-axis normals):  (+,+),(−,+),(−,−),(+,−)
 *   XY (Z-axis normals):  (+,+),(+,−),(−,−),(−,+)
 */
function buildFaceAmbientOcclusionSpecs(): readonly FaceAmbientOcclusionSpec[] {
  // Sign pairs [s1, s2] → sideA = s1*t1, sideB = s2*t2.
  const XZ: readonly (readonly [number, number])[] = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ];
  const YZ: readonly (readonly [number, number])[] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  const XY: readonly (readonly [number, number])[] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];

  const makeFace = (
    normal: Direction,
    t1: Direction,
    t2: Direction,
    signs: readonly (readonly [number, number])[],
  ): FaceAmbientOcclusionSpec => ({
    normal,
    corners: signs.map(([s1, s2]): readonly [Direction, Direction] => [
      [s1 * t1[0], s1 * t1[1], s1 * t1[2]] as Direction,
      [s2 * t2[0], s2 * t2[1], s2 * t2[2]] as Direction,
    ]),
  });

  return [
    makeFace([0, 1, 0], [1, 0, 0], [0, 0, 1], XZ), // top
    makeFace([-1, 0, 0], [0, 1, 0], [0, 0, 1], YZ), // left
    makeFace([1, 0, 0], [0, 1, 0], [0, 0, 1], YZ), // right
    makeFace([0, 0, 1], [1, 0, 0], [0, 1, 0], XY), // front
    makeFace([0, 0, -1], [1, 0, 0], [0, 1, 0], XY), // back
    makeFace([0, -1, 0], [1, 0, 0], [0, 0, 1], XZ), // bottom
  ];
}

function vertexAmbientOcclusion(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - Number(side1) - Number(side2) - Number(corner);
}

export function chunkKey(originX: number, originZ: number): string {
  return `${originX},${originZ}`;
}

export function chunkOrigin(wx: number, wz: number): [number, number] {
  return [
    Math.floor((wx + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
    Math.floor((wz + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
  ];
}

// Shared scratch buffers reused across renderChunk calls. Grow on demand so
// total resident footprint is O(max chunk) instead of O(chunks × max chunk).
let scratchPositions = new Float32Array(0);
let scratchColors = new Float32Array(0);
let scratchAmbientOcclusion = new Uint8Array(0);

function ensureScratchCapacity(maxCubes: number): void {
  if (scratchPositions.length < 4 * maxCubes) scratchPositions = new Float32Array(4 * maxCubes);
  if (scratchColors.length < 3 * maxCubes) scratchColors = new Float32Array(3 * maxCubes);
  if (scratchAmbientOcclusion.length < 24 * maxCubes) scratchAmbientOcclusion = new Uint8Array(24 * maxCubes);
}

export class Chunk {
  // types where we store the actual block data
  public blocks: Uint8Array; // 3D block grid (CubeType per voxel): x z y // y*(S*S) + z*S + x
  public heightMap: Uint8Array; // surface height per (i,j) column x z // z*S + x
  /** Flow level per voxel; 0 for source/non-fluid, 1..FLUID_MAX_LEVEL for flowing. */
  public fluidLevels: Uint8Array;
  private surfaceTypesMap: Uint8Array; // top-most block type per (x, z) column

  private x: number; // Center of the chunk
  private y: number;
  private size: number; // Number of cubes along each side of the chunk
  private seed: number; // Seed for terrain generation

  // types to update for Rendering
  private cubes: number = 0;
  private cubePositionsF32: Float32Array = new Float32Array(0);
  private cubeColorsF32: Float32Array = new Float32Array(0);
  private cubeAmbientOcclusionU8: Uint8Array = new Uint8Array(0);
  private maxCubes: number = 0;

  // Packed (y<<16)|(z<<8)|x positions of fluid blocks that may still flow on
  // the next tick. A Set gives O(1) add/remove and natural de-duplication —
  // both important because write-phase helpers (`applyFluidFlow`,
  // `activateFluidNeighbours`) can be triggered from many places in a single
  // tick without risking the list growing unboundedly.
  //
  // Rebuilt each tick so stable (surrounded) cells drop out on their own;
  // source blocks (level 0) are always kept so they remain eligible if an
  // adjacent cell opens up later (e.g. via mining).
  private activeFluids: Set<number> = new Set();

  constructor(centerX: number, centerY: number, size: number, seed: number) {
    this.x = centerX;
    this.y = centerY;
    this.size = size;
    this.seed = seed;

    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT); // with default value 0 = CubeType.Air
    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.surfaceTypesMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.fluidLevels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);

    this.generateCubes();
    this.seedActiveFluids();
    this.computeMaxCubes();
    this.renderChunk(); // render on creation, might not be necessary
  }

  /**
   * Collects every fluid voxel placed during terrain generation into the
   * active-fluid queue. Generated fluids are all sources (level 0), so no
   * level initialisation is required — the zero-default on `fluidLevels` is
   * already correct.
   */
  private seedActiveFluids(): void {
    const S = this.size;
    // blocks is stored on a CHUNK_SIZE × CHUNK_SIZE grid regardless of `size`;
    // the S parameter only bounds which voxels are populated.
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < S; z++) {
        const zOffset = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE;
        for (let x = 0; x < S; x++) {
          const t = this.blocks[zOffset + x];
          if (t === CubeType.Water || t === CubeType.Lava) {
            this.activeFluids.add(packPos(x, y, z));
          }
        }
      }
    }
  }

  private computeMaxCubes(): void {
    let total = 0;
    const S = this.size;
    for (let i = 0; i < S * S; i++) {
      total += this.heightMap[i]! + 1;
    }
    this.maxCubes = total;
  }

  public getBlock(lx: number, ly: number, lz: number): CubeType {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return CubeType.Air;
    return this.blocks[ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] as CubeType;
  }

  /** Look up a block by world-space coordinates. Returns Air if outside this chunk. */
  public getBlockWorld(wx: number, wy: number, wz: number): CubeType {
    const lx = wx - (this.x - this.size / 2);
    const lz = wz - (this.y - this.size / 2);
    return this.getBlock(lx, wy, lz);
  }

  private setBlock(lx: number, ly: number, lz: number, type: CubeType): void {
    this.blocks[ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] = type;
  }

  // Ore definitions: [cubeType, seedOffset, frequency, threshold, minY, maxY]
  private static readonly ORES: [CubeType, number, number, number, number, number][] = [
    [CubeType.CoalOre, 300, 1 / 8, 0.55, 5, 80],
    [CubeType.IronOre, 400, 1 / 10, 0.6, 5, 60],
    [CubeType.GoldOre, 500, 1 / 12, 0.65, 5, 32],
    [CubeType.DiamondOre, 600, 1 / 14, 0.7, 1, 16],
  ];

  // calculate block types for every position in the chunk
  private generateCubes(): void {
    const topleftx = this.x - this.size / 2;
    const topleftz = this.y - this.size / 2;

    // Local biome map used in Pass 4 to distinguish water vs. lava columns.
    const biomeMap = new Uint8Array(this.size * this.size);

    // --- Pass 1: Base terrain fill ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const globalX = topleftx + j;
        const globalZ = topleftz + i;

        const { biome, surfaceBiome, height: rawHeight } = sampleColumn(this.seed, globalX, globalZ);
        biomeMap[this.size * i + j] = biome; // structural biome drives fluid fill
        const height = Math.max(1, Math.min(CHUNK_HEIGHT - 2, rawHeight));

        this.heightMap[this.size * i + j] = height;

        this.setBlock(j, 0, i, CubeType.Bedrock);
        for (let y = 1; y < height - 3; y++) {
          this.setBlock(j, y, i, CubeType.Stone);
        }
        for (let y = Math.max(1, height - 3); y < height; y++) {
          this.setBlock(j, y, i, BIOME_INFOS[biome].subsurface); // subsurface follows structural biome
        }
        const surfaceType = surfaceBlock(surfaceBiome, height, this.seed, globalX, globalZ);
        if (surfaceType === CubeType.Snow && height + 1 < CHUNK_HEIGHT) {
          // Snow sits on top as its own block — base surface stays as stone/etc.
          this.setBlock(j, height, i, BIOME_INFOS[surfaceBiome].surface);
          this.setBlock(j, height + 1, i, CubeType.Snow);
          this.heightMap[this.size * i + j] = height + 1;
          this.surfaceTypesMap[this.size * i + j] = CubeType.Snow;
        } else {
          this.setBlock(j, height, i, surfaceType);
          this.surfaceTypesMap[this.size * i + j] = surfaceType;
        }
      }
    }

    // --- Pass 2: Spaghetti cave carving (tunnel-like, follows noise zero-crossings) ---
    // Coarse Y-span skipping: sample n1 at span midpoints to eliminate regions
    // where no cave can exist. Uses Lipschitz bound (K=2.0) on perlin3D for
    // correctness: over half a CAVE_STEP span at freq 1/64, noise changes by
    // at most CAVE_SKIP_MARGIN, so if |n1_mid| >= threshold + margin, the
    // entire span is cave-free.
    const CAVE_STEP = 8;
    const CAVE_FREQ = 1 / 64;
    const CAVE_THRESHOLD = 0.12;
    const CAVE_CAP = 8;
    const MOUNTAIN_CAVE_FREQ = 1 / 40;
    const MOUNTAIN_CAVE_CAP = 0;
    const caveSkipThreshold = (freq: number) => CAVE_THRESHOLD + 2.0 * Math.ceil(CAVE_STEP / 2) * freq;

    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;
        const isMountain = (biomeMap[this.size * i + j] as Biome) === Biome.Mountain;
        const caveCap = isMountain ? MOUNTAIN_CAVE_CAP : CAVE_CAP;
        const caveFreq = isMountain ? MOUNTAIN_CAVE_FREQ : CAVE_FREQ;
        const caveTop = (this.heightMap[this.size * i + j] as number) - caveCap;
        const skipThreshold = caveSkipThreshold(caveFreq);

        for (let yBase = 1; yBase <= caveTop; yBase += CAVE_STEP) {
          const yEnd = Math.min(yBase + CAVE_STEP, caveTop + 1);
          const yMid = (yBase + yEnd - 1) >> 1;

          const n1Coarse = perlin3D(this.seed + 100, gx, yMid, gz, caveFreq);
          if (Math.abs(n1Coarse) >= skipThreshold) continue;

          for (let y = yBase; y < yEnd; y++) {
            if (this.getBlock(j, y, i) === CubeType.Air) continue;

            const n1 = perlin3D(this.seed + 100, gx, y, gz, caveFreq);
            if (Math.abs(n1) >= CAVE_THRESHOLD) continue;
            const n2 = perlin3D(this.seed + 200, gx, y, gz, caveFreq);
            if (Math.abs(n2) < CAVE_THRESHOLD) {
              this.setBlock(j, y, i, CubeType.Air);
              if (this.getBlock(j, y + 1, i) === CubeType.Snow) {
                this.setBlock(j, y + 1, i, CubeType.Air);
              }
            }
          }
        }
      }
    }

    // --- Pass 2.5: Collapse floating mountain peak caps ---
    // Cave carving (caveCap=0) can sever a thin peak tip from the main mountain body.
    // Per column: scan down from the actual top, find the first air gap, and remove the
    // cap above it if it is ≤5 blocks tall (thin spires are always floating artefacts).
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        if ((biomeMap[this.size * i + j] as Biome) !== Biome.Mountain) continue;
        const idx = this.size * i + j;

        // Find actual topmost solid block (heightMap is stale after cave carving)
        let topY = this.heightMap[idx] as number;
        while (topY > 0 && this.getBlock(j, topY, i) === CubeType.Air) topY--;

        // Scan down through the top solid section looking for the first air gap
        let gapAt = -1;
        for (let y = topY; y > 1; y--) {
          if (this.getBlock(j, y - 1, i) === CubeType.Air) {
            gapAt = y; // lowest block of the floating cap
            break;
          }
        }
        if (gapAt < 0) {
          this.heightMap[idx] = topY;
          continue; // solid all the way down — stable
        }

        const capHeight = topY - gapAt + 1;
        if (capHeight <= 5) {
          // Thin cap — almost certainly a floating artefact; remove it
          for (let y = gapAt; y <= topY; y++) {
            this.setBlock(j, y, i, CubeType.Air);
          }
          // Find new surface below the removed section and the air gap
          let newTop = gapAt - 1;
          while (newTop > 0 && this.getBlock(j, newTop, i) === CubeType.Air) newTop--;
          this.heightMap[idx] = newTop;
        } else {
          this.heightMap[idx] = topY;
        }
      }
    }

    // --- Pass 3: Ore placement (only in Stone blocks within depth ranges) ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;
        const stoneTop = Math.max(1, this.heightMap[this.size * i + j]! - 3);

        for (let y = 1; y < stoneTop; y++) {
          if (this.getBlock(j, y, i) !== CubeType.Stone) continue;

          for (const [oreType, seedOff, freq, threshold, minY, maxY] of Chunk.ORES) {
            if (y < minY || y > maxY) continue;
            if (perlin3D(this.seed + seedOff, gx, y, gz, freq) > threshold) {
              this.setBlock(j, y, i, oreType);
              break;
            }
          }
        }
      }
    }

    // --- Pass 3.5: Mountain cave wall ore clusters ---
    // Stone blocks adjacent to air (cave surfaces) in mountain biome get extra ore density.
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        if ((biomeMap[this.size * i + j] as Biome) !== Biome.Mountain) continue;
        const gx = topleftx + j;
        const gz = topleftz + i;

        for (let y = 1; y < CHUNK_HEIGHT; y++) {
          if (this.getBlock(j, y, i) !== CubeType.Stone) continue;

          // Only target cave wall blocks — stone that touches at least one air neighbour
          const onCaveWall =
            this.getBlock(j + 1, y, i) === CubeType.Air ||
            this.getBlock(j - 1, y, i) === CubeType.Air ||
            this.getBlock(j, y, i + 1) === CubeType.Air ||
            this.getBlock(j, y, i - 1) === CubeType.Air ||
            this.getBlock(j, y + 1, i) === CubeType.Air ||
            this.getBlock(j, y - 1, i) === CubeType.Air;
          if (!onCaveWall) continue;

          for (const [oreType, seedOff, freq, threshold, minY, maxY] of Chunk.ORES) {
            if (y < minY || y > maxY) continue;
            // Lower threshold = more ore on cave walls
            if (perlin3D(this.seed + seedOff + 700, gx, y, gz, freq) > threshold - 0.15) {
              this.setBlock(j, y, i, oreType);
              break;
            }
          }
        }
      }
    }

    // --- Pass 4: Deep cave lava ---
    // Any air pocket at or below CAVE_LAVA_LEVEL (above bedrock at Y=0) becomes lava,
    // creating natural lava pools at the bottom of caves.
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        for (let y = 1; y <= CAVE_LAVA_LEVEL; y++) {
          if (this.getBlock(j, y, i) === CubeType.Air) {
            this.setBlock(j, y, i, CubeType.Lava);
          }
        }
      }
    }

    // --- Pass 5: Surface fluid fill ---
    // Desert: coat low-lying surface blocks with Lava (follows terrain slope).
    // All other biomes: fill low columns with Water up to SEA_LEVEL.
    // heightMap is updated so renderChunk scans up to the fluid surface.
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const idx = this.size * i + j;
        const terrainY = this.heightMap[idx] as number;
        const biome = biomeMap[idx] as Biome;

        if (biome === Biome.Desert) {
          // Surface-coat low desert terrain with lava — follows the slope naturally.
          // Skip if spillover replaced the surface, or if any adjacent column is a different
          // biome (lava stays interior to the desert, never on biome edges).
          if (terrainY >= DESERT_LAVA_LEVEL) continue;
          if (this.getBlock(j, terrainY, i) !== CubeType.Sand) continue;
          // Require a 5-block interior buffer — lava with physics must not reach biome edges.
          const S = this.size;
          const R = 5;
          let onEdge = false;
          outer: for (let di = -R; di <= R && !onEdge; di++) {
            for (let dj = -R; dj <= R && !onEdge; dj++) {
              if (Math.abs(di) + Math.abs(dj) > R) continue; // diamond/cross shape
              const ni = i + di,
                nj = j + dj;
              if (ni < 0 || ni >= S || nj < 0 || nj >= S) {
                onEdge = true;
                break outer;
              }
              if ((biomeMap[ni * S + nj] as Biome) !== Biome.Desert) {
                onEdge = true;
                break outer;
              }
            }
          }
          if (onEdge) continue;
          // Flood-fill lava up to DESERT_LAVA_LEVEL — flat lake surface, sand stays as floor
          for (let y = terrainY + 1; y <= DESERT_LAVA_LEVEL; y++) {
            this.setBlock(j, y, i, CubeType.Lava);
          }
          this.heightMap[idx] = DESERT_LAVA_LEVEL;
          this.surfaceTypesMap[idx] = CubeType.Lava;
        } else if (biome === Biome.Tundra || biome === Biome.Mountain) {
          // Tundra is dry/frozen; Mountain valleys are rocky, not flooded
        } else {
          if (terrainY >= SEA_LEVEL) continue;
          for (let y = terrainY + 1; y <= SEA_LEVEL; y++) {
            this.setBlock(j, y, i, CubeType.Water);
          }
          this.heightMap[idx] = SEA_LEVEL;
          this.surfaceTypesMap[idx] = CubeType.Water;
        }
      }
    }
  }

  /**
   * Places a fluid block and registers it as active so it will flow on the
   * next tick. Used by both terrain generation (indirectly, via
   * `seedActiveFluids`) and any runtime caller that opens terrain at a
   * cell that should re-flood from a source (e.g. mining). No-op if
   * (x, y, z) is outside the chunk.
   */
  public addFluid(lx: number, ly: number, lz: number, type: CubeType.Water | CubeType.Lava, level = 0): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return;
    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    this.blocks[idx] = type;
    this.fluidLevels[idx] = level;
    this.activeFluids.add(packPos(lx, ly, lz));
    const hmIdx = lz * CHUNK_SIZE + lx;
    if (ly > this.heightMap[hmIdx]!) {
      this.heightMap[hmIdx] = ly;
      this.surfaceTypesMap[hmIdx] = type;
    }
  }

  /**
   * Applies an incoming fluid flow to a single cell. Used both by intra-
   * chunk flow (tickFluids) and by cross-chunk spillover from neighbouring
   * chunks. Returns true if the target cell was modified.
   *
   *   - Target is air: place the fluid and register as active.
   *   - Target is the opposite fluid: both harden into Stone (a very
   *     simple stand-in for Minecraft's cobblestone/obsidian). The cell
   *     becomes solid so fluids can no longer traverse it.
   *   - Target is anything else (solid, same-fluid, bedrock, …): no-op.
   */
  public applyFluidFlow(
    lx: number,
    ly: number,
    lz: number,
    type: CubeType.Water | CubeType.Lava,
    level: number,
  ): boolean {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return false;
    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    const target = this.blocks[idx] as CubeType;
    if (target === CubeType.Air) {
      this.blocks[idx] = type;
      this.fluidLevels[idx] = level;
      this.activeFluids.add(packPos(lx, ly, lz));
      const hmIdx = lz * CHUNK_SIZE + lx;
      if (ly > this.heightMap[hmIdx]!) {
        this.heightMap[hmIdx] = ly;
        this.surfaceTypesMap[hmIdx] = type;
      }
      return true;
    }
    if (target === opposingFluid(type)) {
      this.blocks[idx] = CubeType.Stone;
      this.fluidLevels[idx] = 0;
      const hmIdx = lz * CHUNK_SIZE + lx;
      if (ly >= this.heightMap[hmIdx]!) {
        this.refreshSurfaceCacheForColumn(lx, lz);
      }
      this.activateFluidNeighbours(lx, ly, lz);
      return true;
    }
    return false;
  }

  /**
   * Removes a fluid voxel (turns it into air) and re-activates adjacent
   * fluid cells so they can decide whether to flow into the new gap or
   * decay. Intended for use by the decay pass and by future mining code.
   */
  public removeFluidAt(lx: number, ly: number, lz: number): boolean {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return false;
    const idx = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    const t = this.blocks[idx] as CubeType;
    if (t !== CubeType.Water && t !== CubeType.Lava) return false;
    this.blocks[idx] = CubeType.Air;
    this.fluidLevels[idx] = 0;
    const hmIdx = lz * CHUNK_SIZE + lx;
    if (ly >= this.heightMap[hmIdx]!) {
      this.refreshSurfaceCacheForColumn(lx, lz);
    }
    this.activateFluidNeighbours(lx, ly, lz);
    return true;
  }

  private refreshSurfaceCacheForColumn(lx: number, lz: number): void {
    const hmIdx = lz * CHUNK_SIZE + lx;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const idx = y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
      const t = this.blocks[idx] as CubeType;
      if (t !== CubeType.Air) {
        this.heightMap[hmIdx] = y;
        this.surfaceTypesMap[hmIdx] = t;
        return;
      }
    }
    this.heightMap[hmIdx] = -1;
    this.surfaceTypesMap[hmIdx] = CubeType.Air;
  }
  private activateFluidNeighbours(lx: number, ly: number, lz: number): void {
    const candidates: readonly [number, number, number][] = [
      [lx + 1, ly, lz],
      [lx - 1, ly, lz],
      [lx, ly, lz + 1],
      [lx, ly, lz - 1],
      [lx, ly + 1, lz],
      [lx, ly - 1, lz],
    ];
    for (const [nx, ny, nz] of candidates) {
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const t = this.blocks[ny * CHUNK_SIZE * CHUNK_SIZE + nz * CHUNK_SIZE + nx];
      if (t === CubeType.Water || t === CubeType.Lava) {
        this.activeFluids.add(packPos(nx, ny, nz));
      }
    }
  }

  /**
   * True iff a flowing fluid at (lx, ly, lz) with the given level has at
   * least one "supporter" neighbour feeding it — i.e. a same-fluid cell
   * either directly above (waterfall) or laterally at a lower level
   * (closer to a source). Sources are themselves trivially supported.
   *
   * Cells on the chunk's XZ boundary are treated as supported regardless,
   * since we can't cheaply see into the adjacent chunk from here. This is
   * a conservative over-estimate — a boundary fluid might fail to decay
   * when its cross-chunk supporter was removed — but it never causes
   * spurious decay.
   */
  private isFluidSupported(lx: number, ly: number, lz: number, type: CubeType, level: number): boolean {
    if (level === FLUID_SOURCE_LEVEL) return true;
    const S = this.size;
    if (lx === 0 || lx === S - 1 || lz === 0 || lz === S - 1) return true;
    const stride = CHUNK_SIZE * CHUNK_SIZE;
    const rowStride = CHUNK_SIZE;

    if (ly + 1 < CHUNK_HEIGHT) {
      const aboveIdx = (ly + 1) * stride + lz * rowStride + lx;
      if (this.blocks[aboveIdx] === type) return true; // waterfall column
    }

    for (let o = 0; o < LATERAL_FLOW_OFFSETS.length; o++) {
      const [dx, dz] = LATERAL_FLOW_OFFSETS[o]!;
      const nx = lx + dx;
      const nz = lz + dz;
      if (nx < 0 || nx >= S || nz < 0 || nz >= S) continue;
      const nIdx = ly * stride + nz * rowStride + nx;
      if (this.blocks[nIdx] !== type) continue;
      if (this.fluidLevels[nIdx]! < level) return true;
    }
    return false;
  }

  /**
   * Advances fluid simulation by one tick. Ordered as:
   *
   *   1. Decay pass — any flowing fluid with no supporter evaporates
   *      (becomes air) and re-activates its neighbours so cascading decay
   *      propagates one cell per tick.
   *   2. Flow pass — surviving fluids try to flow straight down, falling
   *      back to lateral spread up to `FLUID_MAX_LEVEL` cells from the
   *      nearest drop or source.
   *
   * Lateral flows that leave the chunk are routed through the optional
   * `spillover` callback, which the queue uses to reach the owning
   * neighbour chunk's `applyFluidFlow`. Vertical flow can't cross a chunk
   * boundary.
   *
   * Mixed-fluid contact (water meeting lava) hardens the target cell
   * into Stone, which matches how Minecraft handles the same collision
   * with cobblestone/obsidian without needing new block types.
   *
   * Returns true iff any block changed.
   */
  public tickFluids(
    spillover?: (wx: number, wy: number, wz: number, type: CubeType.Water | CubeType.Lava, level: number) => void,
  ): boolean {
    if (this.activeFluids.size === 0) return false;
    const S = this.size;
    const stride = CHUNK_SIZE * CHUNK_SIZE;
    const rowStride = CHUNK_SIZE;
    const topleftx = this.x - this.size / 2;
    const topleftz = this.y - this.size / 2;

    const current = this.activeFluids;
    const nextActive: Set<number> = new Set();
    let anyChange = false;

    // --- Pass 1: decay — collect unsupported flows and clear them. We do
    // this before the flow read-phase so supporters that would themselves
    // decay this tick still count as supporters for cells above them. The
    // cascade advances one layer per subsequent tick.
    const decayX: number[] = [];
    const decayY: number[] = [];
    const decayZ: number[] = [];

    // Pending placements applied after the read pass so a freshly-placed
    // fluid can't chain-react within the same tick.
    const changeX: number[] = [];
    const changeY: number[] = [];
    const changeZ: number[] = [];
    const changeType: (CubeType.Water | CubeType.Lava)[] = [];
    const changeLevel: number[] = [];

    for (const pos of current) {
      const x = pos & 0xff;
      const z = (pos >> 8) & 0xff;
      const y = pos >> 16;
      const idx = y * stride + z * rowStride + x;
      const type = this.blocks[idx] as CubeType;
      if (type !== CubeType.Water && type !== CubeType.Lava) continue; // stale entry (removed since last tick)
      const level = this.fluidLevels[idx]!;

      if (level !== FLUID_SOURCE_LEVEL && !this.isFluidSupported(x, y, z, type, level)) {
        decayX.push(x);
        decayY.push(y);
        decayZ.push(z);
        continue; // skip flow on decaying cells
      }

      let flowedDown = false;
      if (y > 0) {
        const belowIdx = (y - 1) * stride + z * rowStride + x;
        if (this.blocks[belowIdx] === CubeType.Air) {
          changeX.push(x);
          changeY.push(y - 1);
          changeZ.push(z);
          changeType.push(type);
          changeLevel.push(1);
          flowedDown = true;
        } else if (this.blocks[belowIdx] === opposingFluid(type)) {
          // Falling onto the opposite fluid hardens it directly; the flow
          // stops as if it had hit solid ground.
          this.blocks[belowIdx] = CubeType.Stone;
          this.fluidLevels[belowIdx] = 0;
          this.activateFluidNeighbours(x, y - 1, z);
          anyChange = true;
        }
      }

      let spreadLaterally = false;
      if (!flowedDown && level < FLUID_MAX_LEVEL) {
        const nextLevel = level + 1;
        for (let o = 0; o < LATERAL_FLOW_OFFSETS.length; o++) {
          const [dx, dz] = LATERAL_FLOW_OFFSETS[o]!;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nx >= S || nz < 0 || nz >= S) {
            if (spillover) {
              spillover(topleftx + nx, y, topleftz + nz, type, nextLevel);
              spreadLaterally = true; // we tried; cross-chunk result is authoritative there
            }
            continue;
          }
          const nIdx = y * stride + nz * rowStride + nx;
          const nType = this.blocks[nIdx];
          if (nType === CubeType.Air) {
            changeX.push(nx);
            changeY.push(y);
            changeZ.push(nz);
            changeType.push(type);
            changeLevel.push(nextLevel);
            spreadLaterally = true;
          } else if (nType === opposingFluid(type)) {
            this.blocks[nIdx] = CubeType.Stone;
            this.fluidLevels[nIdx] = 0;
            this.activateFluidNeighbours(nx, y, nz);
            anyChange = true;
          }
        }
      }

      // Keep anything that might still be interesting next tick:
      //   - sources (can always re-spawn flows if neighbours open up)
      //   - cells that did something this tick
      // Stable flowing cells drop off; they are re-woken by
      // `activateFluidNeighbours` when a neighbouring cell changes.
      if (level === FLUID_SOURCE_LEVEL || flowedDown || spreadLaterally) {
        nextActive.add(pos);
      }
    }

    // Swap in the filtered-for-next-tick active list FIRST so the write-phase
    // helpers (`applyFluidFlow`, `activateFluidNeighbours`) push into the new
    // list rather than the one we just iterated and are about to discard.
    this.activeFluids = nextActive;

    // Apply decay
    for (let n = 0; n < decayX.length; n++) {
      const x = decayX[n]!;
      const y = decayY[n]!;
      const z = decayZ[n]!;
      const idx = y * stride + z * rowStride + x;
      this.blocks[idx] = CubeType.Air;
      this.fluidLevels[idx] = 0;
      this.activateFluidNeighbours(x, y, z);
      anyChange = true;
    }

    // Apply placements (respects air check + water/lava interaction rules)
    for (let n = 0; n < changeX.length; n++) {
      const x = changeX[n]!;
      const y = changeY[n]!;
      const z = changeZ[n]!;
      if (this.applyFluidFlow(x, y, z, changeType[n]!, changeLevel[n]!)) anyChange = true;
    }

    return anyChange;
  }

  // worldGet: optional cross-chunk block lookup for accurate edge culling.
  // Without it, chunk-boundary faces are always treated as exposed (safe but over-renders).
  public renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void {
    // The fluid simulator can push heightMap above the value cached by
    // computeMaxCubes(), which would otherwise overflow the scratch buffers.
    this.computeMaxCubes();

    const topleftx = this.x - this.size / 2;
    const topleftz = this.y - this.size / 2;
    const S = this.size;
    const hm = this.heightMap;

    // Cross-chunk aware air check for edge culling
    const isAir = (nlx: number, nly: number, nlz: number): boolean => {
      if (nly < 0) return false;
      if (nlx >= 0 && nlx < S && nlz >= 0 && nlz < S) {
        return this.getBlock(nlx, nly, nlz) === CubeType.Air;
      }
      if (worldGet) {
        return worldGet(topleftx + nlx, nly, topleftz + nlz) === CubeType.Air;
      }
      return true; // no neighbor data — treat edge as exposed
    };

    const touchesAir = (lx: number, ly: number, lz: number): boolean =>
      isAir(lx + 1, ly, lz) ||
      isAir(lx - 1, ly, lz) ||
      isAir(lx, ly + 1, lz) ||
      isAir(lx, ly - 1, lz) ||
      isAir(lx, ly, lz + 1) ||
      isAir(lx, ly, lz - 1);

    ensureScratchCapacity(this.maxCubes);
    const positions = scratchPositions;
    const colors = scratchColors;
    const ambientOcclusion = scratchAmbientOcclusion;
    let count = 0;

    const isSolid = (nlx: number, nly: number, nlz: number): boolean => !isAir(nlx, nly, nlz);

    const writeCube = (blockType: CubeType, lx: number, y: number, lz: number, wx: number, wz: number): void => {
      const info = CUBE_TYPE_INFO[blockType];
      const c = info.baseColor;

      positions[4 * count] = wx;
      positions[4 * count + 1] = y;
      positions[4 * count + 2] = wz;
      positions[4 * count + 3] = blockType;

      colors[3 * count] = c[0];
      colors[3 * count + 1] = c[1];
      colors[3 * count + 2] = c[2];

      let aoOffset = 24 * count;
      for (const face of FACE_AMBIENT_OCCLUSION_SPECS) {
        const n = face.normal;
        for (const [sideA, sideB] of face.corners) {
          const side1 = isSolid(lx + n[0] + sideA[0], y + n[1] + sideA[1], lz + n[2] + sideA[2]);
          const side2 = isSolid(lx + n[0] + sideB[0], y + n[1] + sideB[1], lz + n[2] + sideB[2]);
          const corner = isSolid(
            lx + n[0] + sideA[0] + sideB[0],
            y + n[1] + sideA[1] + sideB[1],
            lz + n[2] + sideA[2] + sideB[2],
          );
          ambientOcclusion[aoOffset++] = vertexAmbientOcclusion(side1, side2, corner);
        }
      }

      count++;
    };

    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const idx = i * S + j;
        const surfY = hm[idx]!;
        const wx = topleftx + j;
        const wz = topleftz + i;

        for (let y = 0; y <= surfY; y++) {
          const blockType = this.getBlock(j, y, i);
          if (blockType === CubeType.Air || !touchesAir(j, y, i)) continue;
          writeCube(blockType, j, y, i, wx, wz);
        }
      }
    }

    this.cubes = count;
    this.cubePositionsF32 = positions.slice(0, 4 * count);
    this.cubeColorsF32 = colors.slice(0, 3 * count);
    this.cubeAmbientOcclusionU8 = ambientOcclusion.slice(0, 24 * count);
  }

  /** Returns the flat `Float32Array` of cube positions `[x, y, z, 0]` per cube. */
  public cubePositions(): Float32Array {
    return this.cubePositionsF32;
  }

  public cubeColors(): Float32Array {
    return this.cubeColorsF32;
  }

  public cubeAmbientOcclusion(): Uint8Array {
    return this.cubeAmbientOcclusionU8;
  }

  /** Returns a detached copy of the chunk's surface heights for minimap rendering. */
  public surfaceHeights(): Uint8Array {
    return this.heightMap.slice();
  }

  /** Returns a detached copy of the chunk's top-most block types for minimap rendering. */
  public surfaceTypes(): Uint8Array {
    return this.surfaceTypesMap.slice();
  }

  /** Returns the number of cubes to render this frame. */
  public numCubes(): number {
    return this.cubes;
  }
}

function opposingFluid(type: CubeType): CubeType.Water | CubeType.Lava | undefined {
  if (type === CubeType.Water) return CubeType.Lava;
  if (type === CubeType.Lava) return CubeType.Water;
  return undefined;
}
