import { Mat4, Vec3, Vec4 } from "gl-matrix";
import { CanvasAnimation } from "../lib/webglutils/CanvasAnimation.js";
import { RenderPass } from "../lib/webglutils/RenderPass.js";
import { Chunk } from "./Chunk.js";
import { Cube } from "./Cube.js";
import { GUI } from "./Gui.js";
import { blankCubeFSText, blankCubeVSText, previewCubeFSText, previewCubeVSText } from "./Shaders.js";

const dirtBottomTexture = new URL("../../assets/textures/dirt_bottom.png", import.meta.url).href;
const dirtSideTexture = new URL("../../assets/textures/dirt_side.png", import.meta.url).href;
const dirtTopTexture = new URL("../../assets/textures/dirt_top.png", import.meta.url).href;

export class MinecraftAnimation extends CanvasAnimation {
  private gui: GUI;

  chunk: Chunk;

  /*  Cube Rendering */
  private cubeGeometry: Cube;
  private blankCubeRenderPass: RenderPass;
  private previewCubeRenderPass: RenderPass;
  private previewCubeBottomTexture: WebGLTexture;
  private previewCubeLightDirection: Vec3;
  private previewCubeModelMatrix: Mat4;
  private previewCubeProjectionMatrix: Mat4;
  private previewCubeScreenOffset: Float32Array;
  private previewCubeSideTexture: WebGLTexture;
  private previewCubeTopTexture: WebGLTexture;
  private previewCubeViewMatrix: Mat4;

  /* Global Rendering Info */
  private lightPosition: Vec4;
  private backgroundColor: Vec4;

  private canvas2d: HTMLCanvasElement;

  // Player's head position in world coordinate.
  // Player should extend two units down from this location, and 0.4 units radially.
  private playerPosition: Vec3;

  constructor(canvas: HTMLCanvasElement, textCanvas: HTMLCanvasElement) {
    super(canvas);

    this.canvas2d = textCanvas;

    const gl = this.ctx;

    this.gui = new GUI(this.canvas2d, this);
    this.playerPosition = this.gui.getCamera().pos();

    // Generate initial landscape
    this.chunk = new Chunk(0.0, 0.0, 64);

    this.blankCubeRenderPass = new RenderPass(this.extVAO, gl, blankCubeVSText, blankCubeFSText);
    this.previewCubeRenderPass = new RenderPass(this.extVAO, gl, previewCubeVSText, previewCubeFSText);
    this.cubeGeometry = new Cube();
    this.previewCubeLightDirection = new Vec3([0.45, 0.8, 0.35]);
    this.previewCubeModelMatrix = new Mat4().identity();
    this.previewCubeProjectionMatrix = new Mat4().identity();
    this.previewCubeScreenOffset = new Float32Array([0.50, -0.50]);
    this.previewCubeViewMatrix = new Mat4().identity();
    this.previewCubeTopTexture = this.loadTextureAsset(dirtTopTexture, [95, 142, 55, 255]);
    this.previewCubeSideTexture = this.loadTextureAsset(dirtSideTexture, [118, 92, 58, 255]);
    this.previewCubeBottomTexture = this.loadTextureAsset(dirtBottomTexture, [105, 77, 45, 255]);
    this.initBlankCube();
    this.initPreviewCube();

    this.lightPosition = new Vec4([-1000, 1000, -1000, 1]);
    this.backgroundColor = new Vec4([0.0, 0.37254903, 0.37254903, 1.0]);
  }

  /**
   * Setup the simulation. This can be called again to reset the program.
   */
  public reset(): void {
    this.gui.reset();

    this.playerPosition = this.gui.getCamera().pos();
  }

  /**
   * Sets up the blank cube drawing
   */
  private initBlankCube(): void {
    this.blankCubeRenderPass.setIndexBufferData(this.cubeGeometry.indicesFlat());
    this.blankCubeRenderPass.addAttribute(
      "aVertPos",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      this.cubeGeometry.positionsFlat(),
    );

    this.blankCubeRenderPass.addAttribute(
      "aNorm",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      this.cubeGeometry.normalsFlat(),
    );

    this.blankCubeRenderPass.addAttribute(
      "aUV",
      2,
      this.ctx.FLOAT,
      false,
      2 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      this.cubeGeometry.uvFlat(),
    );

    this.blankCubeRenderPass.addInstancedAttribute(
      "aOffset",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );

    this.blankCubeRenderPass.addUniform(
      "uLightPos",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.uniform4fv(loc, this.lightPosition);
      },
    );
    this.blankCubeRenderPass.addUniform(
      "uProj",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.uniformMatrix4fv(loc, false, new Float32Array(this.gui.projMatrix()));
      },
    );
    this.blankCubeRenderPass.addUniform(
      "uView",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.uniformMatrix4fv(loc, false, new Float32Array(this.gui.viewMatrix()));
      },
    );

    this.blankCubeRenderPass.setDrawData(
      this.ctx.TRIANGLES,
      this.cubeGeometry.indicesFlat().length,
      this.ctx.UNSIGNED_INT,
      0,
    );
    this.blankCubeRenderPass.setup();
  }

  private initPreviewCube(): void {
    this.previewCubeRenderPass.setIndexBufferData(this.cubeGeometry.indicesFlat());
    this.previewCubeRenderPass.addAttribute(
      "aVertPos",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      this.cubeGeometry.positionsFlat(),
    );
    this.previewCubeRenderPass.addAttribute(
      "aNorm",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      this.cubeGeometry.normalsFlat(),
    );
    this.previewCubeRenderPass.addAttribute(
      "aUV",
      2,
      this.ctx.FLOAT,
      false,
      2 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      this.cubeGeometry.uvFlat(),
    );
    this.previewCubeRenderPass.addUniform("uModel", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.previewCubeModelMatrix));
    });
    this.previewCubeRenderPass.addUniform("uView", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.previewCubeViewMatrix));
    });
    this.previewCubeRenderPass.addUniform("uProj", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.previewCubeProjectionMatrix));
    });
    this.previewCubeRenderPass.addUniform(
      "uScreenOffset",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.uniform2fv(loc, this.previewCubeScreenOffset);
      },
    );
    this.previewCubeRenderPass.addUniform(
      "uLightDir",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.uniform3fv(loc, new Float32Array(this.previewCubeLightDirection));
      },
    );
    this.previewCubeRenderPass.addUniform(
      "uTopTexture",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.previewCubeTopTexture);
        gl.uniform1i(loc, 0);
      },
    );
    this.previewCubeRenderPass.addUniform(
      "uSideTexture",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.previewCubeSideTexture);
        gl.uniform1i(loc, 1);
      },
    );
    this.previewCubeRenderPass.addUniform(
      "uBottomTexture",
      (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.previewCubeBottomTexture);
        gl.uniform1i(loc, 2);
      },
    );
    this.previewCubeRenderPass.setDrawData(
      this.ctx.TRIANGLES,
      this.cubeGeometry.indicesFlat().length,
      this.ctx.UNSIGNED_INT,
      0,
    );
    this.previewCubeRenderPass.setup();
  }

  private loadTextureAsset(assetPath: string, fallbackColor: [number, number, number, number]): WebGLTexture {
    const gl = this.ctx;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error(`Could not create texture for ${assetPath}`);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(fallbackColor),
    );

    const image = new Image();
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    };
    image.src = assetPath;

    return texture;
  }

  /**
   * Draws a single frame
   *
   */
  public draw(): void {
    //TODO: Logic for a rudimentary walking simulator. Check for collisions and reject attempts to walk into a cube. Handle gravity, jumping, and loading of new chunks when necessary.
    this.playerPosition.add(this.gui.walkDir());

    this.gui.getCamera().setPos(this.playerPosition);

    // Drawing
    const gl: WebGLRenderingContext = this.ctx;
    const bg: Vec4 = this.backgroundColor;
    gl.clearColor(bg.r, bg.g, bg.b, bg.a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);

    const canvasWidth = this.c.width;
    const canvasHeight = this.c.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is the default frame buffer
    this.drawScene(0, 0, canvasWidth, canvasHeight);
    if (this.gui.shouldRenderHotbarPreviewCube()) {
      this.drawPreviewCube(canvasWidth, canvasHeight);
    }
    this.gui.drawOverlay();
  }

  private drawScene(x: number, y: number, width: number, height: number): void {
    const gl: WebGLRenderingContext = this.ctx;
    gl.viewport(x, y, width, height);

    //TODO: Render multiple chunks around the player, using Perlin noise shaders
    this.blankCubeRenderPass.updateAttributeBuffer("aOffset", this.chunk.cubePositions());
    this.blankCubeRenderPass.drawInstanced(this.chunk.numCubes());
  }

  private drawPreviewCube(canvasWidth: number, canvasHeight: number): void {
    const gl = this.ctx;
    const marginRight = 0;
    const marginBottom = 0;
    const previewWidth = Math.max(
      1,
      Math.min(canvasWidth - marginRight * 2, Math.max(320, Math.round(canvasWidth * 0.46))),
    );
    const previewHeight = Math.max(
      1,
      Math.min(canvasHeight - marginBottom * 2, Math.max(420, Math.round(canvasHeight * 0.72))),
    );
    const previewX = Math.max(0, canvasWidth - previewWidth);
    const previewY = 0;

    this.updatePreviewCubeMatrices(previewWidth, previewHeight);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(previewX, previewY, previewWidth, previewHeight);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.viewport(previewX, previewY, previewWidth, previewHeight);
    this.previewCubeRenderPass.draw();
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
  }

  private updatePreviewCubeMatrices(previewWidth: number, previewHeight: number): void {
    const previewCameraPosition = new Vec3([2.05, 2.35, 2.45]);
    const previewTarget = new Vec3([0, 0, 0]);
    const previewUp = new Vec3([0, 1, 0]);

    this.previewCubeModelMatrix.identity();
    this.previewCubeModelMatrix.scale(new Vec3([1.8, 1.8, 1.8]));

    this.previewCubeViewMatrix.identity();
    Mat4.lookAt(this.previewCubeViewMatrix, previewCameraPosition, previewTarget, previewUp);

    this.previewCubeProjectionMatrix.identity();
    Mat4.perspective(
      this.previewCubeProjectionMatrix,
      50 / (180 / Math.PI),
      previewWidth / previewHeight,
      0.1,
      20.0,
    );
  }

  public getGUI(): GUI {
    return this.gui;
  }

  public jump() {
    //TODO: If the player is not already in the lair, launch them upwards at 10 units/sec.
  }
}
