/** biome-ignore-all lint/style/noNonNullAssertion: checks are bounded */
import { CUBE_TYPE_INFO, CubeType } from "@/client/engine/render/cube-types";
import { BIOME_INFOS, sampleColumn, surfaceBlock } from "@/game/biome";
import { generatePlacedObjectsForChunk, type PlacedObject, PlacedObjectType } from "@/game/object-placement";
import {
  canPlaceVegetationTemplate,
  pickVegetationTemplate,
  placeVegetationTemplate,
} from "@/game/vegetation-structures";
import { perlin3D } from "@/utils/noise";

export const CHUNK_SIZE = 64;
export const CHUNK_HEIGHT = 128;

export function chunkKey(originX: number, originZ: number): string {
  return `${originX},${originZ}`;
}

export function chunkOrigin(wx: number, wz: number): [number, number] {
  return [
    Math.floor((wx + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
    Math.floor((wz + CHUNK_SIZE / 2) / CHUNK_SIZE) * CHUNK_SIZE,
  ];
}

export class Chunk {
  // types where we store the actual block data
  public blocks: Uint8Array; // 3D block grid (CubeType per voxel): x z y // y*(S*S) + z*S + x
  public heightMap: Uint8Array; // surface height per (i,j) column x z // z*S + x
  public biomeMap: Uint8Array; // biome per (i,j) column x z // z*S + x

  private x: number; // Center of the chunk
  private y: number;
  private size: number; // Number of cubes along each side of the chunk
  private seed: number; // Seed for terrain generation
  private placedObjectsData: PlacedObject[] = [];
  private placedObjectCountsData: Record<PlacedObjectType, number> = {
    [PlacedObjectType.Grass]: 0,
    [PlacedObjectType.Shrub]: 0,
    [PlacedObjectType.Rock]: 0,
    [PlacedObjectType.Tree]: 0,
    [PlacedObjectType.EnemySpawn]: 0,
  };

  // types to update for Rendering
  private cubes: number = 0;
  private cubePositionsF32: Float32Array = new Float32Array(0);
  private cubeColorsF32: Float32Array = new Float32Array(0);

  constructor(centerX: number, centerY: number, size: number, seed: number) {
    this.x = centerX;
    this.y = centerY;
    this.size = size;
    this.seed = seed;

    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT); // with default value 0 = CubeType.Air
    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.biomeMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

    this.generateCubes();
    this.renderChunk(); // render on creation, might not be necessary
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

  private applyVegetationStructures(
    anchors: readonly PlacedObject[],
    chunkOriginX: number,
    chunkOriginZ: number,
  ): PlacedObject[] {
    const renderableObjects: PlacedObject[] = [];
    const counts: Record<PlacedObjectType, number> = {
      [PlacedObjectType.Grass]: 0,
      [PlacedObjectType.Shrub]: 0,
      [PlacedObjectType.Rock]: 0,
      [PlacedObjectType.Tree]: 0,
      [PlacedObjectType.EnemySpawn]: 0,
    };

    for (const anchor of anchors) {
      if (anchor.type !== PlacedObjectType.Tree && anchor.type !== PlacedObjectType.Shrub) {
        renderableObjects.push(anchor);
        counts[anchor.type]++;
        continue;
      }

      const anchorLocalX = Math.floor(anchor.x - chunkOriginX);
      const anchorLocalZ = Math.floor(anchor.z - chunkOriginZ);
      const groundY = Math.floor(anchor.y);
      const template = pickVegetationTemplate(this.seed, anchor.type, Math.floor(anchor.x), Math.floor(anchor.z));

      if (
        !canPlaceVegetationTemplate(
          {
            chunkHeight: CHUNK_HEIGHT,
            chunkSize: CHUNK_SIZE,
            getBlock: (localX, y, localZ) => this.getBlock(localX, y, localZ),
          },
          anchorLocalX,
          groundY,
          anchorLocalZ,
          template,
        )
      ) {
        continue;
      }

      placeVegetationTemplate(
        {
          setBlock: (localX, y, localZ, type) => this.setBlock(localX, y, localZ, type),
        },
        anchorLocalX,
        groundY,
        anchorLocalZ,
        template,
      );
      counts[anchor.type]++;
    }

    this.placedObjectCountsData = counts;
    return renderableObjects;
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

    // --- Pass 1: Base terrain fill ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const globalX = topleftx + j;
        const globalZ = topleftz + i;

        const { biome, height: rawHeight } = sampleColumn(this.seed, globalX, globalZ);
        const height = Math.max(1, Math.min(CHUNK_HEIGHT - 2, rawHeight));

        this.heightMap[this.size * i + j] = height;
        this.biomeMap[this.size * i + j] = biome;

        this.setBlock(j, 0, i, CubeType.Bedrock);
        for (let y = 1; y < height - 3; y++) {
          this.setBlock(j, y, i, CubeType.Stone);
        }
        for (let y = Math.max(1, height - 3); y < height; y++) {
          this.setBlock(j, y, i, BIOME_INFOS[biome].subsurface);
        }
        this.setBlock(j, height, i, surfaceBlock(biome, height));
      }
    }

    // --- Pass 2: Spaghetti cave carving (tunnel-like, follows noise zero-crossings) ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;
        const surfaceY = this.heightMap[this.size * i + j] as number;

        for (let y = 1; y <= surfaceY - 2; y++) {
          if (this.getBlock(j, y, i) === CubeType.Air) continue;

          const threshold = 0.12;

          const n1 = perlin3D(this.seed + 100, gx, y, gz, 1 / 64);
          if (Math.abs(n1) >= threshold) continue;
          const n2 = perlin3D(this.seed + 200, gx, y, gz, 1 / 64);
          if (Math.abs(n2) < threshold) {
            this.setBlock(j, y, i, CubeType.Air);
          }
        }
      }
    }

    // --- Pass 3: Ore placement (only in Stone blocks within depth ranges) ---
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const gx = topleftx + j;
        const gz = topleftz + i;

        for (let y = 1; y < CHUNK_HEIGHT; y++) {
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

    // --- Pass 4: Deterministic non-cube object placement ---
    const placedObjectAnchors = generatePlacedObjectsForChunk({
      seed: this.seed,
      chunkOriginX: topleftx,
      chunkOriginZ: topleftz,
      chunkSize: this.size,
      sampleAt: (localX, localZ) => {
        const idx = localZ * this.size + localX;
        const surfaceY = this.heightMap[idx] as number;
        const center = surfaceY;
        const north = localZ > 0 ? (this.heightMap[(localZ - 1) * this.size + localX] as number) : center;
        const south = localZ + 1 < this.size ? (this.heightMap[(localZ + 1) * this.size + localX] as number) : center;
        const east = localX + 1 < this.size ? (this.heightMap[localZ * this.size + localX + 1] as number) : center;
        const west = localX > 0 ? (this.heightMap[localZ * this.size + localX - 1] as number) : center;
        const northEast =
          localZ > 0 && localX + 1 < this.size
            ? (this.heightMap[(localZ - 1) * this.size + localX + 1] as number)
            : center;
        const northWest =
          localZ > 0 && localX > 0 ? (this.heightMap[(localZ - 1) * this.size + localX - 1] as number) : center;
        const southEast =
          localZ + 1 < this.size && localX + 1 < this.size
            ? (this.heightMap[(localZ + 1) * this.size + localX + 1] as number)
            : center;
        const southWest =
          localZ + 1 < this.size && localX > 0
            ? (this.heightMap[(localZ + 1) * this.size + localX - 1] as number)
            : center;

        return {
          biome: this.biomeMap[idx] as number,
          surfaceY,
          surfaceBlock: this.getBlock(localX, surfaceY, localZ),
          northY: north,
          southY: south,
          eastY: east,
          westY: west,
          northEastY: northEast,
          northWestY: northWest,
          southEastY: southEast,
          southWestY: southWest,
          isSubmerged: false,
          distanceToChunkEdge: Math.min(localX, localZ, this.size - 1 - localX, this.size - 1 - localZ),
        };
      },
    });
    this.placedObjectsData = this.applyVegetationStructures(placedObjectAnchors, topleftx, topleftz);
  }

  // worldGet: optional cross-chunk block lookup for accurate edge culling.
  // Without it, chunk-boundary faces are always treated as exposed (safe but over-renders).
  public renderChunk(worldGet?: (wx: number, wy: number, wz: number) => CubeType): void {
    const topleftx = this.x - this.size / 2;
    const topleftz = this.y - this.size / 2;
    const S = this.size;
    const hm = this.heightMap;
    const blocks = this.blocks;
    const STRIDE_Y = S * S;

    // Cross-chunk aware air check for edge culling
    const isAir = (nlx: number, nly: number, nlz: number): boolean => {
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

    // Pre-compute min neighbor surface height for interior columns.
    // Blocks at y in (0, surfaceY) with y <= minNeighborHeight are fully buried.
    const minNH = new Uint8Array(STRIDE_Y);
    const topYByColumn = new Uint8Array(STRIDE_Y);
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const idx = i * S + j;
        let topY = hm[idx]!;
        for (let y = CHUNK_HEIGHT - 1; y > topY; y--) {
          if (this.getBlock(j, y, i) !== CubeType.Air) {
            topY = y;
            break;
          }
        }
        topYByColumn[idx] = topY;
      }
    }

    for (let i = 1; i < S - 1; i++) {
      for (let j = 1; j < S - 1; j++) {
        const idx = i * S + j;
        minNH[idx] = Math.min(hm[idx - 1]!, hm[idx + 1]!, hm[idx - S]!, hm[idx + S]!);
      }
    }

    // Upper-bound count: exact for interior columns, conservative for edges
    let total = 0;
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const idx = i * S + j;
        const surfY = hm[idx]!;
        const topY = topYByColumn[idx]!;
        if (i === 0 || i === S - 1 || j === 0 || j === S - 1) {
          total += topY + 1;
        } else {
          const start = Math.max(1, Math.min(minNH[idx]! + 1, surfY));
          total += 1 + (topY - start + 1);
        }
      }
    }

    const positions = new Float32Array(4 * total);
    const colors = new Float32Array(3 * total);
    let count = 0;

    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const idx = i * S + j;
        const surfY = hm[idx]!;
        const topY = topYByColumn[idx]!;
        const wx = topleftx + j;
        const wz = topleftz + i;

        if (i === 0 || i === S - 1 || j === 0 || j === S - 1) {
          // Edge column: use touchesAir with cross-chunk awareness
          for (let y = 0; y <= topY; y++) {
            const blockType = this.getBlock(j, y, i);
            if (blockType === CubeType.Air || !touchesAir(j, y, i)) continue;
            const c = CUBE_TYPE_INFO[blockType].baseColor;
            positions[4 * count] = wx;
            positions[4 * count + 1] = y;
            positions[4 * count + 2] = wz;
            positions[4 * count + 3] = 0;
            colors[3 * count] = c[0];
            colors[3 * count + 1] = c[1];
            colors[3 * count + 2] = c[2];
            count++;
          }
        } else {
          // Interior column: heightMap-based culling
          const bt0 = blocks[idx]! as CubeType;
          const c0 = CUBE_TYPE_INFO[bt0].baseColor;
          positions[4 * count] = wx;
          positions[4 * count + 1] = 0;
          positions[4 * count + 2] = wz;
          positions[4 * count + 3] = 0;
          colors[3 * count] = c0[0];
          colors[3 * count + 1] = c0[1];
          colors[3 * count + 2] = c0[2];
          count++;

          const start = Math.max(1, Math.min(minNH[idx]! + 1, surfY));
          for (let y = start; y <= topY; y++) {
            const bt = blocks[y * STRIDE_Y + idx]! as CubeType;
            if (bt === CubeType.Air) continue;
            if (y > surfY && !touchesAir(j, y, i)) continue;
            const c = CUBE_TYPE_INFO[bt].baseColor;
            positions[4 * count] = wx;
            positions[4 * count + 1] = y;
            positions[4 * count + 2] = wz;
            positions[4 * count + 3] = 0;
            colors[3 * count] = c[0];
            colors[3 * count + 1] = c[1];
            colors[3 * count + 2] = c[2];
            count++;
          }
        }
      }
    }

    this.cubes = count;
    // Edge culling may reduce count below total; subarray trims to exact size
    this.cubePositionsF32 = positions.subarray(0, 4 * count);
    this.cubeColorsF32 = colors.subarray(0, 3 * count);
  }

  /** Returns the flat `Float32Array` of cube positions `[x, y, z, 0]` per cube. */
  public cubePositions(): Float32Array {
    return this.cubePositionsF32;
  }

  public cubeColors(): Float32Array {
    return this.cubeColorsF32;
  }

  public placedObjects(): readonly PlacedObject[] {
    return this.placedObjectsData;
  }

  public placedObjectCounts(): Readonly<Record<PlacedObjectType, number>> {
    return this.placedObjectCountsData;
  }

  /** Returns the number of cubes to render this frame. */
  public numCubes(): number {
    return this.cubes;
  }
}
