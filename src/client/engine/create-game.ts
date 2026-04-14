import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeTimer } from "@solid-primitives/timer";
import { Vec3, Vec4 } from "gl-matrix";
import { onCleanup } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { PlacedObjectType } from "@/game/object-placement";
import { filterRenderablePlacedObjects } from "@/game/object-placement-render";
import type { Player, PlayerInput } from "@/game/player";
import { createRateMeter, createRingBuffer } from "../primitives";
import type { joinWorld } from "../primitives/join-world";
import { CameraController } from "./camera-controller";
import { ChunkManager } from "./chunks";
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
import { createInput } from "./input";
import { Renderer } from "./render/renderer";
import { createRenderLoop } from "./render-loop";

export interface CreateGameArgs {
  glCanvas: () => HTMLCanvasElement | undefined;
  room: ReturnType<typeof joinWorld>;
}

export interface ClientDiagnostics {
  fps: number;
  frameCount: number;
  computeTimeMs: number;
  computeTimeHistory: number[];
  placedObjectCount: number;
  generatedPlacedObjectCount: number;
  placedObjectCounts: Record<PlacedObjectType, number>;
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

const LIGHT_POSITION = new Vec4([-1000, 1000, -1000, 1]);
const BACKGROUND_COLOR = new Vec4([0.0, 0.37254903, 0.37254903, 1.0]);
const FPS_WINDOW_MS = 500;
const FRAME_HISTORY_SIZE = 120;
const TEMP_START_SEED = 123;
const MAX_INPUT_DT_MS = 100;
const INPUT_SEND_INTERVAL_MS = 50;

function emptyPlacedObjectCounts(): Record<PlacedObjectType, number> {
  return {
    [PlacedObjectType.Grass]: 0,
    [PlacedObjectType.Shrub]: 0,
    [PlacedObjectType.Rock]: 0,
    [PlacedObjectType.Tree]: 0,
    [PlacedObjectType.EnemySpawn]: 0,
  };
}

function initRenderState(gl: HTMLCanvasElement, player: Player) {
  const renderer = new Renderer(gl, [playerPassDef, placedObjectPassDef, placedRockPassDef]);
  const camera = new CameraController({ width: gl.clientWidth, height: gl.clientHeight });
  camera.setOrientation(player.state.yaw, player.state.pitch);
  camera.setPosition(player.position);
  return { renderer, camera };
}

export function createGame(args: CreateGameArgs): GameState {
  const room = () => args.room;
  const chunks = new ChunkManager(0.0, 0.0, TEMP_START_SEED);

  onCleanup(() => {
    chunks.dispose();
  });

  const [state, setState] = createStore<MutableGameState>({
    playerPosition: new Vec3(),
    diagnostics: {
      client: {
        fps: 0,
        frameCount: 0,
        computeTimeMs: 0,
        computeTimeHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        placedObjectCount: 0,
        generatedPlacedObjectCount: chunks.getVisiblePlacedObjectCount(),
        placedObjectCounts: chunks.getVisiblePlacedObjectCounts(),
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

  const remotePlayers = createEntityPipeline(playerPipelineConfig);
  const fpsMeter = createRateMeter(FPS_WINDOW_MS);
  const tpsMeter = createRateMeter(FPS_WINDOW_MS);
  const snapMeter = createRateMeter(FPS_WINDOW_MS);
  const computeHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const msptHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const placedObjectBuffers: GpuBuffers = {};
  const placedRockBuffers: GpuBuffers = {};
  let frame = 0;
  let lastYaw = 0;
  let lastPitch = 0;
  let lastSnapCount = 0;
  let lastTick = 0;
  let tickDelta = 0;
  let lastPlacedObjects = chunks.getVisiblePlacedObjects();
  let lastRenderCenterX = NaN;
  let lastRenderCenterZ = NaN;
  let renderedPlacedObjectCount = 0;
  let renderedFoliageCount = 0;
  let renderedRockCount = 0;
  let renderedPlacedObjectCounts = emptyPlacedObjectCounts();

  const input = createInput(args.glCanvas, { onReset: () => ctx?.camera.reset() });

  let unsent: PlayerInput[] = [];
  makeTimer(
    () => {
      const session = room().session();
      if (unsent.length === 0 || !session) return;
      session.sendInputs(unsent);
      unsent = [];
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

    const mouse = input.consumeMouseDelta();
    camera.rotate(mouse.dx, mouse.dy);
    const walk = camera.walkDir(input.walkKeys());
    const yaw = camera.yaw();
    const pitch = camera.pitch();
    if (walk.x !== 0 || walk.y !== 0 || walk.z !== 0 || yaw !== lastYaw || pitch !== lastPitch) {
      lastYaw = yaw;
      lastPitch = pitch;
      const next: PlayerInput = { dx: walk.x, dy: walk.y, dz: walk.z, dtSeconds: inputDt, yaw, pitch };
      room().replicated()?.predict(next);
      unsent.push(next);
    }
    camera.setPosition(player.position);

    chunks.update(player.position.x, player.position.z);
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
      renderedPlacedObjectCount = renderablePlacedObjects.length;
      const foliageObjects = renderablePlacedObjects.filter((object) => object.type !== PlacedObjectType.Rock);
      const rockObjects = renderablePlacedObjects.filter((object) => object.type === PlacedObjectType.Rock);
      renderedFoliageCount = packPlacedObjects(foliageObjects, placedObjectBuffers);
      renderedRockCount = packPlacedRocks(rockObjects, placedRockBuffers);
      renderedPlacedObjectCounts = emptyPlacedObjectCounts();
      for (const object of renderablePlacedObjects) {
        renderedPlacedObjectCounts[object.type]++;
      }
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

    const { buffers, count } = remotePlayers.frame(now);
    const entities: EntityDrawData[] = [
      { key: "players", buffers, count },
      { key: "placed-objects", buffers: placedObjectBuffers, count: renderedFoliageCount },
      { key: "placed-rocks", buffers: placedRockBuffers, count: renderedRockCount },
    ];
    renderer.render({
      viewMatrix: camera.viewMatrix(),
      projMatrix: camera.projMatrix(),
      cubePositions: chunks.positions,
      cubeColors: chunks.colors,
      numCubes: chunks.count,
      lightPosition: LIGHT_POSITION,
      backgroundColor: BACKGROUND_COLOR,
      entities,
    });

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
      placedObjectCount: renderedPlacedObjectCount,
      generatedPlacedObjectCount: chunks.getVisiblePlacedObjectCount(),
      placedObjectCounts: renderedPlacedObjectCounts,
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
