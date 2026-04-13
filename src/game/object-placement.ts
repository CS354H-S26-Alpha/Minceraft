import { CubeType } from "@/client/engine/render/cube-types";
import { Biome } from "@/game/biome";
import { lerp } from "@/utils/interpolations";
import { hash2D, valueNoise } from "@/utils/noise";

/**
 * Terrain-owned placement metadata for non-cube world objects.
 *
 * This intentionally lives outside the chunk block grid so decorative and
 * gameplay objects can evolve without adding work to the cube render path.
 */
export enum PlacedObjectType {
  Grass = "grass",
  Shrub = "shrub",
  Rock = "rock",
  Tree = "tree",
  EnemySpawn = "enemy_spawn",
}

export enum PlacedObjectCategory {
  Decorative = "decorative",
  Gameplay = "gameplay",
}

export interface PlacedObject {
  type: PlacedObjectType;
  category: PlacedObjectCategory;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  biome: Biome;
  chunkOriginX: number;
  chunkOriginZ: number;
  tags: readonly string[];
}

/**
 * Surface data for a single terrain column. Future placement generation will
 * derive this from the height map so rules stay deterministic and cheap.
 */
export interface ObjectPlacementSample {
  biome: Biome;
  surfaceY: number;
  surfaceBlock: CubeType;
  northY: number;
  southY: number;
  eastY: number;
  westY: number;
  isSubmerged: boolean;
  distanceToChunkEdge: number;
}

/**
 * Spawn parameters for one object family. The next implementation step will
 * feed these into deterministic seeded sampling per chunk.
 */
export interface ObjectPlacementRule {
  type: PlacedObjectType;
  category: PlacedObjectCategory;
  allowedBiomes: readonly Biome[];
  allowedSurfaceBlocks: readonly CubeType[];
  minSurfaceY: number;
  maxSurfaceY: number;
  maxLocalRelief: number;
  minSpacing: number;
  noiseFrequency: number;
  spawnThreshold: number;
  edgePadding: number;
  requiresDrySurface: boolean;
  tags: readonly string[];
}

export interface GeneratePlacedObjectsArgs {
  seed: number;
  chunkOriginX: number;
  chunkOriginZ: number;
  chunkSize: number;
  sampleAt(localX: number, localZ: number): ObjectPlacementSample;
}

export const PLACED_OBJECT_TYPES = [
  PlacedObjectType.Grass,
  PlacedObjectType.Shrub,
  PlacedObjectType.Rock,
  PlacedObjectType.Tree,
  PlacedObjectType.EnemySpawn,
] as const;

const OBJECT_PLACEMENT_GENERATION_ORDER = [
  PlacedObjectType.Tree,
  PlacedObjectType.Rock,
  PlacedObjectType.Shrub,
  PlacedObjectType.Grass,
  PlacedObjectType.EnemySpawn,
] as const;

const OBJECT_PLACEMENT_SEED_OFFSETS = {
  [PlacedObjectType.Grass]: 1_001,
  [PlacedObjectType.Shrub]: 2_003,
  [PlacedObjectType.Rock]: 3_007,
  [PlacedObjectType.Tree]: 4_009,
  [PlacedObjectType.EnemySpawn]: 5_011,
} satisfies Record<PlacedObjectType, number>;

export const OBJECT_PLACEMENT_RULES = {
  [PlacedObjectType.Grass]: {
    type: PlacedObjectType.Grass,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass],
    minSurfaceY: 48,
    maxSurfaceY: 96,
    maxLocalRelief: 2,
    minSpacing: 2,
    noiseFrequency: 1 / 8,
    spawnThreshold: 0.3,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["ground-cover"],
  },
  [PlacedObjectType.Shrub]: {
    type: PlacedObjectType.Shrub,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest, Biome.Desert],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass, CubeType.Sand],
    minSurfaceY: 45,
    maxSurfaceY: 90,
    maxLocalRelief: 2,
    minSpacing: 4,
    noiseFrequency: 1 / 14,
    spawnThreshold: 0.62,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["low-profile"],
  },
  [PlacedObjectType.Rock]: {
    type: PlacedObjectType.Rock,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest, Biome.Desert, Biome.Mountain],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass, CubeType.Sand, CubeType.Stone, CubeType.Snow],
    minSurfaceY: 40,
    maxSurfaceY: 110,
    maxLocalRelief: 3,
    minSpacing: 5,
    noiseFrequency: 1 / 18,
    spawnThreshold: 0.68,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["scatter"],
  },
  [PlacedObjectType.Tree]: {
    type: PlacedObjectType.Tree,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass],
    minSurfaceY: 50,
    maxSurfaceY: 88,
    maxLocalRelief: 1,
    minSpacing: 6,
    noiseFrequency: 1 / 24,
    spawnThreshold: 0.78,
    edgePadding: 2,
    requiresDrySurface: true,
    tags: ["tall", "blocks-visibility"],
  },
  [PlacedObjectType.EnemySpawn]: {
    type: PlacedObjectType.EnemySpawn,
    category: PlacedObjectCategory.Gameplay,
    allowedBiomes: [Biome.Forest, Biome.Desert, Biome.Mountain],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass, CubeType.Sand, CubeType.Stone, CubeType.Snow],
    minSurfaceY: 40,
    maxSurfaceY: 110,
    maxLocalRelief: 1,
    minSpacing: 10,
    noiseFrequency: 1 / 26,
    spawnThreshold: 0.9,
    edgePadding: 2,
    requiresDrySurface: true,
    tags: ["spawn-point"],
  },
} satisfies Record<PlacedObjectType, ObjectPlacementRule>;

export function computeLocalRelief(sample: ObjectPlacementSample): number {
  const center = sample.surfaceY;
  return Math.max(
    Math.abs(sample.northY - center),
    Math.abs(sample.southY - center),
    Math.abs(sample.eastY - center),
    Math.abs(sample.westY - center),
  );
}

export function supportsObjectPlacement(rule: ObjectPlacementRule, sample: ObjectPlacementSample): boolean {
  if (!rule.allowedBiomes.includes(sample.biome)) return false;
  if (!rule.allowedSurfaceBlocks.includes(sample.surfaceBlock)) return false;
  if (sample.surfaceY < rule.minSurfaceY || sample.surfaceY > rule.maxSurfaceY) return false;
  if (rule.requiresDrySurface && sample.isSubmerged) return false;
  if (sample.distanceToChunkEdge < rule.edgePadding) return false;
  return computeLocalRelief(sample) <= rule.maxLocalRelief;
}

function placementNoise(rule: ObjectPlacementRule, seed: number, x: number, z: number): number {
  return valueNoise(seed + OBJECT_PLACEMENT_SEED_OFFSETS[rule.type], x, z, rule.noiseFrequency);
}

function placementJitter(seed: number, type: PlacedObjectType, x: number, z: number): { dx: number; dz: number } {
  const seedBase = seed + OBJECT_PLACEMENT_SEED_OFFSETS[type];
  return {
    dx: lerp(-0.3, 0.3, hash2D(seedBase + 17, x, z)),
    dz: lerp(-0.3, 0.3, hash2D(seedBase + 31, x, z)),
  };
}

function placementRotation(seed: number, type: PlacedObjectType, x: number, z: number): number {
  return hash2D(seed + OBJECT_PLACEMENT_SEED_OFFSETS[type] + 53, x, z) * 2 * Math.PI;
}

function placementScale(seed: number, type: PlacedObjectType, x: number, z: number): number {
  const raw = hash2D(seed + OBJECT_PLACEMENT_SEED_OFFSETS[type] + 79, x, z);
  switch (type) {
    case PlacedObjectType.Tree:
      return lerp(0.95, 1.25, raw);
    case PlacedObjectType.Rock:
      return lerp(0.8, 1.2, raw);
    case PlacedObjectType.EnemySpawn:
      return 1;
    default:
      return lerp(0.85, 1.1, raw);
  }
}

function violatesSpacing(rule: ObjectPlacementRule, objects: readonly PlacedObject[], x: number, z: number): boolean {
  const minSpacingSq = rule.minSpacing * rule.minSpacing;
  return objects.some((object) => {
    if (object.type !== rule.type) return false;
    const dx = object.x - x;
    const dz = object.z - z;
    return dx * dx + dz * dz < minSpacingSq;
  });
}

export function generatePlacedObjectsForChunk(args: GeneratePlacedObjectsArgs): PlacedObject[] {
  const objects: PlacedObject[] = [];
  const occupiedColumns = new Set<string>();

  for (const type of OBJECT_PLACEMENT_GENERATION_ORDER) {
    const rule = OBJECT_PLACEMENT_RULES[type];

    for (let localZ = 0; localZ < args.chunkSize; localZ++) {
      for (let localX = 0; localX < args.chunkSize; localX++) {
        const sample = args.sampleAt(localX, localZ);
        if (!supportsObjectPlacement(rule, sample)) continue;

        const worldX = args.chunkOriginX + localX;
        const worldZ = args.chunkOriginZ + localZ;
        if (placementNoise(rule, args.seed, worldX, worldZ) < rule.spawnThreshold) continue;

        const columnKey = `${localX},${localZ}`;
        if (occupiedColumns.has(columnKey)) continue;

        const jitter = placementJitter(args.seed, type, worldX, worldZ);
        const placedX = worldX + 0.5 + jitter.dx;
        const placedZ = worldZ + 0.5 + jitter.dz;
        if (violatesSpacing(rule, objects, placedX, placedZ)) continue;

        objects.push({
          type,
          category: rule.category,
          x: placedX,
          y: sample.surfaceY + 1,
          z: placedZ,
          rotationY: placementRotation(args.seed, type, worldX, worldZ),
          scale: placementScale(args.seed, type, worldX, worldZ),
          biome: sample.biome,
          chunkOriginX: args.chunkOriginX,
          chunkOriginZ: args.chunkOriginZ,
          tags: rule.tags,
        });
        occupiedColumns.add(columnKey);
      }
    }
  }

  return objects;
}
