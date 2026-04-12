import { type Vec3, Vec4 } from "gl-matrix";
import { type Accessor, createEffect, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type { Player, PlayerInput } from "~/game/player";
import { CameraController } from "./camera-controller";
import { InputController } from "./input";
import { Renderer } from "./render/renderer";
import { ChunkMaster } from "~/game/chunk-master";

export interface CreateGameArgs {
  glCanvas: Accessor<HTMLCanvasElement | undefined>;
  inputCanvas: Accessor<HTMLCanvasElement | undefined>;
  player: Player;
  sendInput: (input: PlayerInput) => void;
}

interface MutableGameState {
  playerPosition: Vec3;
  fps: number;
  frameCount: number;
}

export type GameState = Readonly<MutableGameState>;

const LIGHT_POSITION = new Vec4([-1000, 1000, -1000, 1]);
const BACKGROUND_COLOR = new Vec4([0.0, 0.37254903, 0.37254903, 1.0]);
const FPS_WINDOW_MS = 500;

function scaleCanvasToDPR(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.width;
  const cssHeight = canvas.height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
}

/**
 * Reactive game primitive. Call from a Solid reactive scope (e.g. component body).
 * Boots when both canvas accessors resolve; tears down via the enclosing scope.
 */
export function createGame(args: CreateGameArgs): GameState {
  const [state, setState] = createStore<MutableGameState>({
    playerPosition: args.player.position,
    fps: 0,
    frameCount: 0,
  });

  createEffect(() => {
    const gl = args.glCanvas();
    const inputEl = args.inputCanvas();
    if (!gl || !inputEl) return;

    scaleCanvasToDPR(gl);
    scaleCanvasToDPR(inputEl);

    const renderer = new Renderer(gl);
    const chunkMaster = new ChunkMaster(0, 0);
    const camera = new CameraController({ width: inputEl.width, height: inputEl.height });
    const input = new InputController(inputEl, { onReset: () => camera.reset() });

    let rafId = 0;
    let lastTime = performance.now();
    let fpsAccumMs = 0;
    let fpsFrames = 0;
    let frame = 0;

    const tick = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;

      const mouse = input.consumeMouseDelta();
      camera.rotate(mouse.dx, mouse.dy);
      const walk = camera.walkDir(input.walkKeys());
      args.sendInput({ dx: walk.x, dz: walk.z });
      camera.setPosition(args.player.position);

      chunkMaster.updateChunksAroundPos(args.player.position.x, args.player.position.z);

      renderer.render({
        viewMatrix: camera.viewMatrix(),
        projMatrix: camera.projMatrix(),
        cubePositions: chunkMaster.getNearCubePositionsFlattened(),
        cubeColors: chunkMaster.getNearCubeColorsFlattened(),
        numCubes: chunkMaster.getNearCubeSize(),
        lightPosition: LIGHT_POSITION,
        backgroundColor: BACKGROUND_COLOR,
      });

      frame++;
      fpsAccumMs += dt;
      fpsFrames++;

      const patch: Partial<MutableGameState> = {
        playerPosition: args.player.position,
        frameCount: frame,
      };
      if (fpsAccumMs >= FPS_WINDOW_MS) {
        patch.fps = Math.round((fpsFrames * 1000) / fpsAccumMs);
        fpsAccumMs = 0;
        fpsFrames = 0;
      }
      setState(patch);

      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    onCleanup(() => {
      cancelAnimationFrame(rafId);
      input.destroy();
    });
  });

  return state;
}
