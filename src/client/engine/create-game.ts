import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeTimer } from "@solid-primitives/timer";
import { Vec3 } from "gl-matrix";
import { createStore, unwrap } from "solid-js/store";
import type { Player, PlayerInput, PlayerPositionPacket } from "@/game/player";
import { createRateMeter, createRingBuffer } from "../primitives";
import type { joinWorld } from "../primitives/join-world";
import { CameraController } from "./camera-controller";
import { ChunkManager } from "./chunks";
import { ChunkWorkerClient } from "./chunks/client";
import { createEntityPipeline, type EntityDrawData, playerPassDef, playerPipelineConfig } from "./entities";
import { createInput, type InputOptions } from "./input";
import { Renderer } from "./render/renderer";
import { createRenderLoop } from "./render-loop";

export interface CreateGameArgs {
  /** WebGL rendering canvas (resolved lazily via accessor). */
  glCanvas: () => HTMLCanvasElement | undefined;
  /** Output of `joinWorld()` — provides player, snapshot, input, etc. */
  room: ReturnType<typeof joinWorld>;
  /** Whether first-person movement/look input should currently be active. */
  inputEnabled?: () => boolean;
  shortcuts?: Omit<InputOptions, "onReset">;
}

/** Client-side rendering metrics exposed to the diagnostics panel. */
export interface ClientDiagnostics {
  fps: number;
  frameCount: number;
  /** Client-measured wall-clock time for the tick function (ms). */
  computeTimeMs: number;
  /** Rolling ring-buffer of recent compute times for sparkline display. */
  computeTimeHistory: number[];
  /** GPU-measured draw time via EXT_disjoint_timer_query (ms). 0 if unsupported. */
  gpuTimeMs: number;
  /** Rolling ring-buffer of recent GPU times for sparkline display. */
  gpuTimeHistory: number[];
  pointerLocked: boolean;
}

/** Server-side performance metrics derived from room snapshots. */
export interface ServerDiagnostics {
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
    client: ClientDiagnostics;
    server: ServerDiagnostics;
  };
}

export type GameState = Readonly<MutableGameState>;

/**
 * Full day-night cycle duration in seconds.
 * 4 phases (dawn / day / dusk / night) × 15 s each = 60 s total.
 */
const DAY_LENGTH_S = 60;
/** Duration of each phase (dawn, noon, dusk, night) in milliseconds. */
const PHASE_MS = (DAY_LENGTH_S / 4) * 1000;

// Pre-allocated buffers updated in-place each frame — no GC pressure.
const _lightPos = new Float32Array(4);
const _bgColor = new Float32Array(4);
const _ambient = new Float32Array(3);
const _sunColor = new Float32Array(3);

/** Accumulated time offset (ms) added by pressing P to skip phases. */
let _timeOffset = 0;

/**
 * Computes all day/night rendering state from wall-clock time.
 * Called once per frame; result is written into the shared Float32Arrays above.
 *
 * Cycle phases (angle = 0..2π over DAY_LENGTH_S seconds):
 *   angle=0      → sunrise (east horizon)
 *   angle=π/2    → noon
 *   angle=π      → sunset (west horizon)
 *   angle=3π/2   → midnight
 */
function computeDayNight(nowMs: number): void {
  const t = ((nowMs + _timeOffset) / 1000) % DAY_LENGTH_S;
  const angle = (t / DAY_LENGTH_S) * Math.PI * 2;
  const sinA = Math.sin(angle); // +1 = noon, -1 = midnight
  const cosA = Math.cos(angle); // +1 = sunrise, -1 = sunset

  // Sun/moon position — orbits in the XY plane, offset in Z for angled light
  _lightPos[0] = cosA * 2000;
  _lightPos[1] = sinA * 2000;
  _lightPos[2] = 600;
  _lightPos[3] = 1;

  // Smooth phase weights (all ≥ 0, don't need to sum to 1)
  const day = Math.max(0, sinA); // 0..1, peaks at noon
  const night = Math.max(0, -sinA); // 0..1, peaks at midnight
  const horizon = Math.max(0, 1 - Math.abs(sinA) / 0.35) * 0.35; // spike near sunrise/sunset

  // -- Sky / background color --
  // Day:     cornflower blue  (0.40, 0.62, 0.96)
  // Horizon: warm orange-red  (0.92, 0.42, 0.12)
  // Night:   deep space blue  (0.02, 0.02, 0.10)
  _bgColor[0] = Math.min(1, day * 0.4 + horizon * 0.92 + night * 0.02);
  _bgColor[1] = Math.min(1, day * 0.62 + horizon * 0.42 + night * 0.02);
  _bgColor[2] = Math.min(1, day * 0.96 + horizon * 0.12 + night * 0.1);
  _bgColor[3] = 1;

  // -- Ambient light (sky light bouncing onto all surfaces) --
  // Day:     cool light grey  (0.28, 0.28, 0.32)
  // Horizon: warm glow        (0.35, 0.18, 0.06)
  // Night:   moonlit blue     (0.04, 0.04, 0.10)
  _ambient[0] = day * 0.28 + horizon * 0.35 + night * 0.04;
  _ambient[1] = day * 0.28 + horizon * 0.18 + night * 0.04;
  _ambient[2] = day * 0.32 + horizon * 0.06 + night * 0.1;

  // -- Directional sun/moon color --
  // Day:     bright warm white (1.00, 0.96, 0.82)
  // Horizon: deep orange-gold  (1.00, 0.52, 0.10)
  // Night:   cool moonlight    (0.30, 0.32, 0.50)
  _sunColor[0] = day * 1.0 + horizon * 1.0 + night * 0.3;
  _sunColor[1] = day * 0.96 + horizon * 0.52 + night * 0.32;
  _sunColor[2] = day * 0.82 + horizon * 0.1 + night * 0.5;
}
/** Sliding window for FPS / TPS / snap-rate averaging. */
const FPS_WINDOW_MS = 500;
/** Number of samples kept in the compute-time and mspt ring buffers. */
const FRAME_HISTORY_SIZE = 120;
const TEMP_START_SEED = 123; // TODO: On DO creation, create a random seed and send to client
/** Clamp input dt so a long tab-away doesn't cause a huge movement spike. */
const MAX_INPUT_DT_MS = 100;
const INPUT_SEND_INTERVAL_MS = 50;

function initRenderState(gl: HTMLCanvasElement, player: Player) {
  const renderer = new Renderer(gl, [playerPassDef]);
  const camera = new CameraController({ width: gl.clientWidth, height: gl.clientHeight });
  camera.setOrientation(player.state.yaw, player.state.pitch);
  camera.setPosition(player.position);
  return { renderer, camera };
}

/**
 * Reactive game primitive.
 *
 * The store is the reactive boundary: the rAF callback (an event-handler context)
 * writes into it each frame, and SolidJS consumers track individual properties.
 */
export function createGame(args: CreateGameArgs): GameState {
  const room = () => args.room;
  const inputEnabled = () => args.inputEnabled?.() ?? true;

  const [state, setState] = createStore<MutableGameState>({
    playerPosition: new Vec3(),
    diagnostics: {
      client: {
        fps: 0,
        frameCount: 0,
        computeTimeMs: 0,
        computeTimeHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        gpuTimeMs: 0,
        gpuTimeHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        pointerLocked: false,
      },
      server: {
        tps: 0,
        mspt: 0,
        msptHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        snapsPerSec: 0,
      },
    },
  });

  const chunks = new ChunkManager(0.0, 0.0, TEMP_START_SEED, new ChunkWorkerClient());
  const remotePlayers = createEntityPipeline(playerPipelineConfig);
  const fpsMeter = createRateMeter(FPS_WINDOW_MS);
  const tpsMeter = createRateMeter(FPS_WINDOW_MS);
  const snapMeter = createRateMeter(FPS_WINDOW_MS);
  const computeHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const gpuHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const msptHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  let frame = 0;
  let lastSnapCount = 0;
  let lastTick = 0;
  let tickDelta = 0;

  const input = createInput(args.glCanvas, {
    onReset: () => ctx?.camera.reset(),
    onCycleDayPhase: () => {
      _timeOffset += PHASE_MS;
    },
    ...args.shortcuts,
  });

  // TODO: refactor to be general packet handling rather than only inputs
  let nextPacketSequence = 1;
  let pendingPacket: PlayerPositionPacket | undefined;
  makeTimer(
    () => {
      const s = room().session();
      if (!pendingPacket || !s) return;
      s.sendPosition(pendingPacket);
      pendingPacket = undefined;
    },
    INPUT_SEND_INTERVAL_MS,
    setInterval,
  );

  let needsResize = true;
  createResizeObserver(args.glCanvas, () => {
    needsResize = true;
  });

  // Lazy-initialized on the first frame where all signals have resolved.
  let ctx: { renderer: Renderer; camera: CameraController } | undefined;

  createRenderLoop((dt, now) => {
    const gl = args.glCanvas();
    const player = room().player();
    if (!gl || !player) return;

    ctx ??= initRenderState(gl, player);
    const { renderer, camera } = ctx;

    const tickStart = performance.now();
    const inputDt = Math.min(dt, MAX_INPUT_DT_MS) / 1000;

    // --- Resize ---
    if (needsResize) {
      needsResize = false;
      const dpr = window.devicePixelRatio || 1;
      gl.width = Math.round(gl.clientWidth * dpr);
      gl.height = Math.round(gl.clientHeight * dpr);
      camera.resize(gl.clientWidth, gl.clientHeight);
    }

    // --- Input → server ---
    const mouse = inputEnabled() ? input.consumeMouseDelta() : { dx: 0, dy: 0 };
    camera.rotate(mouse.dx, mouse.dy);
    const walk = inputEnabled()
      ? camera.walkDir(input.walkKeys())
      : {
          x: 0,
          y: 0,
          z: 0,
        };
    const yaw = camera.yaw();
    const pitch = camera.pitch();
    if (inputEnabled()) {
      const next: PlayerInput = { dx: walk.x, dy: walk.y, dz: walk.z, dtSeconds: inputDt, yaw, pitch };
      room().replicated()?.predict(next);
      pendingPacket = {
        sequence: nextPacketSequence++,
        x: player.state.x,
        y: player.state.y,
        z: player.state.z,
        yaw: player.state.yaw,
        pitch: player.state.pitch,
      };
    }
    camera.setPosition(player.position);

    chunks.update(player.position.x, player.position.z);

    const viewMatrix = camera.viewMatrix();
    const projMatrix = camera.projMatrix();
    chunks.cull(viewMatrix, projMatrix);

    // --- Remote entities ---
    const snap = room().snapshot;
    if (snap.tick !== lastTick) {
      remotePlayers.onSnapshot(unwrap(snap.players), now);
      tickDelta = snap.tick - lastTick;
      lastTick = snap.tick;
      msptHistory.push(snap.tickTimeMs);
    }

    // --- Day/night state (pure math, no allocations) ---
    computeDayNight(now);

    // --- Render ---
    const { buffers, count } = remotePlayers.frame(now);
    const entities: EntityDrawData[] = [{ key: "players", buffers, count }];
    renderer.render({
      viewMatrix,
      projMatrix,
      cubePositions: chunks.positions,
      cubeColors: chunks.colors,
      cubeFaceTiles0: chunks.faceTiles0,
      cubeFaceTiles1: chunks.faceTiles1,
      numCubes: chunks.count,
      lightPosition: _lightPos,
      backgroundColor: _bgColor,
      ambientColor: _ambient,
      sunColor: _sunColor,
      entities,
    });

    // --- Diagnostics (producers → store) ---
    frame++;
    const computeTimeMs = performance.now() - tickStart;
    const gpuTimeMs = renderer.gpuTimer.lastTimeMs;
    fpsMeter.sample(dt, 1);
    computeHistory.push(computeTimeMs);
    gpuHistory.push(gpuTimeMs);
    tpsMeter.sample(dt, tickDelta);
    tickDelta = 0;
    const currentSnapCount = room().snapCount();
    snapMeter.sample(dt, currentSnapCount - lastSnapCount);
    lastSnapCount = currentSnapCount;

    setState("playerPosition", player.position);
    setState("diagnostics", "client", {
      fps: fpsMeter.rate,
      frameCount: frame,
      computeTimeMs,
      computeTimeHistory: computeHistory.ordered(),
      gpuTimeMs,
      gpuTimeHistory: gpuHistory.ordered(),
      pointerLocked: input.pointerLocked(),
    });
    setState("diagnostics", "server", {
      tps: tpsMeter.rate,
      mspt: snap.tickTimeMs,
      msptHistory: msptHistory.ordered(),
      snapsPerSec: snapMeter.rate,
    });
  });

  return state;
}
