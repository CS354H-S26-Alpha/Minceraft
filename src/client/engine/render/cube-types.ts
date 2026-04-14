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

export interface CubeTypeInfo {
  baseColor: [number, number, number];
}

export const CUBE_TYPE_INFO: Record<CubeType, CubeTypeInfo> = {
  [CubeType.Air]: {
    baseColor: [0.0, 0.0, 0.0],
  },
  [CubeType.Grass]: {
    baseColor: [0.29, 0.6, 0.13],
  },
  [CubeType.Dirt]: {
    baseColor: [0.55, 0.36, 0.18],
  },
  [CubeType.Stone]: {
    baseColor: [0.5, 0.5, 0.5],
  },
  [CubeType.Sand]: {
    baseColor: [0.93, 0.86, 0.51],
  },
  [CubeType.Snow]: {
    baseColor: [0.95, 0.97, 1.0],
  },
  [CubeType.Bedrock]: {
    baseColor: [0.0, 0.0, 0.0],
  },
  [CubeType.ForestGrass]: {
    baseColor: [0.13, 0.42, 0.05],
  },
  [CubeType.CoalOre]: {
    baseColor: [0.2, 0.2, 0.2],
  },
  [CubeType.IronOre]: {
    baseColor: [0.6, 0.5, 0.45],
  },
  [CubeType.GoldOre]: {
    baseColor: [0.85, 0.75, 0.2],
  },
  [CubeType.DiamondOre]: {
    baseColor: [0.3, 0.85, 0.85],
  },
};
