import { createEffect, createMemo, For, Show } from "solid-js";
import playerIcon from "@/assets/icons/player.png";
import { CHUNK_HEIGHT } from "@/game/chunk";
import type { Player, PlayerPublicState } from "@/game/player";
import type { MinimapApi } from "../engine/create-game";
import { CUBE_TYPE_INFO, type CubeType } from "../engine/render/cube-types";

interface MinimapProps {
  player: () => Player | undefined;
  players: () => Readonly<Record<string, PlayerPublicState>>;
  minimap: MinimapApi;
  hidden?: boolean;
}

const MINIMAP_RESOLUTION = 128;
const MINIMAP_RADIUS = MINIMAP_RESOLUTION / 2;
const BLOCKS_PER_PIXEL = 2;
const MINIMAP_WORLD_RADIUS = MINIMAP_RADIUS * BLOCKS_PER_PIXEL;
const UNLOADED_PIXEL = [13, 21, 26] as const;
const BLOCK_COLORS = Array.from({ length: Math.max(...Object.keys(CUBE_TYPE_INFO).map(Number)) + 1 }, (_, index) => {
  const info = CUBE_TYPE_INFO[index as CubeType];
  if (!info) return UNLOADED_PIXEL;
  const [r, g, b] = info.baseColor;
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)] as const;
});

export function Minimap(props: MinimapProps) {
  let canvas: HTMLCanvasElement | undefined;
  const pixels = new Uint8ClampedArray(MINIMAP_RESOLUTION * MINIMAP_RESOLUTION * 4);
  let imageData: ImageData | undefined;
  let lastTerrainVersion = -1;
  let lastCenterBlockX = NaN;
  let lastCenterBlockZ = NaN;

  const visiblePlayers = createMemo(() => {
    const self = props.player();
    if (!self) return [];

    const centerX = self.state.x;
    const centerZ = self.state.z;
    const markers: { id: string; name: string; left: number; top: number }[] = [];

    for (const other of Object.values(props.players())) {
      const dx = other.x - centerX;
      const dz = other.z - centerZ;
      if (Math.abs(dx) > MINIMAP_WORLD_RADIUS || Math.abs(dz) > MINIMAP_WORLD_RADIUS) continue;
      markers.push({
        id: other.id,
        name: other.name,
        left: ((dx + MINIMAP_WORLD_RADIUS) / (MINIMAP_WORLD_RADIUS * 2)) * 100,
        top: ((dz + MINIMAP_WORLD_RADIUS) / (MINIMAP_WORLD_RADIUS * 2)) * 100,
      });
    }

    return markers;
  });

  createEffect(() => {
    const terrainVersion = props.minimap.terrainVersion();
    const self = props.player();
    if (!canvas || !self) return;

    const centerBlockX = Math.floor(self.state.x / BLOCKS_PER_PIXEL) * BLOCKS_PER_PIXEL;
    const centerBlockZ = Math.floor(self.state.z / BLOCKS_PER_PIXEL) * BLOCKS_PER_PIXEL;
    if (
      terrainVersion === lastTerrainVersion &&
      centerBlockX === lastCenterBlockX &&
      centerBlockZ === lastCenterBlockZ
    ) {
      return;
    }

    lastTerrainVersion = terrainVersion;
    lastCenterBlockX = centerBlockX;
    lastCenterBlockZ = centerBlockZ;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    imageData ??= new ImageData(pixels, MINIMAP_RESOLUTION, MINIMAP_RESOLUTION);
    const startX = centerBlockX - MINIMAP_WORLD_RADIUS;
    const startZ = centerBlockZ - MINIMAP_WORLD_RADIUS;
    let offset = 0;

    for (let z = 0; z < MINIMAP_RESOLUTION; z++) {
      const baseWz = startZ + z * BLOCKS_PER_PIXEL;
      for (let x = 0; x < MINIMAP_RESOLUTION; x++) {
        const baseWx = startX + x * BLOCKS_PER_PIXEL;
        writeFilteredPixel(pixels, offset, props.minimap.sampleSurface, baseWx, baseWz);
        offset += 4;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  });

  return (
    <Show when={!props.hidden && props.player()}>
      {(player) => (
        <div class="pointer-events-none absolute top-4 left-4 z-30">
          <div class="rounded-sm border-2 border-[#24190c] bg-[rgba(25,20,14,0.88)] p-2 shadow-[0_10px_24px_rgba(0,0,0,0.38)]">
            <div class="mb-2 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#f1df9f]">
              <span>Minimap</span>
              <span>
                {Math.floor(player().state.x)}, {Math.floor(player().state.z)}
              </span>
            </div>

            <div class="relative h-48 w-48 overflow-hidden border border-white/15 bg-[#0b1418] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              <canvas
                ref={canvas}
                class="h-full w-full [image-rendering:pixelated]"
                height={MINIMAP_RESOLUTION}
                width={MINIMAP_RESOLUTION}
              />

              <div class="pointer-events-none absolute inset-0">
                <div class="absolute inset-x-0 top-1 flex justify-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/75">
                  N
                </div>
                <div class="absolute inset-y-0 right-1 flex items-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/65">
                  E
                </div>
                <div class="absolute inset-x-0 bottom-1 flex justify-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/65">
                  S
                </div>
                <div class="absolute inset-y-0 left-1 flex items-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/65">
                  W
                </div>

                <div class="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/80 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
                <div
                  class="absolute top-1/2 left-1/2 h-4 w-0.5 origin-bottom rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
                  style={{ transform: `translate(-50%, -100%) rotate(${player().state.yaw}rad)` }}
                />

                <For each={visiblePlayers()}>
                  {(marker) => (
                    <img
                      alt={marker.name}
                      class="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 [image-rendering:pixelated] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                      src={playerIcon}
                      style={{ left: `${marker.left}%`, top: `${marker.top}%` }}
                      title={marker.name}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

function writeFilteredPixel(
  buffer: Uint8ClampedArray,
  offset: number,
  sampleSurface: (wx: number, wz: number) => number | undefined,
  baseWx: number,
  baseWz: number,
) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let sz = 0; sz < BLOCKS_PER_PIXEL; sz++) {
    for (let sx = 0; sx < BLOCKS_PER_PIXEL; sx++) {
      const sample = sampleSurface(baseWx + sx, baseWz + sz);
      if (sample === undefined) continue;
      const blockType = sample >> 8;
      const height = sample & 0xff;
      const baseColor = BLOCK_COLORS[blockType] ?? UNLOADED_PIXEL;
      const brightness = 0.72 + (height / CHUNK_HEIGHT) * 0.38;
      r += baseColor[0] * brightness;
      g += baseColor[1] * brightness;
      b += baseColor[2] * brightness;
      count++;
    }
  }

  if (count === 0) {
    buffer[offset] = UNLOADED_PIXEL[0];
    buffer[offset + 1] = UNLOADED_PIXEL[1];
    buffer[offset + 2] = UNLOADED_PIXEL[2];
  } else {
    buffer[offset] = clampByte(r / count);
    buffer[offset + 1] = clampByte(g / count);
    buffer[offset + 2] = clampByte(b / count);
  }
  buffer[offset + 3] = 255;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
