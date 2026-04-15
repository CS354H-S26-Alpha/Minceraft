import { Mat4, Vec3 } from "gl-matrix";
import { ITEM_DEFINITIONS_BY_ID } from "@/game/items";
import type { PlayerPublicState } from "@/game/player";
import { ensureBuffer, type GpuBuffers } from "../entities/pipeline";
import { type HeldItemFaceTileIndices, resolveHeldItemFaceTiles } from "./held-item-textures";
import type { HeldItemRenderBatch } from "./renderer";

export interface HeldCubeBuffers {
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  cubeFaceTiles0: Float32Array;
  cubeFaceTiles1: Float32Array;
  numCubes: number;
}

const REMOTE_HELD_ITEM_SIDE_OFFSET = 0.7;
const REMOTE_HELD_ITEM_FORWARD_OFFSET = 0.12;
const REMOTE_HELD_ITEM_Y_OFFSET = -0.05;
const REMOTE_HELD_ITEM_MODEL = new Mat4().identity();

REMOTE_HELD_ITEM_MODEL.scale(new Vec3([0.35, 0.35, 0.35]));

export function createHeldCubeBuffers(
  x: number,
  y: number,
  z: number,
  faceTiles: HeldItemFaceTileIndices,
  yaw = 0,
): HeldCubeBuffers {
  return {
    cubePositions: new Float32Array([x, y, z, yaw]),
    cubeColors: new Float32Array([1, 1, 1]),
    cubeFaceTiles0: new Float32Array([faceTiles.top, faceTiles.left, faceTiles.right]),
    cubeFaceTiles1: new Float32Array([faceTiles.front, faceTiles.back, faceTiles.bottom]),
    numCubes: 1,
  };
}

export function createRemoteHeldItemBatches(
  players: readonly PlayerPublicState[],
  buffers: GpuBuffers,
): HeldItemRenderBatch[] {
  let blockCount = 0;
  let iconCount = 0;
  for (const player of players) {
    const itemId = player.heldItemId;
    if (!itemId) continue;
    if (ITEM_DEFINITIONS_BY_ID[itemId].blockTextures) {
      blockCount++;
    } else {
      iconCount++;
    }
  }

  const batches: HeldItemRenderBatch[] = [];

  if (blockCount > 0) {
    batches.push(fillRemoteHeldItemBatch(players, buffers, blockCount, false));
  }
  if (iconCount > 0) {
    batches.push(fillRemoteHeldItemBatch(players, buffers, iconCount, true));
  }

  return batches;
}

function fillRemoteHeldItemBatch(
  players: readonly PlayerPublicState[],
  buffers: GpuBuffers,
  count: number,
  iconOnly: boolean,
): HeldItemRenderBatch {
  const prefix = iconOnly ? "heldItemIcon" : "heldItemBlock";
  const positions = ensureBuffer(buffers, `${prefix}Positions`, count * 4);
  const colors = ensureBuffer(buffers, `${prefix}Colors`, count * 3);
  const faceTiles0 = ensureBuffer(buffers, `${prefix}FaceTiles0`, count * 3);
  const faceTiles1 = ensureBuffer(buffers, `${prefix}FaceTiles1`, count * 3);

  let cursor = 0;
  for (const player of players) {
    const itemId = player.heldItemId;
    if (!itemId) continue;

    const usesIconFallback = !ITEM_DEFINITIONS_BY_ID[itemId].blockTextures;
    if (usesIconFallback !== iconOnly) continue;

    const rightX = Math.cos(player.yaw);
    const rightZ = Math.sin(player.yaw);
    const forwardX = Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const x = player.x + rightX * REMOTE_HELD_ITEM_SIDE_OFFSET + forwardX * REMOTE_HELD_ITEM_FORWARD_OFFSET;
    const y = player.y + REMOTE_HELD_ITEM_Y_OFFSET;
    const z = player.z + rightZ * REMOTE_HELD_ITEM_SIDE_OFFSET + forwardZ * REMOTE_HELD_ITEM_FORWARD_OFFSET;
    const yaw = player.yaw + Math.PI;
    const faceTiles = resolveHeldItemFaceTiles(itemId);

    positions[cursor * 4] = x;
    positions[cursor * 4 + 1] = y;
    positions[cursor * 4 + 2] = z;
    positions[cursor * 4 + 3] = yaw;

    colors[cursor * 3] = 1;
    colors[cursor * 3 + 1] = 1;
    colors[cursor * 3 + 2] = 1;

    faceTiles0[cursor * 3] = faceTiles.top;
    faceTiles0[cursor * 3 + 1] = faceTiles.left;
    faceTiles0[cursor * 3 + 2] = faceTiles.right;
    faceTiles1[cursor * 3] = faceTiles.front;
    faceTiles1[cursor * 3 + 1] = faceTiles.back;
    faceTiles1[cursor * 3 + 2] = faceTiles.bottom;

    cursor++;
  }

  return {
    cubeModelMatrix: REMOTE_HELD_ITEM_MODEL,
    cubePositions: positions.subarray(0, cursor * 4),
    cubeColors: colors.subarray(0, cursor * 3),
    cubeFaceTiles0: faceTiles0.subarray(0, cursor * 3),
    cubeFaceTiles1: faceTiles1.subarray(0, cursor * 3),
    numCubes: cursor,
    cubeLighting: 1,
    cubeTextureFlipU: iconOnly ? 1 : 0,
    cubeTextureAlpha: iconOnly ? 1 : 0,
    cubeTransparentMissingFaces: iconOnly ? 1 : 0,
  };
}
