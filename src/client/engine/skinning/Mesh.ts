import { Mat4, Quat, Vec3 } from "gl-matrix";
import type { AttributeLoader, BoneLoader, MeshGeometryLoader, MeshLoader } from "./AnimationFileLoader.js";
//TODO: Generate cylinder geometry for highlighting bones

//General class for handling GLSL attributes
export class Attribute {
  values: Float32Array;
  count: number;
  itemSize: number;

  constructor(attr: AttributeLoader) {
    this.values = attr.values;
    this.count = attr.count;
    this.itemSize = attr.itemSize;
  }
}

//Class for handling mesh vertices and skin weights
export class MeshGeometry {
  position: Attribute;
  normal: Attribute;
  uv: Attribute | null = null;
  skinIndex: Attribute; // bones indices that affect each vertex
  skinWeight: Attribute; // weight of associated bone
  v0: Attribute; // position of each vertex of the mesh *in the coordinate system of bone skinIndex[0]'s joint*. Perhaps useful for LBS.
  v1: Attribute;
  v2: Attribute;
  v3: Attribute;

  constructor(mesh: MeshGeometryLoader) {
    this.position = new Attribute(mesh.position);
    this.normal = new Attribute(mesh.normal);
    if (mesh.uv) {
      this.uv = new Attribute(mesh.uv);
    }
    this.skinIndex = new Attribute(mesh.skinIndex);
    this.skinWeight = new Attribute(mesh.skinWeight);
    this.v0 = new Attribute(mesh.v0);
    this.v1 = new Attribute(mesh.v1);
    this.v2 = new Attribute(mesh.v2);
    this.v3 = new Attribute(mesh.v3);
  }
}

//Class for handling bones in the skeleton rig
export class Bone {
  public parent: number;
  public children: number[];
  public position: Vec3; // current position of the bone's joint *in world coordinates*. Used by the provided skeleton shader, so you need to keep this up to date.
  public endpoint: Vec3; // current position of the bone's second (non-joint) endpoint, in world coordinates
  public rotation: Quat; // current orientation of the joint *with respect to world coordinates*

  public initialPosition: Vec3; //rest joint position
  public initialEndpoint: Vec3; //rest endpoint
  public localRotation: Quat; // R_i

  constructor(bone: BoneLoader) {
    this.parent = bone.parent;
    this.children = Array.from(bone.children);
    this.position = Vec3.clone(bone.position);
    this.endpoint = Vec3.clone(bone.endpoint);
    this.rotation = Quat.clone(bone.rotation);

    this.initialPosition = Vec3.clone(bone.position);
    this.initialEndpoint = Vec3.clone(bone.endpoint);
    this.localRotation = new Quat().identity();
  }
}

//Class for handling the overall mesh and rig
export class Mesh {
  public geometry: MeshGeometry;
  public worldMatrix: Mat4; // in this project all meshes and rigs have been transformed into world coordinates for you
  public rotation: Vec3;
  public bones: Bone[];
  public materialName: string;
  public imgSrc: String | null;

  private boneIndices: number[];
  private bonePositions: Float32Array;
  private boneIndexAttribute: Float32Array;

  constructor(mesh: MeshLoader) {
    this.geometry = new MeshGeometry(mesh.geometry);
    this.worldMatrix = Mat4.clone(mesh.worldMatrix);
    this.rotation = Vec3.clone(mesh.rotation);
    this.bones = [];
    mesh.bones.forEach((bone) => {
      this.bones.push(new Bone(bone));
    });
    this.materialName = mesh.materialName;
    this.imgSrc = null;
    this.boneIndices = Array.from(mesh.boneIndices);
    this.bonePositions = new Float32Array(mesh.bonePositions);
    this.boneIndexAttribute = new Float32Array(mesh.boneIndexAttribute);
  }

  //TODO: Create functionality for bone manipulation/key-framing

  private getBone(index: number): Bone {
    const bone = this.bones[index];
    if (!bone) {
      throw new Error(`Missing bone at index ${index}`);
    }
    return bone;
  }

  //Rotates bone by world-space dR. Updates hierarchy
  public rotateBone(boneIndex: number, dR: Quat): void {
    const bone = this.getBone(boneIndex);

    let localDR: Quat;
    if (bone.parent >= 0) {
      //non root
      const parentWorldRot = this.getBone(bone.parent).rotation;
      const parentInv = Quat.conjugate(new Quat(), parentWorldRot) as Quat;
      localDR = Quat.multiply(new Quat(), Quat.multiply(new Quat(), parentInv, dR), parentWorldRot) as Quat; //rotation in parents frame
    } else {
      localDR = Quat.clone(dR); //root bone case
    }

    //rotate
    bone.localRotation = Quat.multiply(new Quat(), localDR, bone.localRotation) as Quat;
    Quat.normalize(bone.localRotation, bone.localRotation);

    //recompute subtree rooted at bone
    this.updateBoneTransform(boneIndex);
  }

  // Translates a root bone and all descendants by a world-space displacement
  public translateRootBone(boneIndex: number, displacement: Vec3): void {
    const bone = this.getBone(boneIndex);
    if (bone.parent !== -1) return; // only root bones can be translated
    this.translateSubtree(boneIndex, displacement);
    this.updateBoneTransform(boneIndex);
  }

  private translateSubtree(boneIndex: number, displacement: Vec3): void {
    const bone = this.getBone(boneIndex);
    bone.initialPosition.add(displacement);
    bone.initialEndpoint.add(displacement);
    for (const childIdx of bone.children) {
      this.translateSubtree(childIdx, displacement);
    }
  }

  // /**
  //  * Recomputes world-space position, endpoint, and rotation for all bones
  //  * from the hierarchical local rotations (D_i = D_parent * T * R_i).
  //  */
  // public updateWorldTransforms(): void {
  //   for (let i = 0; i < this.bones.length; i++) {
  //     if (this.bones[i].parent === -1) {
  //       this.updateBoneTransform(i);
  //     }
  //   }
  // }

  private updateBoneTransform(boneIndex: number): void {
    const bone = this.getBone(boneIndex);

    if (bone.parent === -1) {
      //base case
      bone.rotation = Quat.clone(bone.localRotation);
      bone.position = Vec3.clone(bone.initialPosition);
    } else {
      const parent = this.getBone(bone.parent);
      //Q_i = Q_parent * R_i
      bone.rotation = Quat.multiply(new Quat(), parent.rotation, bone.localRotation) as Quat;
      Quat.normalize(bone.rotation, bone.rotation);

      const restOffset = Vec3.subtract(new Vec3(), bone.initialPosition, parent.initialPosition) as Vec3; //dist btw joints
      const rotatedOffset = Vec3.transformQuat(new Vec3(), restOffset, parent.rotation) as Vec3;
      bone.position = Vec3.add(new Vec3(), parent.position, rotatedOffset) as Vec3;
    }

    const localEndOffset = Vec3.subtract(new Vec3(), bone.initialEndpoint, bone.initialPosition) as Vec3;
    const rotatedEndOffset = Vec3.transformQuat(new Vec3(), localEndOffset, bone.rotation) as Vec3;
    bone.endpoint = Vec3.add(new Vec3(), bone.position, rotatedEndOffset) as Vec3;

    //recurse
    for (const childIdx of bone.children) {
      this.updateBoneTransform(childIdx);
    }
  }

  public getBoneIndices(): Uint32Array {
    return new Uint32Array(this.boneIndices);
  }

  public getBonePositions(): Float32Array {
    return this.bonePositions;
  }

  public getBoneIndexAttribute(): Float32Array {
    return this.boneIndexAttribute;
  }

  public getBoneTranslations(): Float32Array {
    let trans = new Float32Array(3 * this.bones.length);
    this.bones.forEach((bone, index) => {
      trans[3 * index] = bone.position.x;
      trans[3 * index + 1] = bone.position.y;
      trans[3 * index + 2] = bone.position.z;
    });
    return trans;
  }

  public getBoneRotations(): Float32Array {
    let trans = new Float32Array(4 * this.bones.length);
    this.bones.forEach((bone, index) => {
      trans[4 * index] = bone.rotation.x;
      trans[4 * index + 1] = bone.rotation.y;
      trans[4 * index + 2] = bone.rotation.z;
      trans[4 * index + 3] = bone.rotation.w;
    });
    return trans;
  }
}
