import { createResizeObserver } from "@solid-primitives/resize-observer";
import { Vec3, Vec4 } from "gl-matrix";
import { createStore, unwrap } from "solid-js/store";
import { ChunkMaster } from "@/game/chunk-master";
import type { Player } from "@/game/player";
import { createRateMeter, createRingBuffer } from "../primitives";
import type { joinWorld } from "../primitives/join-world";
import { CameraController } from "./camera-controller";
import { createEntityPipeline, type EntityDrawData, playerPassDef, playerPipelineConfig } from "./entities";
import { createInput } from "./input";
import { Renderer } from "./render/renderer";
import { createRenderLoop } from "./render-loop";

export interface CreateGameArgs {
  /** WebGL rendering canvas (resolved lazily via accessor). */
  glCanvas: () => HTMLCanvasElement | undefined;
  /** Output of `joinWorld()` — provides player, snapshot, input, etc. */
  room: ReturnType<typeof joinWorld>;
}

/** Client-side rendering metrics exposed to the diagnostics panel. */
export interface ClientDiagnostics {
  fps: number;
  frameCount: number;
  /** Client-measured wall-clock time for the tick function (ms). */
  computeTimeMs: number;
  /** Rolling ring-buffer of recent compute times for sparkline display. */
  computeTimeHistory: number[];
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

const LIGHT_POSITION = new Vec4([-1000, 1000, -1000, 1]);
const BACKGROUND_COLOR = new Vec4([0.0, 0.37254903, 0.37254903, 1.0]);
/** Sliding window for FPS / TPS / snap-rate averaging. */
const FPS_WINDOW_MS = 500;
/** Number of samples kept in the compute-time and mspt ring buffers. */
const FRAME_HISTORY_SIZE = 120;
const TEMP_START_SEED = 123; // TODO: On DO creation, create a random seed and send to client
/** Clamp input dt so a long tab-away doesn't cause a huge movement spike. */
const MAX_INPUT_DT_MS = 100;

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

  const [state, setState] = createStore<MutableGameState>({
    playerPosition: new Vec3(),
    diagnostics: {
      client: {
        fps: 0,
        frameCount: 0,
        computeTimeMs: 0,
        computeTimeHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
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

  const chunkMaster = new ChunkMaster(0.0, 0.0, TEMP_START_SEED);
  const remotePlayers = createEntityPipeline(playerPipelineConfig);
  const fpsMeter = createRateMeter(FPS_WINDOW_MS);
  const tpsMeter = createRateMeter(FPS_WINDOW_MS);
  const snapMeter = createRateMeter(FPS_WINDOW_MS);
  const computeHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const msptHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  let frame = 0;
  let lastYaw = 0;
  let lastPitch = 0;
  let lastSnapCount = 0;
  let lastTick = 0;
  let tickDelta = 0;

  const input = createInput(args.glCanvas, { onReset: () => ctx?.camera.reset() });
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
    const mouse = input.consumeMouseDelta();
    camera.rotate(mouse.dx, mouse.dy);
    const walk = camera.walkDir(input.walkKeys());
    const yaw = camera.yaw();
    const pitch = camera.pitch();
    if (walk.x !== 0 || walk.y !== 0 || walk.z !== 0 || yaw !== lastYaw || pitch !== lastPitch) {
      lastYaw = yaw;
      lastPitch = pitch;
      room().input({
        dx: walk.x,
        dy: walk.y,
        dz: walk.z,
        dtSeconds: inputDt,
        yaw,
        pitch,
      });
    }
    camera.setPosition(player.position);

    // update chunks around player
    chunkMaster.updateChunksAroundPos(player.position.x, player.position.z);

    // --- Remote entities ---
    const snap = room().snapshot;
    if (snap.tick !== lastTick) {
      remotePlayers.onSnapshot(unwrap(snap.players), now);
      tickDelta = snap.tick - lastTick;
      lastTick = snap.tick;
      msptHistory.push(snap.tickTimeMs);
    }

    // --- Render ---
    const { buffers, count } = remotePlayers.frame(now);
    const entities: EntityDrawData[] = [{ key: "players", buffers, count }];
    renderer.render({
      viewMatrix: camera.viewMatrix(),
      projMatrix: camera.projMatrix(),
      cubePositions: chunkMaster.getNearCubePositionsFlattened(),
      cubeColors: chunkMaster.getNearCubeColorsFlattened(),
      numCubes: chunkMaster.getNearCubeSize(),
      lightPosition: LIGHT_POSITION,
      backgroundColor: BACKGROUND_COLOR,
      entities,
    });

    // --- Diagnostics (producers → store) ---
    frame++;
    const computeTimeMs = performance.now() - tickStart;
    fpsMeter.sample(dt, 1);
    computeHistory.push(computeTimeMs);
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
