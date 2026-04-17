import type { EntityPassDef } from "./pipeline";

const PLAYER_HEIGHT = 1.8;
const MODEL_UNIT = PLAYER_HEIGHT / 32;

const HEAD_SIZE = 8 * MODEL_UNIT;
const TORSO_WIDTH = 8 * MODEL_UNIT;
const TORSO_HEIGHT = 12 * MODEL_UNIT;
const LIMB_WIDTH = 4 * MODEL_UNIT;
const LIMB_HEIGHT = 12 * MODEL_UNIT;
const BODY_DEPTH = 4 * MODEL_UNIT;

const HALF_HEAD = HEAD_SIZE / 2;
const HALF_TORSO_WIDTH = TORSO_WIDTH / 2;
const HALF_LIMB_WIDTH = LIMB_WIDTH / 2;
const HALF_BODY_DEPTH = BODY_DEPTH / 2;

const HIP_Y = LIMB_HEIGHT;
const SHOULDER_Y = HIP_Y + TORSO_HEIGHT;
const HEAD_BOTTOM_Y = SHOULDER_Y;
const ARM_SPLIT_Y = SHOULDER_Y - LIMB_HEIGHT / 2;

const PART_HEAD = 0;
const PART_TORSO = 1;
const PART_LEFT_ARM = 2;
const PART_RIGHT_ARM = 3;
const PART_LEFT_LEG = 4;
const PART_RIGHT_LEG = 5;

interface BoxDef {
  part: number;
  pivot: readonly [number, number, number];
  color: readonly [number, number, number];
  shirtMask: number;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

interface MeshBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  shirtMasks: number[];
  parts: number[];
  pivots: number[];
  indices: number[];
}

export function createPlayerModelGeometry(): EntityPassDef["geometry"] {
  const mesh: MeshBuffers = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    shirtMasks: [],
    parts: [],
    pivots: [],
    indices: [],
  };

  const skin = [0.91, 0.77, 0.63] as const;
  const shirt = [0.22, 0.48, 0.82] as const;
  const pants = [0.22, 0.29, 0.62] as const;

  const leftArmCenterX = -(HALF_TORSO_WIDTH + HALF_LIMB_WIDTH);
  const rightArmCenterX = HALF_TORSO_WIDTH + HALF_LIMB_WIDTH;

  const boxes: BoxDef[] = [
    {
      part: PART_HEAD,
      pivot: [0, HEAD_BOTTOM_Y, 0],
      color: skin,
      shirtMask: 0,
      min: [-HALF_HEAD, HEAD_BOTTOM_Y, -HALF_HEAD],
      max: [HALF_HEAD, HEAD_BOTTOM_Y + HEAD_SIZE, HALF_HEAD],
    },
    {
      part: PART_TORSO,
      pivot: [0, SHOULDER_Y, 0],
      color: shirt,
      shirtMask: 1,
      min: [-HALF_TORSO_WIDTH, HIP_Y, -HALF_BODY_DEPTH],
      max: [HALF_TORSO_WIDTH, SHOULDER_Y, HALF_BODY_DEPTH],
    },
    {
      part: PART_LEFT_ARM,
      pivot: [leftArmCenterX, SHOULDER_Y, 0],
      color: shirt,
      shirtMask: 1,
      min: [leftArmCenterX - HALF_LIMB_WIDTH, ARM_SPLIT_Y, -HALF_BODY_DEPTH],
      max: [leftArmCenterX + HALF_LIMB_WIDTH, SHOULDER_Y, HALF_BODY_DEPTH],
    },
    {
      part: PART_LEFT_ARM,
      pivot: [leftArmCenterX, SHOULDER_Y, 0],
      color: skin,
      shirtMask: 0,
      min: [leftArmCenterX - HALF_LIMB_WIDTH, HIP_Y, -HALF_BODY_DEPTH],
      max: [leftArmCenterX + HALF_LIMB_WIDTH, ARM_SPLIT_Y, HALF_BODY_DEPTH],
    },
    {
      part: PART_RIGHT_ARM,
      pivot: [rightArmCenterX, SHOULDER_Y, 0],
      color: shirt,
      shirtMask: 1,
      min: [rightArmCenterX - HALF_LIMB_WIDTH, ARM_SPLIT_Y, -HALF_BODY_DEPTH],
      max: [rightArmCenterX + HALF_LIMB_WIDTH, SHOULDER_Y, HALF_BODY_DEPTH],
    },
    {
      part: PART_RIGHT_ARM,
      pivot: [rightArmCenterX, SHOULDER_Y, 0],
      color: skin,
      shirtMask: 0,
      min: [rightArmCenterX - HALF_LIMB_WIDTH, HIP_Y, -HALF_BODY_DEPTH],
      max: [rightArmCenterX + HALF_LIMB_WIDTH, ARM_SPLIT_Y, HALF_BODY_DEPTH],
    },
    {
      part: PART_LEFT_LEG,
      pivot: [-HALF_LIMB_WIDTH, HIP_Y, 0],
      color: pants,
      shirtMask: 0,
      min: [-LIMB_WIDTH, 0, -HALF_BODY_DEPTH],
      max: [0, HIP_Y, HALF_BODY_DEPTH],
    },
    {
      part: PART_RIGHT_LEG,
      pivot: [HALF_LIMB_WIDTH, HIP_Y, 0],
      color: pants,
      shirtMask: 0,
      min: [0, 0, -HALF_BODY_DEPTH],
      max: [LIMB_WIDTH, HIP_Y, HALF_BODY_DEPTH],
    },
  ];

  for (const box of boxes) {
    appendBox(mesh, box);
  }

  return {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(mesh.indices),
    normals: new Float32Array(mesh.normals),
    uvs: new Float32Array(mesh.uvs),
    extraAttributes: [
      { name: "aColor", size: 3, data: new Float32Array(mesh.colors) },
      { name: "aShirtMask", size: 1, data: new Float32Array(mesh.shirtMasks) },
      { name: "aPart", size: 1, data: new Float32Array(mesh.parts) },
      { name: "aPivot", size: 3, data: new Float32Array(mesh.pivots) },
    ],
  };
}

function appendBox(mesh: MeshBuffers, box: BoxDef): void {
  const [minX, minY, minZ] = box.min;
  const [maxX, maxY, maxZ] = box.max;
  const base = mesh.positions.length / 4;

  const faces = [
    {
      normal: [0, 1, 0, 0],
      indices: [0, 1, 2, 0, 2, 3],
      corners: [
        [minX, maxY, minZ],
        [minX, maxY, maxZ],
        [maxX, maxY, maxZ],
        [maxX, maxY, minZ],
      ],
    },
    {
      normal: [-1, 0, 0, 0],
      indices: [1, 0, 2, 2, 0, 3],
      corners: [
        [minX, maxY, maxZ],
        [minX, minY, maxZ],
        [minX, minY, minZ],
        [minX, maxY, minZ],
      ],
    },
    {
      normal: [1, 0, 0, 0],
      indices: [0, 1, 2, 0, 2, 3],
      corners: [
        [maxX, maxY, maxZ],
        [maxX, minY, maxZ],
        [maxX, minY, minZ],
        [maxX, maxY, minZ],
      ],
    },
    {
      normal: [0, 0, 1, 0],
      indices: [1, 0, 2, 2, 0, 3],
      corners: [
        [maxX, maxY, maxZ],
        [maxX, minY, maxZ],
        [minX, minY, maxZ],
        [minX, maxY, maxZ],
      ],
    },
    {
      normal: [0, 0, -1, 0],
      indices: [0, 1, 2, 0, 2, 3],
      corners: [
        [maxX, maxY, minZ],
        [maxX, minY, minZ],
        [minX, minY, minZ],
        [minX, maxY, minZ],
      ],
    },
    {
      normal: [0, -1, 0, 0],
      indices: [1, 0, 2, 2, 0, 3],
      corners: [
        [minX, minY, minZ],
        [minX, minY, maxZ],
        [maxX, minY, maxZ],
        [maxX, minY, minZ],
      ],
    },
  ] as const;

  const faceUv = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ] as const;

  for (const face of faces) {
    const faceBase = mesh.positions.length / 4;
    for (let i = 0; i < 4; i++) {
      const [x, y, z] = face.corners[i] as readonly [number, number, number];
      const [u, v] = faceUv[i] as readonly [number, number];
      mesh.positions.push(x, y, z, 1);
      mesh.normals.push(...face.normal);
      mesh.uvs.push(u, v);
      mesh.colors.push(...box.color);
      mesh.shirtMasks.push(box.shirtMask);
      mesh.parts.push(box.part);
      mesh.pivots.push(...box.pivot);
    }
    for (const index of face.indices) {
      mesh.indices.push(faceBase + index);
    }
  }

  if (mesh.positions.length / 4 !== base + 24) {
    throw new Error("Player box geometry generation produced an unexpected vertex count");
  }
}
