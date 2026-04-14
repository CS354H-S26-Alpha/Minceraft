import dirtIcon from "@/assets/icons/dirt.png";
import stickIcon from "@/assets/icons/stick.png";
import woodIcon from "@/assets/icons/wood.png";
import woodPlankIcon from "@/assets/icons/wood_plank.png";
import dirtBottomTextureUrl from "@/assets/textures/dirt_bottom.png";
import dirtSideTextureUrl from "@/assets/textures/dirt_side.png";
import dirtTopTextureUrl from "@/assets/textures/dirt_top.png";
import woodEndsTextureUrl from "@/assets/textures/wood_face.png";
import woodPlankTextureUrl from "@/assets/textures/wood_plank.png";
import woodSideTextureUrl from "@/assets/textures/wood_side.png";

export interface ItemBlockFaceTextures {
  top: string;
  left: string;
  right: string;
  front: string;
  back: string;
  bottom: string;
}

export interface ItemDefinition {
  id: string;
  name: string;
  icon: string;
  maxStack: number;
  blockTextures?: ItemBlockFaceTextures;
}

const itemDefinitions = [
  {
    id: "wood",
    name: "Wood",
    icon: woodIcon,
    maxStack: 64,
    blockTextures: {
      top: woodEndsTextureUrl,
      left: woodSideTextureUrl,
      right: woodSideTextureUrl,
      front: woodSideTextureUrl,
      back: woodSideTextureUrl,
      bottom: woodEndsTextureUrl,
    },
  },
  {
    id: "wood_plank",
    name: "Wood Plank",
    icon: woodPlankIcon,
    maxStack: 64,
    blockTextures: {
      top: woodPlankTextureUrl,
      left: woodPlankTextureUrl,
      right: woodPlankTextureUrl,
      front: woodPlankTextureUrl,
      back: woodPlankTextureUrl,
      bottom: woodPlankTextureUrl,
    },
  },
  {
    id: "stick",
    name: "Stick",
    icon: stickIcon,
    maxStack: 64,
  },
  {
    id: "dirt",
    name: "Dirt",
    icon: dirtIcon,
    maxStack: 64,
    blockTextures: {
      top: dirtTopTextureUrl,
      left: dirtSideTextureUrl,
      right: dirtSideTextureUrl,
      front: dirtSideTextureUrl,
      back: dirtSideTextureUrl,
      bottom: dirtBottomTextureUrl,
    },
  },
] as const satisfies readonly ItemDefinition[];

export type ItemId = (typeof itemDefinitions)[number]["id"];

export const ITEM_DEFINITIONS: readonly (ItemDefinition & { id: ItemId })[] = itemDefinitions;

export const ITEM_DEFINITIONS_BY_ID = Object.fromEntries(ITEM_DEFINITIONS.map((item) => [item.id, item])) as Record<
  ItemId,
  ItemDefinition & { id: ItemId }
>;

export function isItemId(value: string): value is ItemId {
  return value in ITEM_DEFINITIONS_BY_ID;
}
