import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeTimer } from "@solid-primitives/timer";
import { Vec3 } from "gl-matrix";
import { createEffect, createSignal } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { CubeType } from "@/client/engine/render/cube-types";
import { CHUNK_SIZE } from "@/game/chunk";
import { blockIntersectsPlayer, type Player, type PlayerInput, type PlayerPositionPacket } from "@/game/player";
import { findTargetedPlayerId } from "@/game/player-targeting";
import { DAY_LENGTH_S } from "@/game/time";
import { createRateMeter, createRingBuffer } from "../primitives";
import type { joinWorld } from "../primitives/join-world";
import { CameraController } from "./camera-controller";
import { ChunkManager, RENDER_DISTANCE } from "./chunks";
import { ChunkWorkerClient } from "./chunks/client";
import { createEntityPipeline, type EntityDrawData, playerPassDef, playerPipelineConfig } from "./entities";
import { createInput, type InputOptions } from "./input";
import type { RaycastHit } from "./raycast";
import { raycastVoxels } from "./raycast";
import { Renderer } from "./render/renderer";
import { createRenderLoop } from "./render-loop";
import { SceneLighting } from "./scene-lighting";

export interface CreateGameArgs {
  /** WebGL rendering canvas (resolved lazily via accessor). */
  glCanvas: () => HTMLCanvasElement | undefined;
  /** Output of `joinWorld()` — provides player, remote players, tick info, input, etc. */
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

/** Server-side performance metrics derived from `ServerTick` packets. */
export interface ServerDiagnostics {
  /** Milliseconds per server tick (reported in the `WorldStatePacket`). */
  mspt: number;
  /** Rolling ring-buffer of recent mspt values. */
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
/** Number of samples kept in the compute-time and mspt ring buffers. */
const FRAME_HISTORY_SIZE = 120;
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
        mspt: 0,
        msptHistory: Array.from({ length: FRAME_HISTORY_SIZE }, () => 0),
        snapsPerSec: 0,
        packetsPerSec: 0,
        timeOfDayS: 0,
      },
    },
  });

  const [terrainVersion, setTerrainVersion] = createSignal(0);
  const chunks = new ChunkManager(new ChunkWorkerClient(), () => setTerrainVersion((version) => version + 1));
  const lighting = new SceneLighting();
  const remotePlayers = createEntityPipeline(playerPipelineConfig);
  const fpsMeter = createRateMeter(FPS_WINDOW_MS);
  const snapMeter = createRateMeter(FPS_WINDOW_MS);
  const packetMeter = createRateMeter(FPS_WINDOW_MS);
  const computeHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const gpuHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  const msptHistory = createRingBuffer(FRAME_HISTORY_SIZE);
  let frame = 0;
  let lastSnapCount = 0;
  let lastTick = 0;
  let lastPacketCount = 0;
  let timeOffsetS = 0;
  // Lazy-initialized on the first frame where all signals have resolved.
  let ctx: { renderer: Renderer; camera: CameraController } | undefined;

  let latestHit: RaycastHit | null = null;
  let blockSeq = 1;
  const pendingBlocks = new Map<number, { x: number; y: number; z: number; previousType: CubeType }>();

  const handleReset = () => {
    ctx?.camera.reset();
    chunks.reset();
  };

  const handleLeftClick = () => {
    const s = room().session();
    if (!s) return;

    const player = room().player();
    const camera = ctx?.camera;
    if (player && camera) {
      const yaw = camera.yaw();
      const pitch = camera.pitch();
      const targetPlayerId = findTargetedPlayerId(
        { x: player.state.x, y: player.state.y, z: player.state.z, yaw, pitch },
        remotePlayers.states(performance.now()),
      );
      if (targetPlayerId) {
        s.attack({
          targetPlayerId,
          x: player.state.x,
          y: player.state.y,
          z: player.state.z,
          yaw,
          pitch,
        });
        return;
      }
    }

    const hit = latestHit;
    if (!hit || hit.blockType === CubeType.Bedrock) return;

    const seq = blockSeq++;
    const previousType = chunks.modifyBlock(hit.blockX, hit.blockY, hit.blockZ, CubeType.Air);
    if (previousType == null) return;
    pendingBlocks.set(seq, { x: hit.blockX, y: hit.blockY, z: hit.blockZ, previousType });
    s.sendBlockAction({ seq, action: "break", x: hit.blockX, y: hit.blockY, z: hit.blockZ });
  };

  const handleRightClick = () => {
    const hit = latestHit;
    const s = room().session();
    if (!hit || !s) return;

    const placeX = hit.blockX + hit.faceNormal[0];
    const placeY = hit.blockY + hit.faceNormal[1];
    const placeZ = hit.blockZ + hit.faceNormal[2];

    // Don't place if the target is already occupied
    if (chunks.getBlock(placeX, placeY, placeZ) !== CubeType.Air) return;

    // Don't place inside the local player's own cylinder
    const player = room().player();
    if (player && blockIntersectsPlayer(placeX, placeY, placeZ, player.state)) return;

    const blockType = CubeType.Dirt; // TODO: use selected hotbar item
    const seq = blockSeq++;
    const previousType = chunks.modifyBlock(placeX, placeY, placeZ, blockType);
    if (previousType == null) return;
    pendingBlocks.set(seq, { x: placeX, y: placeY, z: placeZ, previousType });
    s.sendBlockAction({ seq, action: "place", x: placeX, y: placeY, z: placeZ, blockType });
  };

  const input = createInput(args.glCanvas, {
    onReset: handleReset,
    onLeftClick: handleLeftClick,
    onRightClick: handleRightClick,
    ...args.shortcuts,
  });

  // TODO: refactor to be general packet handling rather than only inputs
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
      const s = room().session();
      if (!pendingPacket || !s) return;
      s.sendPosition({ ...pendingPacket, sequence: nextPacketSequence++ });
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

  // Match Minecraft 1.21: fog starts at 92% of render distance and completes
  // at the hard chunk cutoff, so distant chunks fade into the sky instead of
  // popping as the player walks around.
  const FOG_FAR = RENDER_DISTANCE * CHUNK_SIZE;
  const FOG_NEAR = FOG_FAR * 0.92;
  const fogColor = new Float32Array(3);

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
    const keys = input.walkKeys();
    const walk = inputEnabled() ? camera.walkDir(keys) : { x: 0, z: 0 };
    const jump = inputEnabled() && keys.space;
    const yaw = camera.yaw();
    const pitch = camera.pitch();
    if (inputEnabled() && chunks.hasChunkAt(player.state.x, player.state.z)) {
      const next: PlayerInput = { dx: walk.x, dz: walk.z, dtSeconds: inputDt, yaw, pitch, jump };
      room().replicated()?.predict(next);
    }
    camera.setPosition(player.position);

    chunks.update(player.position.x, player.position.z);
    chunks.processIncoming();

    const replicated = room().replicated();
    if (replicated) {
      const entity = replicated.entity as Player;
      entity.collisionQuery = (cx, cz, cy) => chunks.collisionQuery(cx, cz, cy);
      entity.headQuery = (cx, cz, cy) => chunks.headQuery(cx, cz, cy);
    }

    // --- Raycast for block targeting ---
    const eye = camera.eye();
    const lookDir = camera.lookDirection();
    const currentHit = raycastVoxels(eye.x, eye.y, eye.z, lookDir.x, lookDir.y, lookDir.z, 6.0, (wx, wy, wz) =>
      chunks.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz)),
    );
    latestHit = currentHit;

    const viewMatrix = camera.viewMatrix();
    const projMatrix = camera.projMatrix();
    chunks.cull(viewMatrix, projMatrix);

    // --- Remote entities + block acks ---
    const tickInfo = room().tickInfo;
    if (tickInfo.tick !== lastTick) {
      remotePlayers.onSnapshot(unwrap(room().remotePlayers), now);
      lastTick = tickInfo.tick;
      msptHistory.push(tickInfo.tickTimeMs);
      timeOffsetS = tickInfo.timeOfDayS - ((now / 1000) % DAY_LENGTH_S);

      // Queue server-pushed chunk data for incremental ingestion
      for (const chunkBatch of room().chunkDataQueue.splice(0)) {
        chunks.receiveChunks(chunkBatch);
      }

      // Process block acks
      for (const ack of room().blockAckQueue.splice(0)) {
        const pending = pendingBlocks.get(ack.seq);
        if (!pending) continue;
        pendingBlocks.delete(ack.seq);
        if (!ack.accepted) {
          chunks.modifyBlock(pending.x, pending.y, pending.z, pending.previousType);
          chunks.clearLocalOverride(pending.x, pending.y, pending.z);
        }
      }

      // Apply block changes from other players
      const pendingCoords = new Set([...pendingBlocks.values()].map((p) => `${p.x},${p.y},${p.z}`));
      for (const change of room().blockChangesQueue.splice(0)) {
        if (!pendingCoords.has(`${change.x},${change.y},${change.z}`)) {
          chunks.modifyBlock(change.x, change.y, change.z, change.blockType as CubeType);
        }
      }
    }

    const timeOfDayS = (((now / 1000 + timeOffsetS) % DAY_LENGTH_S) + DAY_LENGTH_S) % DAY_LENGTH_S;
    lighting.update(timeOfDayS);
    fogColor.set(lighting.backgroundColor.subarray(0, 3));

    // --- Render ---
    const { buffers, count } = remotePlayers.frame(now);
    const entities: EntityDrawData[] = [{ key: "players", buffers, count }];
    renderer.render({
      viewMatrix,
      projMatrix,
      cubePositions: chunks.positions,
      cubeColors: chunks.colors,
      cubeAmbientOcclusion: chunks.ambientOcclusion,
      numCubes: chunks.count,
      lightPosition: lighting.lightPosition,
      sunPosition: lighting.sunPosition,
      backgroundColor: lighting.backgroundColor,
      ambientColor: lighting.ambientColor,
      sunColor: lighting.sunColor,
      timeS: now / 1000,
      cameraPos: eye,
      fogColor,
      fogNear: FOG_NEAR,
      fogFar: FOG_FAR,
      entities,
      highlightBlock: currentHit ? { x: currentHit.blockX, y: currentHit.blockY, z: currentHit.blockZ } : undefined,
    });

    // --- Diagnostics (producers → store) ---
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
