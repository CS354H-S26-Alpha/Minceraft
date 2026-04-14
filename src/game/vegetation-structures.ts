import { CubeType } from "@/client/engine/render/cube-types";
import { PlacedObjectType } from "@/game/object-placement";
import { hash2D } from "@/utils/noise";

export interface VegetationStructureBlock {
  dx: number;
  dy: number;
  dz: number;
  cubeType: CubeType;
}

export interface VegetationStructureTemplate {
  id: string;
  blocks: readonly VegetationStructureBlock[];
}

interface StructureAccess {
  chunkHeight: number;
  chunkSize: number;
  getBlock(localX: number, y: number, localZ: number): CubeType;
  setBlock(localX: number, y: number, localZ: number, type: CubeType): void;
}

const TREE_TEMPLATES: readonly VegetationStructureTemplate[] = [
  {
    id: "oak-round",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 4, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 3, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 3, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 3, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 3, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 4, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 4, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 4, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 4, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 5, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 5, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 6, dz: 0, cubeType: CubeType.OakLeaf },
    ],
  },
  {
    id: "oak-tall",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 4, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 5, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 6, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 5, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 5, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 5, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 5, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 5, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 5, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 6, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 6, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 6, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 6, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 7, dz: 0, cubeType: CubeType.OakLeaf },
    ],
  },
  {
    id: "oak-wide",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.OakLog },
      { dx: 0, dy: 4, dz: 0, cubeType: CubeType.OakLog },
      { dx: -1, dy: 3, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 3, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 3, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 3, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 4, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 4, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 4, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 4, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: -2, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 2, dy: 4, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: -2, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 4, dz: 2, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: -1, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 1, dy: 5, dz: 0, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 5, dz: -1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 5, dz: 1, cubeType: CubeType.OakLeaf },
      { dx: 0, dy: 6, dz: 0, cubeType: CubeType.OakLeaf },
    ],
  },
] as const;

const SHRUB_TEMPLATES: readonly VegetationStructureTemplate[] = [
  {
    id: "shrub-round",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.ShrubStem },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: -1, dy: 2, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 1, dy: 2, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 2, dz: -1, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 2, dz: 1, cubeType: CubeType.ShrubLeaf },
      { dx: -1, dy: 1, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 1, dy: 1, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 1, dz: -1, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 1, dz: 1, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.ShrubLeaf },
    ],
  },
  {
    id: "shrub-wide",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.ShrubStem },
      { dx: -1, dy: 1, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 1, dy: 1, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 1, dz: -1, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 1, dz: 1, cubeType: CubeType.ShrubLeaf },
      { dx: -1, dy: 1, dz: -1, cubeType: CubeType.ShrubLeaf },
      { dx: 1, dy: 1, dz: -1, cubeType: CubeType.ShrubLeaf },
      { dx: -1, dy: 1, dz: 1, cubeType: CubeType.ShrubLeaf },
      { dx: 1, dy: 1, dz: 1, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: -1, dy: 2, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 1, dy: 2, dz: 0, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 2, dz: -1, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 2, dz: 1, cubeType: CubeType.ShrubLeaf },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.ShrubLeaf },
    ],
  },
] as const;

const CACTUS_TEMPLATES: readonly VegetationStructureTemplate[] = [
  {
    id: "cactus-short",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.Cactus },
      { dx: 1, dy: 2, dz: 0, cubeType: CubeType.Cactus },
      { dx: 1, dy: 3, dz: 0, cubeType: CubeType.Cactus },
    ],
  },
  {
    id: "cactus-medium",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 4, dz: 0, cubeType: CubeType.Cactus },
      { dx: -1, dy: 2, dz: 0, cubeType: CubeType.Cactus },
      { dx: -1, dy: 3, dz: 0, cubeType: CubeType.Cactus },
    ],
  },
  {
    id: "cactus-tall",
    blocks: [
      { dx: 0, dy: 1, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 2, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 3, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 4, dz: 0, cubeType: CubeType.Cactus },
      { dx: 0, dy: 5, dz: 0, cubeType: CubeType.Cactus },
      { dx: -1, dy: 3, dz: 0, cubeType: CubeType.Cactus },
      { dx: -1, dy: 4, dz: 0, cubeType: CubeType.Cactus },
      { dx: 1, dy: 2, dz: 0, cubeType: CubeType.Cactus },
      { dx: 1, dy: 3, dz: 0, cubeType: CubeType.Cactus },
    ],
  },
] as const;

export function vegetationTemplatesFor(type: PlacedObjectType.Tree | PlacedObjectType.Shrub | PlacedObjectType.Cactus) {
  if (type === PlacedObjectType.Tree) return TREE_TEMPLATES;
  if (type === PlacedObjectType.Cactus) return CACTUS_TEMPLATES;
  return SHRUB_TEMPLATES;
}

export function pickVegetationTemplate(
  seed: number,
  type: PlacedObjectType.Tree | PlacedObjectType.Shrub | PlacedObjectType.Cactus,
  worldX: number,
  worldZ: number,
): VegetationStructureTemplate {
  const templates = vegetationTemplatesFor(type);
  const offset = type === PlacedObjectType.Tree ? 91_117 : type === PlacedObjectType.Cactus ? 88_907 : 73_301;
  const index = Math.floor(hash2D(seed + offset, worldX, worldZ) * templates.length) % templates.length;
  const selected = templates[index] ?? templates[0];
  if (!selected) {
    throw new Error(`No vegetation templates configured for ${type}`);
  }
  return selected;
}

export function canPlaceVegetationTemplate(
  access: Pick<StructureAccess, "chunkHeight" | "chunkSize" | "getBlock">,
  anchorLocalX: number,
  groundY: number,
  anchorLocalZ: number,
  template: VegetationStructureTemplate,
): boolean {
  const occupied = new Set(
    template.blocks.map((block) => `${anchorLocalX + block.dx},${groundY + block.dy},${anchorLocalZ + block.dz}`),
  );

  for (const block of template.blocks) {
    const localX = anchorLocalX + block.dx;
    const localZ = anchorLocalZ + block.dz;
    const y = groundY + block.dy;
    if (localX < 0 || localX >= access.chunkSize || localZ < 0 || localZ >= access.chunkSize) return false;
    if (y <= 0 || y >= access.chunkHeight) return false;
    if (access.getBlock(localX, y, localZ) !== CubeType.Air) return false;
    if (block.cubeType === CubeType.Cactus) {
      const neighbors = [
        [localX + 1, y, localZ],
        [localX - 1, y, localZ],
        [localX, y, localZ + 1],
        [localX, y, localZ - 1],
      ] as const;
      for (const [nx, ny, nz] of neighbors) {
        const key = `${nx},${ny},${nz}`;
        if (occupied.has(key)) continue;
        if (access.getBlock(nx, ny, nz) !== CubeType.Air) return false;
      }
    }
  }

  return true;
}

export function placeVegetationTemplate(
  access: Pick<StructureAccess, "setBlock">,
  anchorLocalX: number,
  groundY: number,
  anchorLocalZ: number,
  template: VegetationStructureTemplate,
): void {
  for (const block of template.blocks) {
    access.setBlock(anchorLocalX + block.dx, groundY + block.dy, anchorLocalZ + block.dz, block.cubeType);
  }
}
