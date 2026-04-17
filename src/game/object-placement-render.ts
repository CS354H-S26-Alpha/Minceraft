import { type PlacedObject, PlacedObjectType } from "@/game/object-placement";

const RENDER_RADIUS_BY_TYPE: Record<PlacedObjectType, number> = {
  [PlacedObjectType.Grass]: 40,
  [PlacedObjectType.TallGrass]: 44,
  [PlacedObjectType.FlowerDandelion]: 34,
  [PlacedObjectType.FlowerPoppy]: 34,
  [PlacedObjectType.Shrub]: 56,
  [PlacedObjectType.Rock]: 72,
  [PlacedObjectType.Tree]: 96,
  [PlacedObjectType.DeadBush]: 42,
  [PlacedObjectType.Cactus]: 64,
  [PlacedObjectType.EnemySpawn]: 88,
};

function farDistanceStride(object: PlacedObject, distanceSq: number): number {
  switch (object.type) {
    case PlacedObjectType.Grass:
    case PlacedObjectType.TallGrass:
      if (distanceSq > 34 * 34) return 5;
      if (distanceSq > 26 * 26) return 3;
      return 1;
    case PlacedObjectType.FlowerDandelion:
    case PlacedObjectType.FlowerPoppy:
      if (distanceSq > 24 * 24) return 4;
      return 1;
    case PlacedObjectType.Shrub:
      if (distanceSq > 44 * 44) return 3;
      return 1;
    case PlacedObjectType.DeadBush:
      if (distanceSq > 30 * 30) return 2;
      return 1;
    case PlacedObjectType.Cactus:
      return 1;
    default:
      return 1;
  }
}

function placementCullHash(object: PlacedObject): number {
  const x = Math.floor(object.x * 10);
  const z = Math.floor(object.z * 10);
  return Math.abs(x * 73_856_093 + z * 19_349_663 + object.renderTypeIndex * 83_492_791);
}

export function filterRenderablePlacedObjects(
  objects: readonly PlacedObject[],
  viewerX: number,
  viewerZ: number,
): PlacedObject[] {
  return objects.filter((object) => {
    const dx = object.x - viewerX;
    const dz = object.z - viewerZ;
    const distanceSq = dx * dx + dz * dz;
    const radius = RENDER_RADIUS_BY_TYPE[object.type];
    if (distanceSq > radius * radius) return false;

    const stride = farDistanceStride(object, distanceSq);
    if (stride === 1) return true;
    return placementCullHash(object) % stride === 0;
  });
}
