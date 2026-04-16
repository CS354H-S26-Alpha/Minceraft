import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeTimer } from "@solid-primitives/timer";
import { Vec3 } from "gl-matrix";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { PlacedObjectType, RENDERABLE_PLACED_OBJECT_TYPES } from "@/game/object-placement";
import { filterRenderablePlacedObjects } from "@/game/object-placement-render";
import type { Player, PlayerInput, PlayerPositionPacket } from "@/game/player";
import { DAY_LENGTH_S } from "@/game/time";
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
import { SceneLighting } from "./scene-lighting";

export interface CreateGameArgs {
  glCanvas: () => HTMLCanvasElement | undefined;
  /** Output of `joinWorld()` — provides player, remote players, tick info, input, etc. */
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

/** Server-side performance metrics derived from `ServerTick` packets. */
export interface ServerDiagnostics {
  /** Milliseconds per server tick (reported in the `WorldStatePacket`). */
  mspt: number;
  msptHistory: number[];
  /** How many server ticks we receive per second. */
  snapsPerSec: number;
  /** How many position packets we send to the server per second. */
  packetsPerSec: number;
  /** Server-authoritative time of day in seconds. */
  timeOfDayS: number;
}

interface MutableGameState {
  playerPosition: Vec3;
  diagnostics: {
    client: ClientDiagnostics;
    server: ServerDiagnostics;
  };
}

export interface MinimapApi {
  /** Increments whenever chunk surface data changes. */
  terrainVersion: () => number;
  /** Number of world blocks available from player center to one map edge. */
  radiusBlocks: number;
  /**
   * Highest loaded block sample for world-space (x, z).
   * High byte = `CubeType`, low byte = surface Y.
   */
  sampleSurface: (wx: number, wz: number) => number | undefined;
}

export interface GameState extends Readonly<MutableGameState> {
  readonly minimap: MinimapApi;
}

/** Sliding window for FPS / TPS / snap-rate averaging. */
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
        mspt: 0,
        msptHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        snapsPerSec: 0,
        packetsPerSec: 0,
        timeOfDayS: 0,
      },
    },
  });

  const [terrainVersion, setTerrainVersion] = createSignal(0);
  const chunks = new ChunkManager(0.0, 0.0, TEMP_START_SEED, new ChunkWorkerClient(), () =>
    setTerrainVersion((version) => version + 1),
  );
  const lighting = new SceneLighting();
  onCleanup(() => {
    chunks.dispose();
  });

  const remotePlayers = createEntityPipeline(playerPipelineConfig);
  const fpsMeter = createRateMeter(FPS_WINDOW_MS);
  const snapMeter = createRateMeter(FPS_WINDOW_MS);
  const packetMeter = createRateMeter(FPS_WINDOW_MS);
  const computeHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const gpuHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const msptHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const placedObjectBuffers: GpuBuffers = {};
  const placedRockBuffers: GpuBuffers = {};
  let frame = 0;
  let lastSnapCount = 0;
  let lastTick = 0;
  let lastPacketCount = 0;
  let timeOffsetS = 0;
  let lastPlacedObjects = chunks.getVisiblePlacedObjects();
  let lastRenderCenterX = NaN;
  let lastRenderCenterZ = NaN;
  let renderedFoliageCount = 0;
  let renderedRockCount = 0;

  const handleReset = () => {
    ctx?.camera.reset();
    chunks.reset();
  };

  const input = createInput(args.glCanvas, {
    onReset: handleReset,
    ...args.shortcuts,
  });

  let nextPacketSequence = 1;
  let pendingPacket: Omit<PlayerPositionPacket, "sequence"> | undefined;

  // track player position changes to send to server
  createEffect(() => {
    const player = room().player();
    if (!player) return;
    pendingPacket = {
      x: player.state.x,
      y: player.state.y,
      z: player.state.z,
      yaw: player.state.yaw,
      pitch: player.state.pitch,
    };
  });

  let packetCount = 0;
  makeTimer(
    () => {
      const session = room().session();
      if (!pendingPacket || !session) return;
      session.sendPosition({ ...pendingPacket, sequence: nextPacketSequence++ });
      pendingPacket = undefined;
      packetCount++;
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
    const keys = input.walkKeys();
    const walk = inputEnabled() ? camera.walkDir(keys) : { x: 0, z: 0 };
    const jump = inputEnabled() && keys.space;
    const yaw = camera.yaw();
    const pitch = camera.pitch();
    if (inputEnabled()) {
      const next: PlayerInput = { dx: walk.x, dz: walk.z, dtSeconds: inputDt, yaw, pitch, jump };
      room().replicated()?.predict(next);
    }
    camera.setPosition(player.position);

    chunks.update(player.position.x, player.position.z);

    const replicated = room().replicated();
    if (replicated) {
      (replicated.entity as Player).collisionQuery = (cx, cz, cy) => chunks.collisionQuery(cx, cz, cy);
    }

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
      const foliageObjects = renderablePlacedObjects.filter(
        (object) =>
          object.type !== PlacedObjectType.Rock &&
          (RENDERABLE_PLACED_OBJECT_TYPES as readonly PlacedObjectType[]).includes(object.type),
      );
      const rockObjects = renderablePlacedObjects.filter((object) => object.type === PlacedObjectType.Rock);
      renderedFoliageCount = packPlacedObjects(foliageObjects, placedObjectBuffers);
      renderedRockCount = packPlacedRocks(rockObjects, placedRockBuffers);
      lastPlacedObjects = placedObjects;
      lastRenderCenterX = player.position.x;
      lastRenderCenterZ = player.position.z;
    }

    const tickInfo = room().tickInfo;
    if (tickInfo.tick !== lastTick) {
      remotePlayers.onSnapshot(unwrap(room().remotePlayers), now);
      lastTick = tickInfo.tick;
      msptHistory.push(tickInfo.tickTimeMs);
      timeOffsetS = tickInfo.timeOfDayS - ((now / 1000) % DAY_LENGTH_S);
    }

    const timeOfDayS = (((now / 1000 + timeOffsetS) % DAY_LENGTH_S) + DAY_LENGTH_S) % DAY_LENGTH_S;
    lighting.update(timeOfDayS);

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
      cubeAmbientOcclusion: chunks.ambientOcclusion,
      numCubes: chunks.count,
      lightPosition: lighting.lightPosition,
      backgroundColor: lighting.backgroundColor,
      ambientColor: lighting.ambientColor,
      sunColor: lighting.sunColor,
      entities,
    });

    frame++;
    const computeTimeMs = performance.now() - tickStart;
    const gpuTimeMs = renderer.gpuTimer.lastTimeMs;
    fpsMeter.sample(dt, 1);
    computeHistory.push(computeTimeMs);
    gpuHistory.push(gpuTimeMs);
    const currentSnapCount = room().snapCount();
    snapMeter.sample(dt, currentSnapCount - lastSnapCount);
    lastSnapCount = currentSnapCount;
    packetMeter.sample(dt, packetCount - lastPacketCount);
    lastPacketCount = packetCount;

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
      mspt: tickInfo.tickTimeMs,
      msptHistory: msptHistory.ordered(),
      snapsPerSec: snapMeter.rate,
      packetsPerSec: packetMeter.rate,
      timeOfDayS,
    });
  });

  return {
    get playerPosition() {
      return state.playerPosition;
    },
    get diagnostics() {
      return state.diagnostics;
    },
    minimap: {
      terrainVersion,
      radiusBlocks: chunks.minimapRadiusBlocks,
      sampleSurface: (wx, wz) => chunks.sampleSurface(wx, wz),
    },
  };
}
