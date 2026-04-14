import bedrockTextureUrl from "@/assets/textures/bedrock.png";
import coalTextureUrl from "@/assets/textures/coal.png";
import diamondTextureUrl from "@/assets/textures/diamond.png";
import dirtBottomTextureUrl from "@/assets/textures/dirt_bottom.png";
import dirtSideTextureUrl from "@/assets/textures/dirt_side.png";
import dirtTopTextureUrl from "@/assets/textures/dirt_top.png";
import goldTextureUrl from "@/assets/textures/gold.png";
import ironTextureUrl from "@/assets/textures/iron.png";
import sandTextureUrl from "@/assets/textures/sand.png";
import snowTextureUrl from "@/assets/textures/snow_top.png";
import stoneTextureUrl from "@/assets/textures/stone.png";

export enum CubeType {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Snow = 5,
  Bedrock = 6,
  ForestGrass = 7,
  CoalOre = 8,
  IronOre = 9,
  GoldOre = 10,
  DiamondOre = 11,
}

export const CUBE_FACE_ORDER = ["top", "left", "right", "front", "back", "bottom"] as const;

export type CubeFaceName = (typeof CUBE_FACE_ORDER)[number];

export interface CubeFaceTextures extends Record<CubeFaceName, string | null> {}

export interface CubeFaceTileIndices extends Record<CubeFaceName, number> {}

export interface CubeTypeInfo {
  baseColor: [number, number, number];
  faceTextures: CubeFaceTextures;
}

function cubeFaceTextures(overrides: Partial<CubeFaceTextures> = {}): CubeFaceTextures {
  return {
    top: null,
    left: null,
    right: null,
    front: null,
    back: null,
    bottom: null,
    ...overrides,
  };
}

function emptyCubeFaceTiles(): CubeFaceTileIndices {
  return {
    top: -1,
    left: -1,
    right: -1,
    front: -1,
    back: -1,
    bottom: -1,
  };
}

export const CUBE_TYPE_INFO: Record<CubeType, CubeTypeInfo> = {
  [CubeType.Air]: {
    baseColor: [0.0, 0.0, 0.0],
    faceTextures: cubeFaceTextures(),
  },
  [CubeType.Grass]: {
    baseColor: [0.29, 0.6, 0.13],
    faceTextures: cubeFaceTextures({
      top: dirtTopTextureUrl,
      left: dirtSideTextureUrl,
      right: dirtSideTextureUrl,
      front: dirtSideTextureUrl,
      back: dirtSideTextureUrl,
      bottom: dirtBottomTextureUrl,
    }),
  },
  [CubeType.Dirt]: {
    baseColor: [0.55, 0.36, 0.18],
    faceTextures: cubeFaceTextures({
      top: dirtBottomTextureUrl,
      left: dirtBottomTextureUrl,
      right: dirtBottomTextureUrl,
      front: dirtBottomTextureUrl,
      back: dirtBottomTextureUrl,
      bottom: dirtBottomTextureUrl,
    }),
  },
  [CubeType.Stone]: {
    baseColor: [0.5, 0.5, 0.5],
    faceTextures: cubeFaceTextures({
      top: stoneTextureUrl,
      left: stoneTextureUrl,
      right: stoneTextureUrl,
      front: stoneTextureUrl,
      back: stoneTextureUrl,
      bottom: stoneTextureUrl,
    }),
  },
  [CubeType.Sand]: {
    baseColor: [0.93, 0.86, 0.51],
    faceTextures: cubeFaceTextures({
      top: sandTextureUrl,
      left: sandTextureUrl,
      right: sandTextureUrl,
      front: sandTextureUrl,
      back: sandTextureUrl,
      bottom: sandTextureUrl,
    }),
  },
  [CubeType.Snow]: {
    baseColor: [0.95, 0.97, 1.0],
    faceTextures: cubeFaceTextures({
      top: snowTextureUrl,
      left: snowTextureUrl,
      right: snowTextureUrl,
      front: snowTextureUrl,
      back: snowTextureUrl,
      bottom: snowTextureUrl,
    }),
  },
  [CubeType.Bedrock]: {
    baseColor: [0.0, 0.0, 0.0],
    faceTextures: cubeFaceTextures({
      top: bedrockTextureUrl,
      left: bedrockTextureUrl,
      right: bedrockTextureUrl,
      front: bedrockTextureUrl,
      back: bedrockTextureUrl,
      bottom: bedrockTextureUrl,
    }),
  },
  [CubeType.ForestGrass]: {
    baseColor: [0.13, 0.42, 0.05],
    faceTextures: cubeFaceTextures({
      top: dirtTopTextureUrl,
      left: dirtSideTextureUrl,
      right: dirtSideTextureUrl,
      front: dirtSideTextureUrl,
      back: dirtSideTextureUrl,
      bottom: dirtBottomTextureUrl,
    }),
  },
  [CubeType.CoalOre]: {
    baseColor: [0.2, 0.2, 0.2],
    faceTextures: cubeFaceTextures({
      top: coalTextureUrl,
      left: coalTextureUrl,
      right: coalTextureUrl,
      front: coalTextureUrl,
      back: coalTextureUrl,
      bottom: coalTextureUrl,
    }),
  },
  [CubeType.IronOre]: {
    baseColor: [0.6, 0.5, 0.45],
    faceTextures: cubeFaceTextures({
      top: ironTextureUrl,
      left: ironTextureUrl,
      right: ironTextureUrl,
      front: ironTextureUrl,
      back: ironTextureUrl,
      bottom: ironTextureUrl,
    }),
  },
  [CubeType.GoldOre]: {
    baseColor: [0.85, 0.75, 0.2],
    faceTextures: cubeFaceTextures({
      top: goldTextureUrl,
      left: goldTextureUrl,
      right: goldTextureUrl,
      front: goldTextureUrl,
      back: goldTextureUrl,
      bottom: goldTextureUrl,
    }),
  },
  [CubeType.DiamondOre]: {
    baseColor: [0.3, 0.85, 0.85],
    faceTextures: cubeFaceTextures({
      top: diamondTextureUrl,
      left: diamondTextureUrl,
      right: diamondTextureUrl,
      front: diamondTextureUrl,
      back: diamondTextureUrl,
      bottom: diamondTextureUrl,
    }),
  },
};

const blockAtlasTextureUrls: string[] = [];
const textureTileIndexByUrl = new Map<string, number>();
const cubeTypeFaceTiles = {} as Record<CubeType, CubeFaceTileIndices>;

for (const [cubeTypeKey, info] of Object.entries(CUBE_TYPE_INFO)) {
  const faceTiles = emptyCubeFaceTiles();
  for (const face of CUBE_FACE_ORDER) {
    const textureUrl = info.faceTextures[face];
    if (!textureUrl) continue;

    let tileIndex = textureTileIndexByUrl.get(textureUrl);
    if (tileIndex === undefined) {
      tileIndex = blockAtlasTextureUrls.length;
      blockAtlasTextureUrls.push(textureUrl);
      textureTileIndexByUrl.set(textureUrl, tileIndex);
    }

    faceTiles[face] = tileIndex;
  }

  cubeTypeFaceTiles[Number(cubeTypeKey) as CubeType] = faceTiles;
}

export const BLOCK_ATLAS_TEXTURE_URLS = blockAtlasTextureUrls;
export const CUBE_TYPE_FACE_TILES = cubeTypeFaceTiles;
