import type { Mat4 } from "gl-matrix";
import { WebGLUtilities } from "@/lib/webglutils/CanvasAnimation";
import { RenderPass } from "@/lib/webglutils/RenderPass";
import type { EntityDrawData, EntityPassDef } from "../entities/pipeline";
import { Cube } from "./cube";
import { GpuTimer } from "./gpu-timer";
import blankCubeFSText from "./shaders/blankCube.frag";
import blankCubeVSText from "./shaders/blankCube.vert";
import skyboxFSText from "./shaders/skybox.frag";
import skyboxVSText from "./shaders/skybox.vert";

export interface RenderView {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  cubeAmbientOcclusion: Uint8Array;
  numCubes: number;
  lightPosition: Float32Array;
  backgroundColor: Float32Array;
  /** RGB ambient light color (changes with time of day). */
  ambientColor: Float32Array;
  /** RGB sun/moon light color (changes with time of day). */
  sunColor: Float32Array;
  /** Wall-clock seconds since game start; drives fluid surface animation. */
  timeS: number;
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
  private readonly skyboxRenderPass: RenderPass;
  private readonly blankCubeRenderPass: RenderPass;
  private readonly entityPasses: Map<string, EntityPass>;
  readonly gpuTimer: GpuTimer;

  private currentView!: RenderView;
  private readonly viewNoTranslation = new Float32Array(16);
  private lastCubePositions: Float32Array | null = null;
  private lastCubeColors: Float32Array | null = null;
  private lastCubeAmbientOcclusion: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement, entityDefs: EntityPassDef[]) {
    this.canvas = canvas;
    this.ctx = WebGLUtilities.requestWebGLContext(canvas);
    this.gpuTimer = new GpuTimer(this.ctx);

    const cubeGeometry = new Cube();
    this.skyboxRenderPass = new RenderPass(this.ctx, skyboxVSText, skyboxFSText);
    this.initSkyboxPass(cubeGeometry);
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

    this.drawSkybox();

    if (view.cubePositions !== this.lastCubePositions) {
      this.blankCubeRenderPass.updateAttributeBuffer("aOffset", view.cubePositions);
      this.lastCubePositions = view.cubePositions;
    }
    if (view.cubeColors !== this.lastCubeColors) {
      this.blankCubeRenderPass.updateAttributeBuffer("aColor", view.cubeColors);
      this.lastCubeColors = view.cubeColors;
    }
    if (view.cubeAmbientOcclusion !== this.lastCubeAmbientOcclusion) {
      this.blankCubeRenderPass.updateAttributeBuffer("aAmbientOcclusion", view.cubeAmbientOcclusion);
      this.lastCubeAmbientOcclusion = view.cubeAmbientOcclusion;
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

  private drawSkybox(): void {
    const gl = this.ctx;
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.skyboxRenderPass.draw();
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
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

  // LUT data — indexed by CubeType (0–14), must stay in sync with blankCube.frag
  // col1 = mix(vertexColor, lut1Fixed, lut1Blend)
  // col2 = mix(vertexColor * lut2Scale, lut2Fixed, lut2Blend)
  // Entries for Water (12), Lava (13), and Permafrost (14) are dummies:
  //   Water/Lava compute kd directly in the fluid branch (col1/col2 unused).
  //   Permafrost overrides col1/col2 in the grass/permafrost branch.
  private static readonly LUT1_FIXED = new Float32Array([
    0.0,
    0.0,
    0.0, // 0  Air         (unused)
    0.0,
    0.0,
    0.0, // 1  Grass       (overridden by face logic)
    0.0,
    0.0,
    0.0, // 2  Dirt
    0.0,
    0.0,
    0.0, // 3  Stone
    0.0,
    0.0,
    0.0, // 4  Sand
    0.0,
    0.0,
    0.0, // 5  Snow
    0.08,
    0.08,
    0.09, // 6  Bedrock
    0.0,
    0.0,
    0.0, // 7  ForestGrass (overridden by face logic)
    0.5,
    0.5,
    0.5, // 8  CoalOre
    0.5,
    0.5,
    0.5, // 9  IronOre
    0.5,
    0.5,
    0.5, // 10 GoldOre
    0.5,
    0.5,
    0.5, // 11 DiamondOre
    0.0,
    0.0,
    0.0, // 12 Water       (dummy — fluid branch overrides kd)
    0.0,
    0.0,
    0.0, // 13 Lava        (dummy — fluid branch overrides kd)
    0.0,
    0.0,
    0.0, // 14 Permafrost  (dummy — overridden by grass branch)
  ]);
  private static readonly LUT1_BLEND = new Float32Array([
    0, // Air
    0, // Grass
    0, // Dirt
    0, // Stone
    0, // Sand
    0, // Snow
    1, // Bedrock
    0, // ForestGrass
    1, // CoalOre
    1, // IronOre
    1, // GoldOre
    1, // DiamondOre
    0, // Water      (dummy)
    0, // Lava       (dummy)
    0, // Permafrost (dummy)
  ]);
  private static readonly LUT2_FIXED = new Float32Array([
    0.0,
    0.0,
    0.0, // 0  Air         (unused)
    0.0,
    0.0,
    0.0, // 1  Grass       (overridden by face logic)
    0.0,
    0.0,
    0.0, // 2  Dirt
    0.3,
    0.3,
    0.335, // 3  Stone
    0.53,
    0.47,
    0.18, // 4  Sand
    0.8,
    0.9,
    1.0, // 5  Snow
    0.02,
    0.02,
    0.03, // 6  Bedrock
    0.0,
    0.0,
    0.0, // 7  ForestGrass (overridden by face logic)
    0.12,
    0.12,
    0.13, // 8  CoalOre
    0.72,
    0.46,
    0.3, // 9  IronOre
    0.94,
    0.82,
    0.08, // 10 GoldOre
    0.25,
    0.88,
    0.92, // 11 DiamondOre
    0.0,
    0.0,
    0.0, // 12 Water       (dummy — fluid branch overrides kd)
    0.0,
    0.0,
    0.0, // 13 Lava        (dummy — fluid branch overrides kd)
    0.0,
    0.0,
    0.0, // 14 Permafrost  (dummy — overridden by grass branch)
  ]);
  private static readonly LUT2_BLEND = new Float32Array([
    0, // Air
    0, // Grass
    0, // Dirt
    1, // Stone
    0.4, // Sand
    1, // Snow
    1, // Bedrock
    0, // ForestGrass
    1, // CoalOre
    1, // IronOre
    1, // GoldOre
    1, // DiamondOre
    0, // Water      (dummy)
    0, // Lava       (dummy)
    0, // Permafrost (dummy)
  ]);
  private static readonly LUT2_SCALE = new Float32Array([
    0.5, // Air
    0.5, // Grass
    0.5, // Dirt
    0.5, // Stone
    0.85, // Sand
    0.5, // Snow        (irrelevant, blend=1)
    0.5, // Bedrock     (irrelevant, blend=1)
    0.5, // ForestGrass
    0.5, // CoalOre     (irrelevant, blend=1)
    0.5, // IronOre     (irrelevant, blend=1)
    0.5, // GoldOre     (irrelevant, blend=1)
    0.5, // DiamondOre  (irrelevant, blend=1)
    0.5, // Water       (dummy)
    0.5, // Lava        (dummy)
    0.5, // Permafrost  (dummy)
  ]);

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
    pass.addAttribute("aUV", 2, gl.FLOAT, false, 2 * Float32Array.BYTES_PER_ELEMENT, 0, undefined, cube.uvFlat());
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
    const aoStride = 24 * Uint8Array.BYTES_PER_ELEMENT;
    const aoBuffer = "aAmbientOcclusion";
    pass.addInstancedAttribute("aAOTop", 4, gl.UNSIGNED_BYTE, false, aoStride, 0, aoBuffer, new Uint8Array(0));
    pass.addInstancedAttribute(
      "aAOLeft",
      4,
      gl.UNSIGNED_BYTE,
      false,
      aoStride,
      4 * Uint8Array.BYTES_PER_ELEMENT,
      aoBuffer,
    );
    pass.addInstancedAttribute(
      "aAORight",
      4,
      gl.UNSIGNED_BYTE,
      false,
      aoStride,
      8 * Uint8Array.BYTES_PER_ELEMENT,
      aoBuffer,
    );
    pass.addInstancedAttribute(
      "aAOFront",
      4,
      gl.UNSIGNED_BYTE,
      false,
      aoStride,
      12 * Uint8Array.BYTES_PER_ELEMENT,
      aoBuffer,
    );
    pass.addInstancedAttribute(
      "aAOBack",
      4,
      gl.UNSIGNED_BYTE,
      false,
      aoStride,
      16 * Uint8Array.BYTES_PER_ELEMENT,
      aoBuffer,
    );
    pass.addInstancedAttribute(
      "aAOBottom",
      4,
      gl.UNSIGNED_BYTE,
      false,
      aoStride,
      20 * Uint8Array.BYTES_PER_ELEMENT,
      aoBuffer,
    );

    this.addSharedUniforms(pass);

    pass.addUniform("uLut1Fixed", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform3fv(loc, Renderer.LUT1_FIXED);
    });
    pass.addUniform("uLut1Blend", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1fv(loc, Renderer.LUT1_BLEND);
    });
    pass.addUniform("uLut2Fixed", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform3fv(loc, Renderer.LUT2_FIXED);
    });
    pass.addUniform("uLut2Blend", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1fv(loc, Renderer.LUT2_BLEND);
    });
    pass.addUniform("uLut2Scale", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1fv(loc, Renderer.LUT2_SCALE);
    });

    pass.setDrawData(gl.TRIANGLES, cube.indicesFlat().length, gl.UNSIGNED_INT, 0);
    pass.setup();
  }

  private initSkyboxPass(cube: Cube): void {
    const gl = this.ctx;
    const pass = this.skyboxRenderPass;

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

    pass.addUniform("uProj", (glCtx: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      glCtx.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.projMatrix));
    });
    pass.addUniform("uViewNoTranslation", (glCtx: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      this.viewNoTranslation.set(this.currentView.viewMatrix);
      this.viewNoTranslation[12] = 0;
      this.viewNoTranslation[13] = 0;
      this.viewNoTranslation[14] = 0;
      glCtx.uniformMatrix4fv(loc, false, this.viewNoTranslation);
    });
    pass.addUniform("uAmbient", (glCtx: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      glCtx.uniform3fv(loc, this.currentView.ambientColor);
    });
    pass.addUniform("uSunColor", (glCtx: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      glCtx.uniform3fv(loc, this.currentView.sunColor);
    });

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
    pass.addUniform("uTime", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.currentView.timeS);
    });
  }
}
