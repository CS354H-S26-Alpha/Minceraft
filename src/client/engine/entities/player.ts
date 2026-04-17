import type { PlayerPublicState } from "@/game/player";
import playerFSText from "../render/shaders/player.frag";
import playerVSText from "../render/shaders/player.vert";
import type { EntityPassDef, EntityPipelineConfig } from "./pipeline";
import { createPlayerModelGeometry } from "./player-model";
import { interpolatePlayerRenderState, type PlayerRenderState, packPlayerRenderStates } from "./player-render-state";

const playerGeometry = createPlayerModelGeometry();

export const playerPipelineConfig: EntityPipelineConfig<PlayerPublicState, PlayerRenderState> = {
  interpolate: interpolatePlayerRenderState,
  pack: packPlayerRenderStates,
};

export const playerPassDef: EntityPassDef = {
  key: "players",
  vertexShader: playerVSText,
  fragmentShader: playerFSText,
  geometry: playerGeometry,
  instancedAttributes: [
    { name: "aOffset", size: 4 },
    { name: "aPitch", size: 1 },
    { name: "aMotion", size: 2 },
    { name: "aShirtColor", size: 3 },
  ],
};
