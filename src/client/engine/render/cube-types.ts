export enum CubeType {
  White = 0,
  Black = 1,
  Grass = 2,
}

export interface CubeTypeInfo {
  baseColor: [number, number, number];
  // add more if needed // texture file perhaps
}

export const CUBE_TYPE_INFO: Record<CubeType, CubeTypeInfo> = {
  [CubeType.White]: { baseColor: [1.0, 1.0, 1.0] },
  [CubeType.Black]: { baseColor: [0.0, 0.0, 0.0] },
  [CubeType.Grass]: { baseColor: [0.0, 0.54, 0.0] },
};
