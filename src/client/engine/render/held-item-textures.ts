import { ITEM_DEFINITIONS, ITEM_DEFINITIONS_BY_ID, type ItemId } from "@/game/items";

export const HELD_ITEM_FACE_ORDER = ["top", "left", "right", "front", "back", "bottom"] as const;

export type HeldItemFaceName = (typeof HELD_ITEM_FACE_ORDER)[number];

export interface HeldItemFaceTileIndices extends Record<HeldItemFaceName, number> {}

const heldItemAtlasTextureUrls: string[] = [];
const heldItemTextureTileIndexByUrl = new Map<string, number>();

function emptyHeldItemFaceTiles(): HeldItemFaceTileIndices {
  return {
    top: -1,
    left: -1,
    right: -1,
    front: -1,
    back: -1,
    bottom: -1,
  };
}

function registerHeldItemAtlasTexture(textureUrl: string): number {
  let tileIndex = heldItemTextureTileIndexByUrl.get(textureUrl);
  if (tileIndex === undefined) {
    tileIndex = heldItemAtlasTextureUrls.length;
    heldItemAtlasTextureUrls.push(textureUrl);
    heldItemTextureTileIndexByUrl.set(textureUrl, tileIndex);
  }
  return tileIndex;
}

function resolveHeldItemFaceTextureTiles(
  faceTextures: Partial<Record<HeldItemFaceName, string | null>> | undefined,
): HeldItemFaceTileIndices {
  const faceTiles = emptyHeldItemFaceTiles();
  if (!faceTextures) return faceTiles;

  for (const face of HELD_ITEM_FACE_ORDER) {
    const textureUrl = faceTextures[face];
    if (!textureUrl) continue;
    faceTiles[face] = registerHeldItemAtlasTexture(textureUrl);
  }

  return faceTiles;
}

export function resolveHeldItemFaceTiles(itemId: ItemId, swapVerticalFaces = false): HeldItemFaceTileIndices {
  const item = ITEM_DEFINITIONS_BY_ID[itemId];
  if (item.blockTextures) {
    return resolveHeldItemFaceTextureTiles({
      ...item.blockTextures,
      top: swapVerticalFaces ? item.blockTextures.bottom : item.blockTextures.top,
      bottom: swapVerticalFaces ? item.blockTextures.top : item.blockTextures.bottom,
    });
  }

  return resolveHeldItemFaceTextureTiles({ left: item.icon });
}

for (const item of ITEM_DEFINITIONS) {
  resolveHeldItemFaceTextureTiles(item.blockTextures ?? { left: item.icon });
}

export const HELD_ITEM_ATLAS_TEXTURE_URLS = heldItemAtlasTextureUrls;
