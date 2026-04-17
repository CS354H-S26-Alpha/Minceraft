import { Mat4, Quat, Vec3 } from "gl-matrix";
import type { BufferGeometry, MeshLambertMaterial, Object3D, Scene, SkinnedMesh } from "three";
import type { Collada } from "three/examples/jsm/loaders/ColladaLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { Mesh } from "./Mesh.js";

function transformPoint(matrix: Mat4, vector: Vec3): Vec3 {
  return Vec3.transformMat4(new Vec3(), vector, matrix) as Vec3;
}

function transformDirection(matrix: Mat4, vector: Vec3): Vec3 {
  const m0 = matrix[0] ?? 0;
  const m1 = matrix[1] ?? 0;
  const m2 = matrix[2] ?? 0;
  const m4 = matrix[4] ?? 0;
  const m5 = matrix[5] ?? 0;
  const m6 = matrix[6] ?? 0;
  const m8 = matrix[8] ?? 0;
  const m9 = matrix[9] ?? 0;
  const m10 = matrix[10] ?? 0;
  return new Vec3([
    m0 * vector.x + m4 * vector.y + m8 * vector.z,
    m1 * vector.x + m5 * vector.y + m9 * vector.z,
    m2 * vector.x + m6 * vector.y + m10 * vector.z,
  ]);
}

function createVec3(x = 0, y = 0, z = 0): Vec3 {
  return new Vec3([x, y, z]);
}

function getBone(bones: BoneLoader[], index: number): BoneLoader {
  const bone = bones[index];
  if (!bone) {
    throw new Error(`Missing bone at index ${index}`);
  }
  return bone;
}

export class AttributeLoader {
  values: Float32Array;
  count: number;
  itemSize: number;

  constructor(values: Float32Array, count: number, itemSize: number) {
    this.values = values;
    this.count = count;
    this.itemSize = itemSize;
  }
}

export class MeshGeometryLoader {
  position: AttributeLoader;
  normal: AttributeLoader;
  uv: AttributeLoader | null;
  skinIndex: AttributeLoader;
  skinWeight: AttributeLoader;
  v0: AttributeLoader;
  v1: AttributeLoader;
  v2: AttributeLoader;
  v3: AttributeLoader;

  constructor(geometry: BufferGeometry, wMat: Mat4) {
    const gPosition = geometry.attributes.position;
    const gNormal = geometry.attributes.normal;
    const gSkinIndex = geometry.attributes.skinIndex;
    const gSkinWeight = geometry.attributes.skinWeight;

    if (!gPosition || !gNormal || !gSkinIndex || !gSkinWeight) {
      throw new Error("Skinned mesh geometry is missing required attributes");
    }

    this.position = new AttributeLoader(gPosition.array as Float32Array, gPosition.count, gPosition.itemSize);
    this.normal = new AttributeLoader(gNormal.array as Float32Array, gNormal.count, gNormal.itemSize);
    if (geometry.attributes.uv) {
      const gUV = geometry.attributes.uv;
      this.uv = new AttributeLoader(gUV.array as Float32Array, gUV.count, gUV.itemSize);
    } else {
      this.uv = null;
    }
    this.skinIndex = new AttributeLoader(gSkinIndex.array as Float32Array, gSkinIndex.count, gSkinIndex.itemSize);
    this.skinWeight = new AttributeLoader(gSkinWeight.array as Float32Array, gSkinWeight.count, gSkinWeight.itemSize);

    this.v0 = new AttributeLoader(new Float32Array(gPosition.array.length), gPosition.count, 4);
    this.v1 = new AttributeLoader(new Float32Array(gPosition.array.length), gPosition.count, 4);
    this.v2 = new AttributeLoader(new Float32Array(gPosition.array.length), gPosition.count, 4);
    this.v3 = new AttributeLoader(new Float32Array(gPosition.array.length), gPosition.count, 4);

    for (let i = 0; i < gPosition.count; i++) {
      const pos = this.position.values.slice(i * 3, i * 3 + 3);
      let vPos = createVec3(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
      vPos = transformPoint(wMat, vPos);
      this.position.values[i * 3] = vPos.x;
      this.position.values[i * 3 + 1] = vPos.y;
      this.position.values[i * 3 + 2] = vPos.z;

      const normals = this.normal.values.slice(i * 3, i * 3 + 3);
      let vNorm = createVec3(normals[0] ?? 0, normals[1] ?? 0, normals[2] ?? 0);
      vNorm = transformDirection(wMat, vNorm);
      this.normal.values[i * 3] = vNorm.x;
      this.normal.values[i * 3 + 1] = vNorm.y;
      this.normal.values[i * 3 + 2] = vNorm.z;
    }
  }

  public setVectorOffsets(bones: BoneLoader[]) {
    for (let i = 0; i < this.position.count; i++) {
      let bonePos = new Vec3();
      const pos = this.position.values.slice(i * 3, i * 3 + 3);
      const vertexPos = createVec3(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);

      bonePos = Vec3.clone(getBone(bones, Math.trunc(this.skinIndex.values[i * 4] ?? 0)).position);
      Vec3.subtract(bonePos, vertexPos, bonePos);
      this.v0.values[i * 3] = bonePos.x;
      this.v0.values[i * 3 + 1] = bonePos.y;
      this.v0.values[i * 3 + 2] = bonePos.z;
      this.v0.values[i * 3 + 3] = 0;
      bonePos = Vec3.clone(getBone(bones, Math.trunc(this.skinIndex.values[i * 4 + 1] ?? 0)).position);
      Vec3.subtract(bonePos, vertexPos, bonePos);
      this.v1.values[i * 3] = bonePos.x;
      this.v1.values[i * 3 + 1] = bonePos.y;
      this.v1.values[i * 3 + 2] = bonePos.z;
      this.v1.values[i * 3 + 3] = 0;
      bonePos = Vec3.clone(getBone(bones, Math.trunc(this.skinIndex.values[i * 4 + 2] ?? 0)).position);
      Vec3.subtract(bonePos, vertexPos, bonePos);
      this.v2.values[i * 3] = bonePos.x;
      this.v2.values[i * 3 + 1] = bonePos.y;
      this.v2.values[i * 3 + 2] = bonePos.z;
      this.v2.values[i * 3 + 3] = 0;
      bonePos = Vec3.clone(getBone(bones, Math.trunc(this.skinIndex.values[i * 4 + 3] ?? 0)).position);
      Vec3.subtract(bonePos, vertexPos, bonePos);
      this.v3.values[i * 3] = bonePos.x;
      this.v3.values[i * 3 + 1] = bonePos.y;
      this.v3.values[i * 3 + 2] = bonePos.z;
      this.v3.values[i * 3 + 3] = 0;
    }
  }
}

export class BoneLoader {
  public parent: number;
  public children: number[];
  public position: Vec3;
  public endpoint: Vec3;
  public rotation: Quat;
  public initialPosition: Vec3;
  public initialEndpoint: Vec3;
  public offset: number;
  public initialTransformation: Mat4;

  constructor(parentId: number, childrenIds: number[], offset: number, wmat: Mat4) {
    this.parent = parentId;
    this.children = childrenIds;
    this.position = transformPoint(wmat, new Vec3([0, 0, 0]));
    this.initialPosition = Vec3.clone(this.position);
    this.endpoint = transformPoint(wmat, new Vec3([0, offset, 0]));
    this.initialEndpoint = Vec3.clone(this.endpoint);
    this.rotation = new Quat().identity();
    this.offset = offset;
    this.initialTransformation = Mat4.clone(wmat);
  }
}
export class MeshLoader {
  public geometry: MeshGeometryLoader;
  public worldMatrix: Mat4;
  public rotation: Vec3;
  public bones: BoneLoader[];
  public materialName: string;

  public boneIndices: number[];
  public bonePositions: Float32Array;
  public boneIndexAttribute: Float32Array;

  public name: string;

  constructor(skinnedMesh: SkinnedMesh) {
    this.name = skinnedMesh.name;

    let x = skinnedMesh.rotation.x;
    let y = skinnedMesh.rotation.y;
    let z = skinnedMesh.rotation.z;
    this.rotation = new Vec3([x, y, z]);
    let rotMat = new Mat4().identity();
    rotMat.rotateX(x);
    rotMat.rotateY(y);
    rotMat.rotateZ(z);
    rotMat.multiply(new Mat4(skinnedMesh.bindMatrix.elements));
    this.worldMatrix = rotMat;
    this.geometry = new MeshGeometryLoader(skinnedMesh.geometry as BufferGeometry, this.worldMatrix);
    this.bones = [];
    this.boneIndices = [];
    this.bonePositions = new Float32Array([]);
    this.boneIndexAttribute = new Float32Array([]);

    let material = skinnedMesh.material as MeshLambertMaterial;
    this.materialName = material.name;

    skinnedMesh.skeleton.bones.forEach((bone) => {
      if (bone.rotation.order !== "XYZ") {
        console.error("BONE ORDER NOT XYZ");
      }
      let parentId: number = -1;
      if (bone.parent?.type !== "SkinnedMesh") {
        let uuid: string = "";
        if (bone.parent?.uuid) {
          uuid = bone.parent?.uuid;
        }
        for (let i = 0; i < skinnedMesh.skeleton.bones.length; i++) {
          const skeletonBone = skinnedMesh.skeleton.bones[i];
          if (skeletonBone?.uuid === uuid) {
            parentId = i;
          }
        }
      }
      let children: number[] = [];
      bone.children.forEach((child) => {
        let uuid: string = child.uuid;
        for (let i = 0; i < skinnedMesh.skeleton.bones.length; i++) {
          const skeletonBone = skinnedMesh.skeleton.bones[i];
          if (skeletonBone?.uuid === uuid) {
            children.push(i);
          }
        }
      });
      let tMat = bone.matrixWorld.clone();
      let tempMat = new Mat4(tMat.elements);
      let yVal = 1;
      const firstChild = children[0];
      if (firstChild !== undefined) {
        yVal = skinnedMesh.skeleton.bones[firstChild]?.position.y ?? 1;
      }
      this.bones.push(new BoneLoader(parentId, children, yVal, tempMat));
    });

    if (this.bones.length > 0) {
      this.initialize();
      this.geometry.setVectorOffsets(this.bones);
    }
  }

  private initialize(): void {
    this.boneIndices = [];
    this.bonePositions = new Float32Array(6 * this.bones.length);
    this.boneIndexAttribute = new Float32Array(2 * this.bones.length);
    this.bones.forEach((bone, index) => {
      this.boneIndices.push(2 * index);
      this.boneIndices.push(2 * index + 1);
      this.boneIndexAttribute[2 * index] = index;
      this.boneIndexAttribute[2 * index + 1] = index;
      this.bonePositions[index * 6] = 0;
      this.bonePositions[index * 6 + 1] = 0;
      this.bonePositions[index * 6 + 2] = 0;
      this.bonePositions[index * 6 + 3] = bone.initialEndpoint.x - bone.initialPosition.x;
      this.bonePositions[index * 6 + 4] = bone.initialEndpoint.y - bone.initialPosition.y;
      this.bonePositions[index * 6 + 5] = bone.initialEndpoint.z - bone.initialPosition.z;
    });
  }
}
class CLoader {
  private fileLocation: string;
  private loader: ColladaLoader;
  private scene: Scene | null;
  private skinnedMeshes: SkinnedMesh[];
  public meshes: Mesh[];

  constructor(location: string) {
    this.fileLocation = location;
    this.loader = new ColladaLoader();
    this.scene = null;
    this.skinnedMeshes = [];
    this.meshes = [];
  }

  public load(callback: () => void): void {
    this.loader.load(
      this.fileLocation,
      (collada: Collada | null) => {
        if (!collada) {
          throw new Error(`Failed to parse Collada file at ${this.fileLocation}`);
        }
        console.log("File loaded successfully");
        collada.scene.updateWorldMatrix(true, true);
        console.log(collada);
        this.scene = collada.scene;
        this.findSkinnedMeshes();
        this.skinnedMeshes.forEach((m) => {
          this.meshes.push(new Mesh(new MeshLoader(m)));
        });

        // getting the images
        const lib = collada.library as Collada["library"];
        if (!lib) {
          callback();
          return;
        }
        let mats = lib.materials;
        let imgs = lib.images;
        let effects = lib.effects;
        let matToTexture = new Map<string, string>();
        for (let property in effects) {
          let matName = "";
          for (let matProp in mats) {
            const material = mats[matProp] as { url?: string; name?: string };
            if (material.url === property) {
              matName = material.name ?? "";
              break;
            }
          }

          let imgName = "";
          const effect = effects[property] as { profile?: { surfaces?: Record<string, { init_from?: string }> } };
          for (let imgProp in effect.profile?.surfaces) {
            const surface = effect.profile?.surfaces?.[imgProp];
            imgName = surface?.init_from ?? "";
          }

          let imgSrc = "";
          for (let imgProp in imgs) {
            if (imgName === imgProp) {
              imgSrc = (imgs[imgProp] as { init_from?: string }).init_from ?? "";
              break;
            }
          }

          if (imgSrc === "" || !imgSrc) {
            console.log("Image source not found");
          } else {
            matToTexture.set(matName, imgSrc);
          }

          this.meshes.forEach((mesh) => {
            let imgSrc = matToTexture.get(mesh.materialName);
            if (imgSrc) {
              mesh.imgSrc = imgSrc;
            }
          });
        }
        callback();
      },
      undefined,
      (event) => {
        console.error("Loading collada file failed");
        console.error(event);
      },
    );
  }

  private findSkinnedMeshes(element?: Object3D): void {
    if (this.scene == null) {
      console.error("Error loading scene");
      throw new Error("Scene was null when finding skinned meshes");
    }
    let objArr: Object3D[];
    if (element) {
      objArr = element.children;
    } else {
      objArr = this.scene.children;
    }
    objArr.forEach((child) => {
      if (element) {
        child.rotateX(element.rotation.x);
        child.rotateY(element.rotation.y);
        child.rotateZ(element.rotation.z);
      } else if (this.scene) {
        child.rotateX(this.scene.rotation.x);
        child.rotateY(this.scene.rotation.y);
        child.rotateZ(this.scene.rotation.z);
      }
      if (child.type === "SkinnedMesh") {
        this.skinnedMeshes.push(child as SkinnedMesh);
      } else {
        this.findSkinnedMeshes(child);
      }
    });
  }
}

export { CLoader as CLoader };
