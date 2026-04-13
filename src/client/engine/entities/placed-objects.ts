import type { PlacedObject } from "@/game/object-placement";
import { Quad } from "../render/quad";
import placedObjectFSText from "../render/shaders/placedObject.frag";
import placedObjectVSText from "../render/shaders/placedObject.vert";
import type { EntityPassDef, GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";

const quad = new Quad();

export function packPlacedObjects(objects: readonly PlacedObject[], buffers: GpuBuffers): number {
  const count = objects.length;
  const offsets = ensureBuffer(buffers, "aOffset", count * 4);
  const scales = ensureBuffer(buffers, "aScale", count);

  for (let i = 0; i < count; i++) {
    const object = objects[i];
    if (!object) continue;
    offsets[i * 4] = object.x;
    offsets[i * 4 + 1] = object.y;
    offsets[i * 4 + 2] = object.z;
    offsets[i * 4 + 3] = object.renderTypeIndex;
    scales[i] = object.scale;
  }

  return count;
}

export const placedObjectPassDef: EntityPassDef = {
  key: "placed-objects",
  vertexShader: placedObjectVSText,
  fragmentShader: placedObjectFSText,
  geometry: {
    positions: quad.positionsFlat(),
    indices: quad.indicesFlat(),
    normals: quad.normalsFlat(),
    uvs: quad.uvFlat(),
  },
  instancedAttributes: [
    { name: "aOffset", size: 4 },
    { name: "aScale", size: 1 },
  ],
  cullFace: false,
};
