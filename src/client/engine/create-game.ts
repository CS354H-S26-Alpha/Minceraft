import { createEventListener } from "@solid-primitives/event-listener";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { type Vec3, Vec4 } from "gl-matrix";
import { type Accessor, createEffect, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { Chunk } from "~/game/chunk";
import type { joinWorld } from "../create-room";
import { CameraController } from "./camera-controller";
import { createInput, type MouseDiagnostics } from "./input";
import { Renderer } from "./render/renderer";

export interface CreateGameArgs {
  /** WebGL rendering canvas (resolved lazily via accessor). */
  glCanvas: Accessor<HTMLCanvasElement | undefined>;
  /** Transparent overlay canvas that captures pointer/keyboard input. */
  inputCanvas: Accessor<HTMLCanvasElement | undefined>;
  /** Output of `joinWorld()` — provides player, snapshot, input, etc. */
  room: ReturnType<typeof joinWorld>;
}

/** Client-side rendering metrics exposed to the diagnostics panel. */
export interface RendererDiagnostics {
  fps: number;
  frameCount: number;
  mouse: MouseDiagnostics;
}

/** Server-side performance metrics derived from room snapshots. */
export interface ServerDiagnostics {
  /** Client-measured wall-clock time for the tick function (ms). */
  computeTimeMs: number;
  /** Rolling ring-buffer of recent compute times for sparkline display. */
  computeTimeHistory: number[];
  /** Server ticks per second, computed from snapshot tick deltas. */
  tps: number;
  /** Milliseconds per server tick (from the snapshot). */
  mspt: number;
  /** Rolling ring-buffer of recent mspt values. */
  msptHistory: number[];
  /** How many snapshots we receive per second from the server. */
  snapsPerSec: number;
}

interface MutableGameState {
  playerPosition: Vec3;
  diagnostics: {
    renderer: RendererDiagnostics;
    server: ServerDiagnostics;
  };
}

export type GameState = Readonly<MutableGameState>;

const LIGHT_POSITION = new Vec4([-1000, 1000, -1000, 1]);
const BACKGROUND_COLOR = new Vec4([0.0, 0.37254903, 0.37254903, 1.0]);
/** Sliding window for FPS / TPS / snap-rate averaging. */
const FPS_WINDOW_MS = 500;
/** Number of samples kept in the compute-time and mspt ring buffers. */
const FRAME_HISTORY_SIZE = 120;
/** Target frame interval when the tab is backgrounded (throttled). */
const BLURRED_FRAME_MS = 200;
const TEMP_START_SEED = 123; // TODO: On DO creation, create a random seed and send to client
/** Clamp input dt so a long tab-away doesn't cause a huge movement spike. */
const MAX_INPUT_DT_MS = 100;

/**
 * Reactive game primitive. Call from a Solid reactive scope (e.g. component body).
 * Boots when both canvas accessors resolve; tears down via the enclosing scope.
 */
export function createGame(args: CreateGameArgs): GameState {
  const { player, snapshot, snapCount, input: sendInput, cameraOrientation } = args.room;
  const localPlayerId = player.id;

  const [state, setState] = createStore<MutableGameState>({
    playerPosition: player.position,
    diagnostics: {
      renderer: {
        fps: 0,
        frameCount: 0,
        mouse: {
          pointerLocked: false,
        },
      },
      server: {
        computeTimeMs: 0,
        computeTimeHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        tps: 0,
        mspt: 0,
        msptHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        snapsPerSec: 0,
      },
    },
  });

  // Effect tracks the canvas accessors — re-runs (and cleans up) if the
  // canvases are swapped. Guards on both being non-null before booting.
  createEffect(() => {
    const gl = args.glCanvas();
    const inputEl = args.inputCanvas();
    if (!gl || !inputEl) return;

    const renderer = new Renderer(gl);
    const chunk = new Chunk(0.0, 0.0, 64, TEMP_START_SEED);
    const camera = new CameraController({ width: gl.clientWidth, height: gl.clientHeight });
    const input = createInput(inputEl, { onReset: () => camera.reset() });

    // Sync camera orientation from a prior session when available.
    createEffect(() => {
      const orient = cameraOrientation();
      if (orient) camera.setOrientation(orient.yaw, orient.pitch);
    });

    // Defer the actual resize to the next tick to batch multiple resize events.
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

    const orderedMsptHistory = () => [...msptHistory.slice(msptIndex), ...msptHistory.slice(0, msptIndex)];

    // Use rAF when focused for vsync-aligned frames; fall back to a slow
    // setTimeout when backgrounded so we keep processing snapshots.
    const scheduleNextTick = () => {
      if (hasFocus) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }
      timeoutId = window.setTimeout(() => {
        tick(performance.now());
      }, BLURRED_FRAME_MS);
    };

    /** Main game loop: input → physics → render → diagnostics → schedule next. */
    const tick = (now: number) => {
      const tickStartedAt = performance.now();
      const dt = now - lastTime;
      lastTime = now;
      const inputDtSeconds = Math.min(dt, MAX_INPUT_DT_MS) / 1000;

      // --- Resize ---
      if (needsResize) {
        needsResize = false;
        const dpr = window.devicePixelRatio || 1;
        gl.width = Math.round(gl.clientWidth * dpr);
        gl.height = Math.round(gl.clientHeight * dpr);
        inputEl.width = gl.width;
        inputEl.height = gl.height;
        camera.resize(gl.clientWidth, gl.clientHeight);
      }

      // --- Input → server ---
      // Only send an input packet when something actually changed.
      const mouse = input.consumeMouseDelta();
      camera.rotate(mouse.dx, mouse.dy);
      const walk = camera.walkDir(input.walkKeys());
      const yaw = camera.yaw();
      const pitch = camera.pitch();
      if (walk.x !== 0 || walk.y !== 0 || walk.z !== 0 || yaw !== lastYaw || pitch !== lastPitch) {
        lastYaw = yaw;
        lastPitch = pitch;
        sendInput({
          dx: walk.x,
          dy: walk.y,
          dz: walk.z,
          dtSeconds: inputDtSeconds,
          yaw,
          pitch,
        });
      }
      // Camera follows the local player's authoritative position.
      camera.setPosition(player.position);

      // --- Pack remote players into typed arrays for the GPU ---
      // playerPositions: interleaved [x, y, z, yaw] per player.
      const snap = snapshot();
      const remotePlayers = Object.values(snap.players).filter((p) => p.id !== localPlayerId);
      const playerPositions = new Float32Array(remotePlayers.length * 4);
      const playerPitches = new Float32Array(remotePlayers.length);
      let pi = 0;
      for (let i = 0; i < remotePlayers.length; i++) {
        const p = remotePlayers[i];
        if (!p) continue;
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

      // --- Diagnostics accumulation ---
      frame++;
      fpsAccumMs += dt;
      fpsFrames++;
      const computeTimeMs = performance.now() - tickStartedAt;
      recordComputeTime(computeTimeMs);

      // Track server ticks we haven't seen yet for TPS calculation.
      if (snap.tick !== lastSeenTick) {
        const tickDelta = snap.tick - lastSeenTick;
        lastSeenTick = snap.tick;
        tpsTicks += tickDelta;
        msptHistory[msptIndex] = snap.tickTimeMs;
        msptIndex = (msptIndex + 1) % msptHistory.length;
      }
      tpsAccumMs += dt;
      snapAccumMs += dt;

      setState("playerPosition", player.position);
      setState("diagnostics", "renderer", {
        frameCount: frame,
        mouse: {
          pointerLocked: input.diagnostics().pointerLocked,
        },
      });

      setState("diagnostics", "server", {
        computeTimeMs,
        computeTimeHistory: orderedComputeTimeHistory(),
        mspt: snap.tickTimeMs,
        msptHistory: orderedMsptHistory(),
      });

      // Flush windowed averages every FPS_WINDOW_MS.
      if (fpsAccumMs >= FPS_WINDOW_MS) {
        setState("diagnostics", "renderer", "fps", Math.round((fpsFrames * 1000) / fpsAccumMs));
        fpsAccumMs = 0;
        fpsFrames = 0;
      }
      if (tpsAccumMs >= FPS_WINDOW_MS) {
        setState("diagnostics", "server", "tps", Math.round((tpsTicks * 1000) / tpsAccumMs));
        tpsAccumMs = 0;
        tpsTicks = 0;
      }
      if (snapAccumMs >= FPS_WINDOW_MS) {
        const currentSnapCount = snapCount();
        const delta = currentSnapCount - lastSnapCount;
        setState("diagnostics", "server", "snapsPerSec", Math.round((delta * 1000) / snapAccumMs));
        lastSnapCount = currentSnapCount;
        snapAccumMs = 0;
      }

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
