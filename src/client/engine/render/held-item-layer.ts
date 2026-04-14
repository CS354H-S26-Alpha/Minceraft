import { Mat4, Vec3 } from "gl-matrix";
import { ITEM_DEFINITIONS_BY_ID, type ItemId } from "@/game/items";
import { CameraController } from "../camera-controller";
import { createHeldCubeBuffers, type HeldCubeBuffers } from "./held-item-cubes";
import { resolveHeldItemFaceTiles } from "./held-item-textures";
import { Renderer } from "./renderer";

const HELD_ITEM_CAMERA_FOV = 30;
const HELD_ITEM_CAMERA_Z_NEAR = 0.1;
const HELD_ITEM_CAMERA_Z_FAR = 10;
const HELD_ITEM_CAMERA_EYE = new Vec3([0, 0, 3.15]);
const HELD_ITEM_CAMERA_TARGET = new Vec3([0, 0, 0]);
const HELD_ITEM_BACKGROUND = new Float32Array([0, 0, 0, 0]);
const HELD_ITEM_LIGHT = new Float32Array([2.5, 3.5, 1.5, 1]);
const HELD_ITEM_AMBIENT = new Float32Array([1, 1, 1]);
const HELD_ITEM_SUN_COLOR = new Float32Array([1, 1, 1]);
const HELD_ITEM_IDENTITY_MODEL = new Mat4().identity();
const HELD_ITEM_ICON_MODEL = new Mat4().identity();
const EMPTY_FLOATS = new Float32Array(0);
const EMPTY_HELD_CUBE_BUFFERS: HeldCubeBuffers = {
  cubePositions: EMPTY_FLOATS,
  cubeColors: EMPTY_FLOATS,
  cubeFaceTiles0: EMPTY_FLOATS,
  cubeFaceTiles1: EMPTY_FLOATS,
  numCubes: 0,
};

HELD_ITEM_ICON_MODEL.rotate(Math.PI, new Vec3([0, 1, 0]));

export class HeldItemLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly camera: CameraController;
  private readonly heldCubeBuffers = new Map<ItemId, HeldCubeBuffers>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, []);
    this.camera = new CameraController({
      width: Math.max(1, canvas.clientWidth),
      height: Math.max(1, canvas.clientHeight),
      eye: HELD_ITEM_CAMERA_EYE,
      fov: HELD_ITEM_CAMERA_FOV,
      target: HELD_ITEM_CAMERA_TARGET,
      zNear: HELD_ITEM_CAMERA_Z_NEAR,
      zFar: HELD_ITEM_CAMERA_Z_FAR,
    });
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.camera.resize(width, height);
    this.heldCubeBuffers.clear();
  }

  render(itemId?: ItemId | null): void {
    const buffers = itemId ? this.getHeldCubeBuffers(itemId) : EMPTY_HELD_CUBE_BUFFERS;
    const useIconFallback = itemId != null && !ITEM_DEFINITIONS_BY_ID[itemId].blockTextures;

    this.renderer.render({
      viewMatrix: this.camera.viewMatrix(),
      projMatrix: this.camera.projMatrix(),
      cubePositions: EMPTY_FLOATS,
      cubeColors: EMPTY_FLOATS,
      numCubes: 0,
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
      backgroundColor: HELD_ITEM_BACKGROUND,
      ambientColor: HELD_ITEM_AMBIENT,
      sunColor: HELD_ITEM_SUN_COLOR,
      entities: [],
    });
  }

  private getHeldCubeBuffers(itemId: ItemId): HeldCubeBuffers {
    const existing = this.heldCubeBuffers.get(itemId);
    if (existing) return existing;

    const aspect = Math.max(0.75, this.canvas.width / Math.max(1, this.canvas.height));
    const x = -0.8 + -0.38 * aspect;
    const buffers = createHeldCubeBuffers(x, 1.05, 1.4, resolveHeldItemFaceTiles(itemId, true));
    this.heldCubeBuffers.set(itemId, buffers);
    return buffers;
  }
}
