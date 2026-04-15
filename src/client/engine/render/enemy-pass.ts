import type { Mat4 } from "gl-matrix";
import { RenderPass } from "@/lib/webglutils/RenderPass";
import type { Mesh } from "../skinning/Mesh";
import enemyFSText from "./shaders/enemy.frag";
import enemyVSText from "./shaders/enemy.vert";

/**
 * Per-frame inputs for drawing one enemy. Camera / lighting values come from
 * the same Renderer that draws the terrain; offset + bone pose are per-enemy.
 */
export interface EnemyDrawState {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  lightPosition: Float32Array;
  ambientColor: Float32Array;
  sunColor: Float32Array;
  offset: Float32Array; // world-space (x, y, z)
  yaw: number; // facing direction (radians), rotates mesh around Y
  boneTranslations: Float32Array; // 3 * boneCount
  boneRotations: Float32Array; // 4 * boneCount
}

/**
 * One draw call per enemy using a skinned-mesh shader.
 */
export class EnemyPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly pass: RenderPass;
  private loaded = false;

  // Mutable state read by uniform bind callbacks at draw time.
  private state: EnemyDrawState = {
    viewMatrix: new Float32Array(16) as unknown as Mat4,
    projMatrix: new Float32Array(16) as unknown as Mat4,
    lightPosition: new Float32Array(4),
    ambientColor: new Float32Array(3),
    sunColor: new Float32Array(3),
    offset: new Float32Array(3),
    yaw: 0,
    boneTranslations: new Float32Array(0),
    boneRotations: new Float32Array(0),
  };

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.pass = new RenderPass(gl, enemyVSText, enemyFSText);
    this.addUniforms();
  }

  /**
   * One-time setup once the robot mesh has finished loading. Must be called
   * before draw().
   */
  loadMesh(mesh: Mesh): void {
    if (this.loaded) return;
    const gl = this.gl;
    const geo = mesh.geometry;

    // Non-indexed mesh: fabricate a sequential index buffer matching the
    // face-order vertex layout we get from ColladaLoader.
    const faceCount = geo.position.count / 3;
    const indices = new Uint32Array(faceCount * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    this.pass.setIndexBufferData(indices);

    const F = Float32Array.BYTES_PER_ELEMENT;
    // aVertPos is intentionally not bound: the shader skins purely from v0..v3
    // and never references the rest-pose position, so the GLSL compiler
    // strips the attribute. Binding it would trigger INVALID_VALUE.
    this.pass.addAttribute("aNorm", 3, gl.FLOAT, false, 3 * F, 0, undefined, geo.normal.values);
    const uvData = geo.uv ? geo.uv.values : new Float32Array((geo.position.count * 2) | 0);
    this.pass.addAttribute("aUV", 2, gl.FLOAT, false, 2 * F, 0, undefined, uvData);
    this.pass.addAttribute("skinIndices", 4, gl.FLOAT, false, 4 * F, 0, undefined, geo.skinIndex.values);
    this.pass.addAttribute("skinWeights", 4, gl.FLOAT, false, 4 * F, 0, undefined, geo.skinWeight.values);
    // v0..v3 are stored as 3 floats/vert (mannequin convention); GLSL reads
    // them as vec4 with w implicitly = 1, and the shader uses .xyz.
    this.pass.addAttribute("v0", 3, gl.FLOAT, false, 3 * F, 0, undefined, geo.v0.values);
    this.pass.addAttribute("v1", 3, gl.FLOAT, false, 3 * F, 0, undefined, geo.v1.values);
    this.pass.addAttribute("v2", 3, gl.FLOAT, false, 3 * F, 0, undefined, geo.v2.values);
    this.pass.addAttribute("v3", 3, gl.FLOAT, false, 3 * F, 0, undefined, geo.v3.values);

    this.pass.setDrawData(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    this.pass.setup();
    this.loaded = true;
  }

  draw(next: EnemyDrawState): void {
    if (!this.loaded) return;
    this.state = next;
    this.pass.draw();
  }

  private addUniforms(): void {
    this.pass.addUniform("uView", (gl, loc) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.state.viewMatrix));
    });
    this.pass.addUniform("uProj", (gl, loc) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.state.projMatrix));
    });
    this.pass.addUniform("uLightPos", (gl, loc) => {
      gl.uniform4fv(loc, this.state.lightPosition);
    });
    this.pass.addUniform("uAmbient", (gl, loc) => {
      gl.uniform3fv(loc, this.state.ambientColor);
    });
    this.pass.addUniform("uSunColor", (gl, loc) => {
      gl.uniform3fv(loc, this.state.sunColor);
    });
    this.pass.addUniform("uOffset", (gl, loc) => {
      gl.uniform3fv(loc, this.state.offset);
    });
    this.pass.addUniform("uYaw", (gl, loc) => {
      gl.uniform1f(loc, this.state.yaw);
    });
    this.pass.addUniform("jTrans", (gl, loc) => {
      gl.uniform3fv(loc, this.state.boneTranslations);
    });
    this.pass.addUniform("jRots", (gl, loc) => {
      gl.uniform4fv(loc, this.state.boneRotations);
    });
  }
}
