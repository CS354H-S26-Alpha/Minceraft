import { type PlacedObject, PlacedObjectType } from "@/game/object-placement";
import { LowPolyRock } from "../render/low-poly-rock";
import placedRockFSText from "../render/shaders/placedRock.frag";
import placedRockVSText from "../render/shaders/placedRock.vert";
import type { EntityPassDef, GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";

const rock = new LowPolyRock();

export function packPlacedRocks(objects: readonly PlacedObject[], buffers: GpuBuffers): number {
  const rocks = objects.filter((object) => object.type === PlacedObjectType.Rock);
  const count = rocks.length;
  const offsets = ensureBuffer(buffers, "aOffset", count * 4);
  const scales = ensureBuffer(buffers, "aScale", count);

  for (let i = 0; i < count; i++) {
    const object = rocks[i];
    if (!object) continue;
    offsets[i * 4] = object.x;
    offsets[i * 4 + 1] = object.y;
    offsets[i * 4 + 2] = object.z;
    offsets[i * 4 + 3] = object.rotationY;
    scales[i] = object.scale;
  }

  return count;
}

export const placedRockPassDef: EntityPassDef = {
  key: "placed-rocks",
  vertexShader: placedRockVSText,
  fragmentShader: placedRockFSText,
  geometry: {
    positions: rock.positionsFlat(),
    indices: rock.indicesFlat(),
    normals: rock.normalsFlat(),
    uvs: rock.uvFlat(),
  },
  instancedAttributes: [
    { name: "aOffset", size: 4 },
    { name: "aScale", size: 1 },
  ],
  cullFace: true,
};
