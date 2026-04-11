import type { Mat4, Vec4 } from "gl-matrix";
import { WebGLUtilities } from "~/lib/webglutils/CanvasAnimation";
import { RenderPass } from "~/lib/webglutils/RenderPass";
import { Cube } from "./cube";
import { Quad } from "./quad";
import blankCubeFSText from "./shaders/blankCube.frag";
import blankCubeVSText from "./shaders/blankCube.vert";
import playerFSText from "./shaders/player.frag";
import playerVSText from "./shaders/player.vert";

export interface RenderView {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  cubePositions: Float32Array;
  numCubes: number;
  lightPosition: Vec4;
  backgroundColor: Vec4;
  playerPositions: Float32Array;
  playerPitches: Float32Array;
  numPlayers: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: WebGLRenderingContext;
  private readonly cubeGeometry: Cube;
  private readonly blankCubeRenderPass: RenderPass;
  private readonly quadGeometry: Quad;
  private readonly playerRenderPass: RenderPass;

  private currentView!: RenderView;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = WebGLUtilities.requestWebGLContext(canvas);
    WebGLUtilities.requestIntIndicesExt(this.ctx);
    const extVAO = WebGLUtilities.requestVAOExt(this.ctx);

    this.cubeGeometry = new Cube();
    this.blankCubeRenderPass = new RenderPass(extVAO, this.ctx, blankCubeVSText, blankCubeFSText);
    this.initBlankCubePass();

    this.quadGeometry = new Quad();
    this.playerRenderPass = new RenderPass(extVAO, this.ctx, playerVSText, playerFSText);
    this.initPlayerPass();
  }

  render(view: RenderView): void {
    this.currentView = view;

    const gl = this.ctx;
    const bg = view.backgroundColor;
    gl.clearColor(bg.r, bg.g, bg.b, bg.a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.blankCubeRenderPass.updateAttributeBuffer("aOffset", view.cubePositions);
    this.blankCubeRenderPass.drawInstanced(view.numCubes);

    if (view.numPlayers > 0) {
      gl.disable(gl.CULL_FACE);
      this.playerRenderPass.updateAttributeBuffer("aOffset", view.playerPositions);
      this.playerRenderPass.updateAttributeBuffer("aPitch", view.playerPitches);
      this.playerRenderPass.drawInstanced(view.numPlayers);
      gl.enable(gl.CULL_FACE);
    }
  }

  private initPlayerPass(): void {
    const gl = this.ctx;
    const pass = this.playerRenderPass;
    const quad = this.quadGeometry;

    pass.setIndexBufferData(quad.indicesFlat());
    pass.addAttribute(
      "aVertPos",
      4,
      gl.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      quad.positionsFlat(),
    );
    pass.addAttribute(
      "aNorm",
      4,
      gl.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      quad.normalsFlat(),
    );
    pass.addAttribute(
      "aUV",
      2,
      gl.FLOAT,
      false,
      2 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      quad.uvFlat(),
    );
    pass.addInstancedAttribute(
      "aOffset",
      4,
      gl.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aPitch",
      1,
      gl.FLOAT,
      false,
      1 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );

    pass.addUniform("uLightPos", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform4fv(loc, this.currentView.lightPosition);
    });
    pass.addUniform("uProj", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.projMatrix));
    });
    pass.addUniform("uView", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.viewMatrix));
    });

    pass.setDrawData(gl.TRIANGLES, quad.indicesFlat().length, gl.UNSIGNED_INT, 0);
    pass.setup();
  }

  private initBlankCubePass(): void {
    const gl = this.ctx;
    const pass = this.blankCubeRenderPass;
    const cube = this.cubeGeometry;

    pass.setIndexBufferData(cube.indicesFlat());
    pass.addAttribute(
      "aVertPos",
      4,
      gl.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      cube.positionsFlat(),
    );
    pass.addAttribute(
      "aNorm",
      4,
      gl.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      cube.normalsFlat(),
    );
    pass.addAttribute(
      "aUV",
      2,
      gl.FLOAT,
      false,
      2 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      cube.uvFlat(),
    );
    pass.addInstancedAttribute(
      "aOffset",
      4,
      gl.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );

    pass.addUniform("uLightPos", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform4fv(loc, this.currentView.lightPosition);
    });
    pass.addUniform("uProj", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.projMatrix));
    });
    pass.addUniform("uView", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.viewMatrix));
    });

    pass.setDrawData(gl.TRIANGLES, cube.indicesFlat().length, gl.UNSIGNED_INT, 0);
    pass.setup();
  }
}
