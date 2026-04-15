import type { Mat4 } from "gl-matrix";
import { WebGLUtilities } from "@/lib/webglutils/CanvasAnimation";
import { RenderPass } from "@/lib/webglutils/RenderPass";
import type { EntityDrawData, EntityPassDef } from "../entities/pipeline";
import { Cube } from "./cube";
import { GpuTimer } from "./gpu-timer";
import blankCubeFSText from "./shaders/blankCube.frag";
import blankCubeVSText from "./shaders/blankCube.vert";

export interface RenderView {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  cubeAo: Float32Array;
  numCubes: number;
  lightPosition: Float32Array;
  backgroundColor: Float32Array;
  /** RGB ambient light color (changes with time of day). */
  ambientColor: Float32Array;
  /** RGB sun/moon light color (changes with time of day). */
  sunColor: Float32Array;
  entities: EntityDrawData[];
}

interface EntityPass {
  pass: RenderPass;
  cullFace: boolean;
  instancedAttributes: { name: string; size: number }[];
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: WebGL2RenderingContext;
  private readonly blankCubeRenderPass: RenderPass;
  private readonly entityPasses: Map<string, EntityPass>;
  readonly gpuTimer: GpuTimer;

  private currentView!: RenderView;
  private lastCubePositions: Float32Array | null = null;
  private lastCubeColors: Float32Array | null = null;
  private lastCubeAo: Float32Array | null = null;
  private aoTopBuffer = new Float32Array(0);
  private aoLeftBuffer = new Float32Array(0);
  private aoRightBuffer = new Float32Array(0);
  private aoFrontBuffer = new Float32Array(0);
  private aoBackBuffer = new Float32Array(0);
  private aoBottomBuffer = new Float32Array(0);

  constructor(canvas: HTMLCanvasElement, entityDefs: EntityPassDef[]) {
    this.canvas = canvas;
    this.ctx = WebGLUtilities.requestWebGLContext(canvas);
    this.gpuTimer = new GpuTimer(this.ctx);

    const cubeGeometry = new Cube();
    this.blankCubeRenderPass = new RenderPass(this.ctx, blankCubeVSText, blankCubeFSText);
    this.initBlankCubePass(cubeGeometry);

    this.entityPasses = new Map();
    for (const def of entityDefs) {
      const pass = new RenderPass(this.ctx, def.vertexShader, def.fragmentShader);
      this.initEntityPass(pass, def);
      this.entityPasses.set(def.key, {
        pass,
        cullFace: def.cullFace ?? true,
        instancedAttributes: def.instancedAttributes,
      });
    }
  }

  render(view: RenderView): void {
    this.currentView = view;

    const gl = this.ctx;
    const [bgR = 0, bgG = 0, bgB = 0, bgA = 1] = view.backgroundColor;
    gl.clearColor(bgR, bgG, bgB, bgA);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.gpuTimer.poll();
    this.gpuTimer.begin();

    if (view.cubePositions !== this.lastCubePositions) {
      this.blankCubeRenderPass.updateAttributeBuffer("aOffset", view.cubePositions);
      this.lastCubePositions = view.cubePositions;
    }
    if (view.cubeColors !== this.lastCubeColors) {
      this.blankCubeRenderPass.updateAttributeBuffer("aColor", view.cubeColors);
      this.lastCubeColors = view.cubeColors;
    }
    if (view.cubeAo !== this.lastCubeAo) {
      this.updateCubeAoBuffers(view.cubeAo, view.numCubes);
      this.blankCubeRenderPass.updateAttributeBuffer("aAoTop", this.aoTopBuffer.subarray(0, view.numCubes * 4));
      this.blankCubeRenderPass.updateAttributeBuffer("aAoLeft", this.aoLeftBuffer.subarray(0, view.numCubes * 4));
      this.blankCubeRenderPass.updateAttributeBuffer("aAoRight", this.aoRightBuffer.subarray(0, view.numCubes * 4));
      this.blankCubeRenderPass.updateAttributeBuffer("aAoFront", this.aoFrontBuffer.subarray(0, view.numCubes * 4));
      this.blankCubeRenderPass.updateAttributeBuffer("aAoBack", this.aoBackBuffer.subarray(0, view.numCubes * 4));
      this.blankCubeRenderPass.updateAttributeBuffer("aAoBottom", this.aoBottomBuffer.subarray(0, view.numCubes * 4));
      this.lastCubeAo = view.cubeAo;
    }
    this.blankCubeRenderPass.drawInstanced(view.numCubes);

    for (const entity of view.entities) {
      if (entity.count === 0) continue;
      const ep = this.entityPasses.get(entity.key);
      if (!ep) continue;

      if (!ep.cullFace) gl.disable(gl.CULL_FACE);
      for (const { name, size } of ep.instancedAttributes) {
        const buf = entity.buffers[name];
        if (buf) ep.pass.updateAttributeBuffer(name, buf.subarray(0, entity.count * size));
      }
      ep.pass.drawInstanced(entity.count);
      if (!ep.cullFace) gl.enable(gl.CULL_FACE);
    }

    this.gpuTimer.end();
  }

  private initEntityPass(pass: RenderPass, def: EntityPassDef): void {
    const gl = this.ctx;
    const geo = def.geometry;

    pass.setIndexBufferData(geo.indices);
    pass.addAttribute("aVertPos", 4, gl.FLOAT, false, 4 * Float32Array.BYTES_PER_ELEMENT, 0, undefined, geo.positions);
    pass.addAttribute("aNorm", 4, gl.FLOAT, false, 4 * Float32Array.BYTES_PER_ELEMENT, 0, undefined, geo.normals);
    pass.addAttribute("aUV", 2, gl.FLOAT, false, 2 * Float32Array.BYTES_PER_ELEMENT, 0, undefined, geo.uvs);

    for (const attr of def.instancedAttributes) {
      pass.addInstancedAttribute(
        attr.name,
        attr.size,
        gl.FLOAT,
        false,
        attr.size * Float32Array.BYTES_PER_ELEMENT,
        0,
        undefined,
        new Float32Array(0),
      );
    }

    this.addSharedUniforms(pass);
    pass.setDrawData(gl.TRIANGLES, geo.indices.length, gl.UNSIGNED_INT, 0);
    pass.setup();
  }

  private initBlankCubePass(cube: Cube): void {
    const gl = this.ctx;
    const pass = this.blankCubeRenderPass;

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
    pass.addInstancedAttribute(
      "aColor",
      3,
      this.ctx.FLOAT,
      false,
      3 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aAoTop",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aAoLeft",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aAoRight",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aAoFront",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aAoBack",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aAoBottom",
      4,
      this.ctx.FLOAT,
      false,
      4 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );

    this.addSharedUniforms(pass);
    pass.setDrawData(gl.TRIANGLES, cube.indicesFlat().length, gl.UNSIGNED_INT, 0);
    pass.setup();
  }

  private addSharedUniforms(pass: RenderPass): void {
    pass.addUniform("uLightPos", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform4fv(loc, this.currentView.lightPosition);
    });
    pass.addUniform("uProj", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.projMatrix));
    });
    pass.addUniform("uView", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.viewMatrix));
    });
    pass.addUniform("uAmbient", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform3fv(loc, this.currentView.ambientColor);
    });
    pass.addUniform("uSunColor", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform3fv(loc, this.currentView.sunColor);
    });
  }

  private updateCubeAoBuffers(packedAo: Float32Array, cubeCount: number): void {
    const needed = cubeCount * 4;
    if (this.aoTopBuffer.length < needed) this.aoTopBuffer = new Float32Array(needed);
    if (this.aoLeftBuffer.length < needed) this.aoLeftBuffer = new Float32Array(needed);
    if (this.aoRightBuffer.length < needed) this.aoRightBuffer = new Float32Array(needed);
    if (this.aoFrontBuffer.length < needed) this.aoFrontBuffer = new Float32Array(needed);
    if (this.aoBackBuffer.length < needed) this.aoBackBuffer = new Float32Array(needed);
    if (this.aoBottomBuffer.length < needed) this.aoBottomBuffer = new Float32Array(needed);

    for (let i = 0; i < cubeCount; i++) {
      const src = i * 24;
      const dst = i * 4;

      this.aoTopBuffer[dst] = packedAo[src] ?? 1;
      this.aoTopBuffer[dst + 1] = packedAo[src + 1] ?? 1;
      this.aoTopBuffer[dst + 2] = packedAo[src + 2] ?? 1;
      this.aoTopBuffer[dst + 3] = packedAo[src + 3] ?? 1;

      this.aoLeftBuffer[dst] = packedAo[src + 4] ?? 1;
      this.aoLeftBuffer[dst + 1] = packedAo[src + 5] ?? 1;
      this.aoLeftBuffer[dst + 2] = packedAo[src + 6] ?? 1;
      this.aoLeftBuffer[dst + 3] = packedAo[src + 7] ?? 1;

      this.aoRightBuffer[dst] = packedAo[src + 8] ?? 1;
      this.aoRightBuffer[dst + 1] = packedAo[src + 9] ?? 1;
      this.aoRightBuffer[dst + 2] = packedAo[src + 10] ?? 1;
      this.aoRightBuffer[dst + 3] = packedAo[src + 11] ?? 1;

      this.aoFrontBuffer[dst] = packedAo[src + 12] ?? 1;
      this.aoFrontBuffer[dst + 1] = packedAo[src + 13] ?? 1;
      this.aoFrontBuffer[dst + 2] = packedAo[src + 14] ?? 1;
      this.aoFrontBuffer[dst + 3] = packedAo[src + 15] ?? 1;

      this.aoBackBuffer[dst] = packedAo[src + 16] ?? 1;
      this.aoBackBuffer[dst + 1] = packedAo[src + 17] ?? 1;
      this.aoBackBuffer[dst + 2] = packedAo[src + 18] ?? 1;
      this.aoBackBuffer[dst + 3] = packedAo[src + 19] ?? 1;

      this.aoBottomBuffer[dst] = packedAo[src + 20] ?? 1;
      this.aoBottomBuffer[dst + 1] = packedAo[src + 21] ?? 1;
      this.aoBottomBuffer[dst + 2] = packedAo[src + 22] ?? 1;
      this.aoBottomBuffer[dst + 3] = packedAo[src + 23] ?? 1;
    }
  }
}
