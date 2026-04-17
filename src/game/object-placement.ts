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
  TallGrass = "tall_grass",
  FlowerDandelion = "flower_dandelion",
  FlowerPoppy = "flower_poppy",
  Shrub = "shrub",
  Rock = "rock",
  Tree = "tree",
  DeadBush = "dead_bush",
  Cactus = "cactus",
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
  renderTypeIndex: number;
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
  northEastY: number;
  northWestY: number;
  southEastY: number;
  southWestY: number;
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
  PlacedObjectType.TallGrass,
  PlacedObjectType.FlowerDandelion,
  PlacedObjectType.FlowerPoppy,
  PlacedObjectType.Shrub,
  PlacedObjectType.Rock,
  PlacedObjectType.Tree,
  PlacedObjectType.DeadBush,
  PlacedObjectType.Cactus,
  PlacedObjectType.EnemySpawn,
] as const;

export const RENDERABLE_PLACED_OBJECT_TYPES = [
  PlacedObjectType.Grass,
  PlacedObjectType.TallGrass,
  PlacedObjectType.FlowerDandelion,
  PlacedObjectType.FlowerPoppy,
  PlacedObjectType.Rock,
  PlacedObjectType.DeadBush,
  PlacedObjectType.EnemySpawn,
] as const;

export function emptyPlacedObjectCounts(): Record<PlacedObjectType, number> {
  return {
    [PlacedObjectType.Grass]: 0,
    [PlacedObjectType.TallGrass]: 0,
    [PlacedObjectType.FlowerDandelion]: 0,
    [PlacedObjectType.FlowerPoppy]: 0,
    [PlacedObjectType.Shrub]: 0,
    [PlacedObjectType.Rock]: 0,
    [PlacedObjectType.Tree]: 0,
    [PlacedObjectType.DeadBush]: 0,
    [PlacedObjectType.Cactus]: 0,
    [PlacedObjectType.EnemySpawn]: 0,
  };
}

export function placedObjectTypeIndex(type: PlacedObjectType): number {
  return PLACED_OBJECT_TYPES.indexOf(type);
}

const OBJECT_PLACEMENT_GENERATION_ORDER = [
  PlacedObjectType.Tree,
  PlacedObjectType.Rock,
  PlacedObjectType.Shrub,
  PlacedObjectType.Cactus,
  PlacedObjectType.DeadBush,
  PlacedObjectType.FlowerDandelion,
  PlacedObjectType.FlowerPoppy,
  PlacedObjectType.TallGrass,
  PlacedObjectType.Grass,
  PlacedObjectType.EnemySpawn,
] as const;

const OBJECT_PLACEMENT_SEED_OFFSETS = {
  [PlacedObjectType.Grass]: 1_001,
  [PlacedObjectType.TallGrass]: 1_409,
  [PlacedObjectType.FlowerDandelion]: 1_613,
  [PlacedObjectType.FlowerPoppy]: 1_811,
  [PlacedObjectType.Shrub]: 2_003,
  [PlacedObjectType.Rock]: 3_007,
  [PlacedObjectType.Tree]: 4_009,
  [PlacedObjectType.DeadBush]: 4_463,
  [PlacedObjectType.Cactus]: 4_781,
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
    minSpacing: 3,
    noiseFrequency: 1 / 8,
    spawnThreshold: 0.7,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["ground-cover"],
  },
  [PlacedObjectType.TallGrass]: {
    type: PlacedObjectType.TallGrass,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass],
    minSurfaceY: 48,
    maxSurfaceY: 96,
    maxLocalRelief: 1,
    minSpacing: 2,
    noiseFrequency: 1 / 10,
    spawnThreshold: 0.79,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["ground-cover", "tall"],
  },
  [PlacedObjectType.FlowerDandelion]: {
    type: PlacedObjectType.FlowerDandelion,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass],
    minSurfaceY: 48,
    maxSurfaceY: 94,
    maxLocalRelief: 1,
    minSpacing: 3,
    noiseFrequency: 1 / 13,
    spawnThreshold: 0.875,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["flower", "yellow"],
  },
  [PlacedObjectType.FlowerPoppy]: {
    type: PlacedObjectType.FlowerPoppy,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass],
    minSurfaceY: 48,
    maxSurfaceY: 94,
    maxLocalRelief: 1,
    minSpacing: 3,
    noiseFrequency: 1 / 15,
    spawnThreshold: 0.89,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["flower", "red"],
  },
  [PlacedObjectType.Shrub]: {
    type: PlacedObjectType.Shrub,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Forest, Biome.Desert],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass, CubeType.Sand],
    minSurfaceY: 45,
    maxSurfaceY: 90,
    maxLocalRelief: 0,
    minSpacing: 5,
    noiseFrequency: 1 / 14,
    spawnThreshold: 0.73,
    edgePadding: 2,
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
    maxLocalRelief: 1,
    minSpacing: 6,
    noiseFrequency: 1 / 18,
    spawnThreshold: 0.8,
    edgePadding: 3,
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
    maxLocalRelief: 0,
    minSpacing: 6,
    noiseFrequency: 1 / 24,
    spawnThreshold: 0.8,
    edgePadding: 2,
    requiresDrySurface: true,
    tags: ["tall", "blocks-visibility"],
  },
  [PlacedObjectType.DeadBush]: {
    type: PlacedObjectType.DeadBush,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Desert, Biome.Mountain],
    allowedSurfaceBlocks: [CubeType.Sand, CubeType.Stone],
    minSurfaceY: 42,
    maxSurfaceY: 104,
    maxLocalRelief: 1,
    minSpacing: 4,
    noiseFrequency: 1 / 14,
    spawnThreshold: 0.87,
    edgePadding: 2,
    requiresDrySurface: true,
    tags: ["desert", "dry"],
  },
  [PlacedObjectType.Cactus]: {
    type: PlacedObjectType.Cactus,
    category: PlacedObjectCategory.Decorative,
    allowedBiomes: [Biome.Desert],
    allowedSurfaceBlocks: [CubeType.Sand],
    minSurfaceY: 42,
    maxSurfaceY: 100,
    maxLocalRelief: 0,
    minSpacing: 5,
    noiseFrequency: 1 / 18,
    spawnThreshold: 0.84,
    edgePadding: 1,
    requiresDrySurface: true,
    tags: ["desert", "block-structure"],
  },
  [PlacedObjectType.EnemySpawn]: {
    type: PlacedObjectType.EnemySpawn,
    category: PlacedObjectCategory.Gameplay,
    allowedBiomes: [Biome.Forest, Biome.Desert, Biome.Mountain],
    allowedSurfaceBlocks: [CubeType.ForestGrass, CubeType.Grass, CubeType.Sand, CubeType.Stone, CubeType.Snow],
    minSurfaceY: 40,
    maxSurfaceY: 110,
    maxLocalRelief: 0,
    minSpacing: 12,
    noiseFrequency: 1 / 26,
    spawnThreshold: 0.93,
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
    Math.abs(sample.northEastY - center),
    Math.abs(sample.northWestY - center),
    Math.abs(sample.southEastY - center),
    Math.abs(sample.southWestY - center),
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
  const noise = valueNoise(seed + OBJECT_PLACEMENT_SEED_OFFSETS[rule.type], x, z, rule.noiseFrequency);
  if (rule.type === PlacedObjectType.Tree || rule.type === PlacedObjectType.Shrub) {
    const distanceSq = x * x + z * z;
    if (distanceSq <= 192 * 192) {
      return Math.min(1, noise + 0.08);
    }
  }
  if (rule.type === PlacedObjectType.DeadBush) {
    const clusterNoise = valueNoise(seed + 8_311, x, z, 1 / 26);
    const duneNoise = valueNoise(seed + 8_533, x, z, 1 / 42);
    return Math.min(1, noise * 0.65 + clusterNoise * 0.25 + duneNoise * 0.18);
  }
  if (rule.type === PlacedObjectType.Cactus) {
    const clusterNoise = valueNoise(seed + 9_103, x, z, 1 / 36);
    const distanceSq = x * x + z * z;
    const originBoost = distanceSq <= 256 * 256 ? 0.12 : 0.0;
    return Math.min(1, noise * 0.72 + clusterNoise * 0.24 + originBoost);
  }
  return noise;
}

function placementJitterRange(type: PlacedObjectType): number {
  switch (type) {
    case PlacedObjectType.Rock:
    case PlacedObjectType.Shrub:
    case PlacedObjectType.Tree:
    case PlacedObjectType.Cactus:
    case PlacedObjectType.DeadBush:
    case PlacedObjectType.EnemySpawn:
      return 0.0;
    default:
      return 0.12;
  }
}

function placementJitter(seed: number, type: PlacedObjectType, x: number, z: number): { dx: number; dz: number } {
  const seedBase = seed + OBJECT_PLACEMENT_SEED_OFFSETS[type];
  const range = placementJitterRange(type);
  return {
    dx: lerp(-range, range, hash2D(seedBase + 17, x, z)),
    dz: lerp(-range, range, hash2D(seedBase + 31, x, z)),
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
    case PlacedObjectType.TallGrass:
      return lerp(0.95, 1.2, raw);
    case PlacedObjectType.FlowerDandelion:
    case PlacedObjectType.FlowerPoppy:
      return lerp(0.9, 1.08, raw);
    case PlacedObjectType.DeadBush:
      return lerp(0.85, 1.05, raw);
    case PlacedObjectType.EnemySpawn:
      return 1;
    default:
      return lerp(0.85, 1.1, raw);
  }
}

function placementBaseHeight(type: PlacedObjectType): number {
  switch (type) {
    case PlacedObjectType.Rock:
      return 1.02;
    case PlacedObjectType.FlowerDandelion:
    case PlacedObjectType.FlowerPoppy:
      return 0.52;
    default:
      return 0.5;
  }
}

function placementFootprintRadius(type: PlacedObjectType, scale: number): number {
  switch (type) {
    case PlacedObjectType.Rock:
      return 0.68 * scale;
    case PlacedObjectType.Shrub:
      return 0.5 * scale;
    case PlacedObjectType.Tree:
      return 0.22 * scale;
    case PlacedObjectType.DeadBush:
      return 0.18 * scale;
    case PlacedObjectType.EnemySpawn:
      return 0.22 * scale;
    default:
      return 0.06 * scale;
  }
}

export function supportsPlacedFootprint(
  args: GeneratePlacedObjectsArgs,
  type: PlacedObjectType,
  placedX: number,
  placedZ: number,
  baseSurfaceY: number,
  scale: number,
): boolean {
  const radius = placementFootprintRadius(type, scale);
  const minLocalX = Math.floor(placedX - radius - args.chunkOriginX);
  const maxLocalX = Math.floor(placedX + radius - args.chunkOriginX);
  const minLocalZ = Math.floor(placedZ - radius - args.chunkOriginZ);
  const maxLocalZ = Math.floor(placedZ + radius - args.chunkOriginZ);

  if (minLocalX < 0 || minLocalZ < 0 || maxLocalX >= args.chunkSize || maxLocalZ >= args.chunkSize) return false;

  for (let localZ = minLocalZ; localZ <= maxLocalZ; localZ++) {
    for (let localX = minLocalX; localX <= maxLocalX; localX++) {
      const supportSample = args.sampleAt(localX, localZ);
      if (supportSample.surfaceY !== baseSurfaceY) return false;
      if (supportSample.isSubmerged) return false;
    }
  }

  return true;
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
        const scale = placementScale(args.seed, type, worldX, worldZ);
        if (!supportsPlacedFootprint(args, type, placedX, placedZ, sample.surfaceY, scale)) continue;

        objects.push({
          type,
          category: rule.category,
          x: placedX,
          y: sample.surfaceY + placementBaseHeight(type),
          z: placedZ,
          rotationY: placementRotation(args.seed, type, worldX, worldZ),
          scale,
          biome: sample.biome,
          chunkOriginX: args.chunkOriginX,
          chunkOriginZ: args.chunkOriginZ,
          renderTypeIndex: placedObjectTypeIndex(type),
          tags: rule.tags,
        });
        occupiedColumns.add(columnKey);
      }
    }
  }

  return objects;
}
