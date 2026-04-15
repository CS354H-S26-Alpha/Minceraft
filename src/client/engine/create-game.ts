import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeTimer } from "@solid-primitives/timer";
import { Vec3 } from "gl-matrix";
import { onCleanup } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { PlacedObjectType } from "@/game/object-placement";
import { filterRenderablePlacedObjects } from "@/game/object-placement-render";
import type { Player, PlayerInput, PlayerPositionPacket } from "@/game/player";
import { createRateMeter, createRingBuffer } from "../primitives";
import type { joinWorld } from "../primitives/join-world";
import { CameraController } from "./camera-controller";
import { ChunkManager } from "./chunks";
import { ChunkWorkerClient } from "./chunks/client";
import {
  createEntityPipeline,
  type EntityDrawData,
  type GpuBuffers,
  packPlacedObjects,
  packPlacedRocks,
  placedObjectPassDef,
  placedRockPassDef,
  playerPassDef,
  playerPipelineConfig,
} from "./entities";
import { createInput, type InputOptions } from "./input";
import { Renderer } from "./render/renderer";
import { createRenderLoop } from "./render-loop";

export interface CreateGameArgs {
  glCanvas: () => HTMLCanvasElement | undefined;
  room: ReturnType<typeof joinWorld>;
  inputEnabled?: () => boolean;
  shortcuts?: Omit<InputOptions, "onReset">;
}

export interface ClientDiagnostics {
  fps: number;
  frameCount: number;
  computeTimeMs: number;
  computeTimeHistory: number[];
  gpuTimeMs: number;
  gpuTimeHistory: number[];
  pointerLocked: boolean;
}

export interface ServerDiagnostics {
  tps: number;
  mspt: number;
  msptHistory: number[];
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

const DAY_LENGTH_S = 60;
const PHASE_MS = (DAY_LENGTH_S / 4) * 1000;

const _lightPos = new Float32Array(4);
const _bgColor = new Float32Array(4);
const _ambient = new Float32Array(3);
const _sunColor = new Float32Array(3);

let _timeOffset = 0;

function computeDayNight(nowMs: number): void {
  const t = ((nowMs + _timeOffset) / 1000) % DAY_LENGTH_S;
  const angle = (t / DAY_LENGTH_S) * Math.PI * 2;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);

  _lightPos[0] = cosA * 2000;
  _lightPos[1] = sinA * 2000;
  _lightPos[2] = 600;
  _lightPos[3] = 1;

  const day = Math.max(0, sinA);
  const night = Math.max(0, -sinA);
  const horizon = Math.max(0, 1 - Math.abs(sinA) / 0.35) * 0.35;

  _bgColor[0] = Math.min(1, day * 0.4 + horizon * 0.92 + night * 0.02);
  _bgColor[1] = Math.min(1, day * 0.62 + horizon * 0.42 + night * 0.02);
  _bgColor[2] = Math.min(1, day * 0.96 + horizon * 0.12 + night * 0.1);
  _bgColor[3] = 1;

  _ambient[0] = day * 0.28 + horizon * 0.35 + night * 0.04;
  _ambient[1] = day * 0.28 + horizon * 0.18 + night * 0.04;
  _ambient[2] = day * 0.32 + horizon * 0.06 + night * 0.1;

  _sunColor[0] = day * 1.0 + horizon * 1.0 + night * 0.3;
  _sunColor[1] = day * 0.96 + horizon * 0.52 + night * 0.32;
  _sunColor[2] = day * 0.82 + horizon * 0.1 + night * 0.5;
}

const FPS_WINDOW_MS = 500;
const FRAME_HISTORY_SIZE = 120;
const TEMP_START_SEED = 123;
const MAX_INPUT_DT_MS = 100;
const INPUT_SEND_INTERVAL_MS = 50;

function initRenderState(gl: HTMLCanvasElement, player: Player) {
  const renderer = new Renderer(gl, [playerPassDef, placedObjectPassDef, placedRockPassDef]);
  const camera = new CameraController({ width: gl.clientWidth, height: gl.clientHeight });
  camera.setOrientation(player.state.yaw, player.state.pitch);
  camera.setPosition(player.position);
  return { renderer, camera };
}

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
  onCleanup(() => {
    chunks.dispose();
  });

  const remotePlayers = createEntityPipeline(playerPipelineConfig);
  const fpsMeter = createRateMeter(FPS_WINDOW_MS);
  const tpsMeter = createRateMeter(FPS_WINDOW_MS);
  const snapMeter = createRateMeter(FPS_WINDOW_MS);
  const computeHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const gpuHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const msptHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const placedObjectBuffers: GpuBuffers = {};
  const placedRockBuffers: GpuBuffers = {};
  let frame = 0;
  let lastSnapCount = 0;
  let lastTick = 0;
  let tickDelta = 0;
  let lastPlacedObjects = chunks.getVisiblePlacedObjects();
  let lastRenderCenterX = NaN;
  let lastRenderCenterZ = NaN;
  let renderedFoliageCount = 0;
  let renderedRockCount = 0;

  const input = createInput(args.glCanvas, {
    onReset: () => ctx?.camera.reset(),
    onCycleDayPhase: () => {
      _timeOffset += PHASE_MS;
    },
    ...args.shortcuts,
  });

  let nextPacketSequence = 1;
  let pendingPacket: PlayerPositionPacket | undefined;
  makeTimer(
    () => {
      const session = room().session();
      if (!pendingPacket || !session) return;
      session.sendPosition(pendingPacket);
      pendingPacket = undefined;
    },
    INPUT_SEND_INTERVAL_MS,
    setInterval,
  );

  let needsResize = true;
  createResizeObserver(args.glCanvas, () => {
    needsResize = true;
  });

  let ctx: { renderer: Renderer; camera: CameraController } | undefined;

  createRenderLoop((dt, now) => {
    const gl = args.glCanvas();
    const player = room().player();
    if (!gl || !player) return;

    ctx ??= initRenderState(gl, player);
    const { renderer, camera } = ctx;

    const tickStart = performance.now();
    const inputDt = Math.min(dt, MAX_INPUT_DT_MS) / 1000;

    if (needsResize) {
      needsResize = false;
      const dpr = window.devicePixelRatio || 1;
      gl.width = Math.round(gl.clientWidth * dpr);
      gl.height = Math.round(gl.clientHeight * dpr);
      camera.resize(gl.clientWidth, gl.clientHeight);
    }

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

    const placedObjects = chunks.getVisiblePlacedObjects();
    const movedForObjectRepack =
      Number.isNaN(lastRenderCenterX) ||
      Math.abs(player.position.x - lastRenderCenterX) >= 4 ||
      Math.abs(player.position.z - lastRenderCenterZ) >= 4;
    if (placedObjects !== lastPlacedObjects || movedForObjectRepack) {
      const renderablePlacedObjects = filterRenderablePlacedObjects(
        placedObjects,
        player.position.x,
        player.position.z,
      );
      const foliageObjects = renderablePlacedObjects.filter((object) => object.type !== PlacedObjectType.Rock);
      const rockObjects = renderablePlacedObjects.filter((object) => object.type === PlacedObjectType.Rock);
      renderedFoliageCount = packPlacedObjects(foliageObjects, placedObjectBuffers);
      renderedRockCount = packPlacedRocks(rockObjects, placedRockBuffers);
      lastPlacedObjects = placedObjects;
      lastRenderCenterX = player.position.x;
      lastRenderCenterZ = player.position.z;
    }

    const snap = room().snapshot;
    if (snap.tick !== lastTick) {
      remotePlayers.onSnapshot(unwrap(snap.players), now);
      tickDelta = snap.tick - lastTick;
      lastTick = snap.tick;
      msptHistory.push(snap.tickTimeMs);
    }

    computeDayNight(now);

    const { buffers, count } = remotePlayers.frame(now);
    const entities: EntityDrawData[] = [
      { key: "players", buffers, count },
      { key: "placed-objects", buffers: placedObjectBuffers, count: renderedFoliageCount },
      { key: "placed-rocks", buffers: placedRockBuffers, count: renderedRockCount },
    ];
    renderer.render({
      viewMatrix,
      projMatrix,
      cubePositions: chunks.positions,
      cubeColors: chunks.colors,
      cubeAo: chunks.ao,
      numCubes: chunks.count,
      lightPosition: _lightPos,
      backgroundColor: _bgColor,
      ambientColor: _ambient,
      sunColor: _sunColor,
      entities,
    });

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
