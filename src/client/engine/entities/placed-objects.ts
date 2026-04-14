import type { PlacedObject } from "@/game/object-placement";
import { CrossQuadCluster } from "../render/cross-quad-cluster";
import placedObjectFSText from "../render/shaders/placedObject.frag";
import placedObjectVSText from "../render/shaders/placedObject.vert";
import type { EntityPassDef, GpuBuffers } from "./pipeline";
import { ensureBuffer } from "./pipeline";

const cluster = new CrossQuadCluster();

export function packPlacedObjects(objects: readonly PlacedObject[], buffers: GpuBuffers): number {
  const count = objects.length;
  const offsets = ensureBuffer(buffers, "aOffset", count * 4);
  const scales = ensureBuffer(buffers, "aScale", count);
  const metas = ensureBuffer(buffers, "aMeta", count * 2);

  for (let i = 0; i < count; i++) {
    const object = objects[i];
    if (!object) continue;
    offsets[i * 4] = object.x;
    offsets[i * 4 + 1] = object.y;
    offsets[i * 4 + 2] = object.z;
    offsets[i * 4 + 3] = 0;
    scales[i] = object.scale;
    metas[i * 2] = object.renderTypeIndex;
    metas[i * 2 + 1] = object.rotationY;
  }

  return count;
}

export const placedObjectPassDef: EntityPassDef = {
  key: "placed-objects",
  vertexShader: placedObjectVSText,
  fragmentShader: placedObjectFSText,
  geometry: {
    positions: cluster.positionsFlat(),
    indices: cluster.indicesFlat(),
    normals: cluster.normalsFlat(),
    uvs: cluster.uvFlat(),
  },
  instancedAttributes: [
    { name: "aOffset", size: 4 },
    { name: "aScale", size: 1 },
    { name: "aMeta", size: 2 },
  ],
  cullFace: false,
};
