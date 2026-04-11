import { createEventListener } from "@solid-primitives/event-listener";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { type Vec3, Vec4 } from "gl-matrix";
import { type Accessor, createEffect, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { Chunk } from "~/game/chunk";
import type { Player, PlayerInput } from "~/game/player";
import type { RoomSnapshot } from "~/game/protocol";
import type { Orientation } from "../create-room";
import { CameraController } from "./camera-controller";
import { createInput, type MouseDiagnostics } from "./input";
import { Renderer } from "./render/renderer";

export interface CreateGameArgs {
  glCanvas: Accessor<HTMLCanvasElement | undefined>;
  inputCanvas: Accessor<HTMLCanvasElement | undefined>;
  player: Player;
  sendInput: (input: PlayerInput) => void;
  cameraOrientation: Accessor<Orientation | null>;
  snapshot: Accessor<RoomSnapshot>;
  snapCount: () => number;
  localPlayerId: string;
}

interface MutableGameState {
  playerPosition: Vec3;
  fps: number;
  frameCount: number;
  computeTimeMs: number;
  computeTimeHistory: number[];
  tps: number;
  mspt: number;
  msptHistory: number[];
  snapsPerSec: number;
  mouse: MouseDiagnostics;
}

export type GameState = Readonly<MutableGameState>;

const LIGHT_POSITION = new Vec4([-1000, 1000, -1000, 1]);
const BACKGROUND_COLOR = new Vec4([0.0, 0.37254903, 0.37254903, 1.0]);
const FPS_WINDOW_MS = 500;
const FRAME_HISTORY_SIZE = 120;
const BLURRED_FRAME_MS = 200;
const TEMP_START_SEED = 123;
const MAX_INPUT_DT_MS = 100;

/**
 * Reactive game primitive. Call from a Solid reactive scope (e.g. component body).
 * Boots when both canvas accessors resolve; tears down via the enclosing scope.
 */
export function createGame(args: CreateGameArgs): GameState {
  const [state, setState] = createStore<MutableGameState>({
    playerPosition: args.player.position,
    fps: 0,
    frameCount: 0,
    computeTimeMs: 0,
    computeTimeHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
    tps: 0,
    mspt: 0,
    msptHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
    snapsPerSec: 0,
    mouse: {
      pointerLocked: false,
    },
  });

  createEffect(() => {
    const gl = args.glCanvas();
    const inputEl = args.inputCanvas();
    if (!gl || !inputEl) return;

    const renderer = new Renderer(gl);
    const chunk = new Chunk(0.0, 0.0, 64, TEMP_START_SEED);
    const camera = new CameraController({ width: gl.clientWidth, height: gl.clientHeight });
    const input = createInput(inputEl, { onReset: () => camera.reset() });

    createEffect(() => {
      const orient = args.cameraOrientation();
      if (orient) camera.setOrientation(orient.yaw, orient.pitch);
    });

    let needsResize = true;
    createResizeObserver(gl, () => {
      needsResize = true;
    });

    let rafId = 0;
    let timeoutId: number | undefined;
    let lastTime = performance.now();
    let fpsAccumMs = 0;
    let fpsFrames = 0;
    let frame = 0;
    let hasFocus = document.visibilityState === "visible" && document.hasFocus();
    const computeTimeHistory = Array.from({ length: FRAME_HISTORY_SIZE }, () => 0);
    let computeTimeIndex = 0;
    const msptHistory = Array.from({ length: FRAME_HISTORY_SIZE }, () => 0);
    let msptIndex = 0;
    let lastSeenTick = 0;
    let tpsAccumMs = 0;
    let tpsTicks = 0;
    let snapAccumMs = 0;
    let lastSnapCount = 0;
    let lastYaw = 0;
    let lastPitch = 0;

    const updateFocus = () => {
      hasFocus = document.visibilityState === "visible" && document.hasFocus();
    };
    hasFocus = true;

    createEventListener(window, "focus", updateFocus);
    createEventListener(window, "blur", updateFocus);
    createEventListener(document, "visibilitychange", updateFocus);

    const recordComputeTime = (duration: number) => {
      computeTimeHistory[computeTimeIndex] = duration;
      computeTimeIndex = (computeTimeIndex + 1) % computeTimeHistory.length;
    };

    const orderedComputeTimeHistory = () => [
      ...computeTimeHistory.slice(computeTimeIndex),
      ...computeTimeHistory.slice(0, computeTimeIndex),
    ];

    const orderedMsptHistory = () => [
      ...msptHistory.slice(msptIndex),
      ...msptHistory.slice(0, msptIndex),
    ];

    const scheduleNextTick = () => {
      if (hasFocus) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }
      timeoutId = window.setTimeout(() => {
        tick(performance.now());
      }, BLURRED_FRAME_MS);
    };

    const tick = (now: number) => {
      const tickStartedAt = performance.now();
      const dt = now - lastTime;
      lastTime = now;
      const inputDtSeconds = Math.min(dt, MAX_INPUT_DT_MS) / 1000;

      if (needsResize) {
        needsResize = false;
        const dpr = window.devicePixelRatio || 1;
        gl.width = Math.round(gl.clientWidth * dpr);
        gl.height = Math.round(gl.clientHeight * dpr);
        inputEl.width = gl.width;
        inputEl.height = gl.height;
        camera.resize(gl.clientWidth, gl.clientHeight);
      }

      const mouse = input.consumeMouseDelta();
      camera.rotate(mouse.dx, mouse.dy);
      const walk = camera.walkDir(input.walkKeys());
      const yaw = camera.yaw();
      const pitch = camera.pitch();
      if (walk.x !== 0 || walk.y !== 0 || walk.z !== 0 || yaw !== lastYaw || pitch !== lastPitch) {
        lastYaw = yaw;
        lastPitch = pitch;
        args.sendInput({
          dx: walk.x,
          dy: walk.y,
          dz: walk.z,
          dtSeconds: inputDtSeconds,
          yaw,
          pitch,
        });
      }
      camera.setPosition(args.player.position);

      const snap = args.snapshot();
      const remotePlayers = Object.values(snap.players).filter((p) => p.id !== args.localPlayerId);
      const playerPositions = new Float32Array(remotePlayers.length * 4);
      const playerPitches = new Float32Array(remotePlayers.length);
      let pi = 0;
      for (let i = 0; i < remotePlayers.length; i++) {
        const p = remotePlayers[i]!;
        playerPositions[pi] = p.x;
        playerPositions[pi + 1] = p.y;
        playerPositions[pi + 2] = p.z;
        playerPositions[pi + 3] = p.yaw;
        playerPitches[i] = p.pitch;
        pi += 4;
      }

      renderer.render({
        viewMatrix: camera.viewMatrix(),
        projMatrix: camera.projMatrix(),
        cubePositions: chunk.cubePositions(),
        numCubes: chunk.numCubes(),
        lightPosition: LIGHT_POSITION,
        backgroundColor: BACKGROUND_COLOR,
        playerPositions,
        playerPitches,
        numPlayers: remotePlayers.length,
      });

      frame++;
      fpsAccumMs += dt;
      fpsFrames++;
      const computeTimeMs = performance.now() - tickStartedAt;
      recordComputeTime(computeTimeMs);

      if (snap.tick !== lastSeenTick) {
        const tickDelta = snap.tick - lastSeenTick;
        lastSeenTick = snap.tick;
        tpsTicks += tickDelta;
        msptHistory[msptIndex] = snap.tickTimeMs;
        msptIndex = (msptIndex + 1) % msptHistory.length;
      }
      tpsAccumMs += dt;
      snapAccumMs += dt;

      const patch: Partial<MutableGameState> = {
        playerPosition: args.player.position,
        frameCount: frame,
        computeTimeMs,
        computeTimeHistory: orderedComputeTimeHistory(),
        mspt: snap.tickTimeMs,
        msptHistory: orderedMsptHistory(),
        mouse: { ...input.diagnostics() },
      };
      if (fpsAccumMs >= FPS_WINDOW_MS) {
        patch.fps = Math.round((fpsFrames * 1000) / fpsAccumMs);
        fpsAccumMs = 0;
        fpsFrames = 0;
      }
      if (tpsAccumMs >= FPS_WINDOW_MS) {
        patch.tps = Math.round((tpsTicks * 1000) / tpsAccumMs);
        tpsAccumMs = 0;
        tpsTicks = 0;
      }
      if (snapAccumMs >= FPS_WINDOW_MS) {
        const currentSnapCount = args.snapCount();
        const delta = currentSnapCount - lastSnapCount;
        patch.snapsPerSec = Math.round((delta * 1000) / snapAccumMs);
        lastSnapCount = currentSnapCount;
        snapAccumMs = 0;
      }
      setState(patch);

      scheduleNextTick();
    };
    scheduleNextTick();

    onCleanup(() => {
      cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });
  });

  return state;
}
