import { CubeType } from "@/client/engine/render/cube-types";
import { Biome } from "@/game/biome";

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

export const PLACED_OBJECT_TYPES = [
  PlacedObjectType.Grass,
  PlacedObjectType.Shrub,
  PlacedObjectType.Rock,
  PlacedObjectType.Tree,
  PlacedObjectType.EnemySpawn,
] as const;

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
