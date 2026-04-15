import { Mat4, Vec3 } from "gl-matrix";
import { ITEM_DEFINITIONS_BY_ID, type ItemId } from "@/game/items";
import { CameraController } from "../camera-controller";
import { createHeldCubeBuffers, type HeldCubeBuffers } from "./held-item-cubes";
import { resolveHeldItemFaceTiles } from "./held-item-textures";
import type { HeldItemPassView } from "./renderer";

const HELD_ITEM_CAMERA_FOV = 30;
const HELD_ITEM_CAMERA_Z_NEAR = 0.1;
const HELD_ITEM_CAMERA_Z_FAR = 10;
const HELD_ITEM_CAMERA_EYE = new Vec3([0, 0, 3.15]);
const HELD_ITEM_CAMERA_TARGET = new Vec3([0, 0, 0]);
const HELD_ITEM_LIGHT = new Float32Array([2.5, 3.5, 1.5, 1]);
const HELD_ITEM_AMBIENT = new Float32Array([1, 1, 1]);
const HELD_ITEM_SUN_COLOR = new Float32Array([1, 1, 1]);
const HELD_ITEM_IDENTITY_MODEL = new Mat4().identity();
const HELD_ITEM_ICON_MODEL = new Mat4().identity();

HELD_ITEM_ICON_MODEL.rotate(Math.PI, new Vec3([0, 1, 0]));

export class HeldItemLayer {
  private readonly camera: CameraController;
  private readonly heldCubeBuffers = new Map<ItemId, HeldCubeBuffers>();
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera = new CameraController({
      width: this.width,
      height: this.height,
      eye: HELD_ITEM_CAMERA_EYE,
      fov: HELD_ITEM_CAMERA_FOV,
      target: HELD_ITEM_CAMERA_TARGET,
      zNear: HELD_ITEM_CAMERA_Z_NEAR,
      zFar: HELD_ITEM_CAMERA_Z_FAR,
    });
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.resize(this.width, this.height);
    this.heldCubeBuffers.clear();
  }

  buildPass(itemId?: ItemId | null): HeldItemPassView | null {
    if (!itemId) {
      return null;
    }

    const buffers = this.getHeldCubeBuffers(itemId);
    const useIconFallback = !ITEM_DEFINITIONS_BY_ID[itemId].blockTextures;

    return {
      viewMatrix: this.camera.viewMatrix(),
      projMatrix: this.camera.projMatrix(),
      heldItemBatches: [
        {
          cubeModelMatrix: useIconFallback ? HELD_ITEM_ICON_MODEL : HELD_ITEM_IDENTITY_MODEL,
          cubePositions: buffers.cubePositions,
          cubeColors: buffers.cubeColors,
          cubeFaceTiles0: buffers.cubeFaceTiles0,
          cubeFaceTiles1: buffers.cubeFaceTiles1,
          numCubes: buffers.numCubes,
          cubeLighting: 0,
          cubeTextureFlipV: 1,
          cubeTextureFlipU: useIconFallback ? 1 : 0,
          cubeTextureAlpha: 1,
          cubeTransparentMissingFaces: 1,
        },
      ],
      lightPosition: HELD_ITEM_LIGHT,
      ambientColor: HELD_ITEM_AMBIENT,
      sunColor: HELD_ITEM_SUN_COLOR,
      clearDepth: true,
    };
  }

  private getHeldCubeBuffers(itemId: ItemId): HeldCubeBuffers {
    const existing = this.heldCubeBuffers.get(itemId);
    if (existing) return existing;

    const aspect = Math.max(0.75, this.width / Math.max(1, this.height));
    const x = -0.8 + -0.38 * aspect;
    const buffers = createHeldCubeBuffers(x, 1.05, 1.4, resolveHeldItemFaceTiles(itemId, true));
    this.heldCubeBuffers.set(itemId, buffers);
    return buffers;
  }
}
