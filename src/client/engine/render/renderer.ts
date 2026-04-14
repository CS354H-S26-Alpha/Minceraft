import { Mat4 } from "gl-matrix";
import { WebGLUtilities } from "@/lib/webglutils/CanvasAnimation";
import { RenderPass } from "@/lib/webglutils/RenderPass";
import type { EntityDrawData, EntityPassDef } from "../entities/pipeline";
import { Cube } from "./cube";
import { GpuTimer } from "./gpu-timer";
import { HELD_ITEM_ATLAS_TEXTURE_URLS } from "./held-item-textures";
import blankCubeFSText from "./shaders/blankCube.frag";
import blankCubeVSText from "./shaders/blankCube.vert";
import heldItemCubeFSText from "./shaders/heldItemCube.frag";
import heldItemCubeVSText from "./shaders/heldItemCube.vert";

export interface HeldItemRenderBatch {
  cubeModelMatrix?: Mat4;
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  cubeFaceTiles0: Float32Array;
  cubeFaceTiles1: Float32Array;
  numCubes: number;
  cubeLighting?: number;
  cubeTextureFlipU?: number;
  cubeTextureFlipV?: number;
  cubeTextureAlpha?: number;
  cubeTransparentMissingFaces?: number;
}

export interface RenderView {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  numCubes: number;
  heldItemBatches?: HeldItemRenderBatch[];
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

interface AtlasTextureInfo {
  texture: WebGLTexture;
  tileCount: number;
}

const IDENTITY_HELD_ITEM_MODEL_MATRIX = new Mat4().identity();
const EMPTY_FLOATS = new Float32Array(0);
const EMPTY_HELD_ITEM_BATCH: HeldItemRenderBatch = {
  cubePositions: EMPTY_FLOATS,
  cubeColors: EMPTY_FLOATS,
  cubeFaceTiles0: EMPTY_FLOATS,
  cubeFaceTiles1: EMPTY_FLOATS,
  numCubes: 0,
};

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: WebGL2RenderingContext;
  private readonly blankCubeRenderPass: RenderPass;
  private readonly heldItemRenderPass: RenderPass;
  private readonly heldItemAtlasTexture: WebGLTexture;
  private readonly heldItemAtlasTileCount: number;
  private readonly entityPasses: Map<string, EntityPass>;
  readonly gpuTimer: GpuTimer;

  private currentView!: RenderView;
  private lastCubePositions: Float32Array | null = null;
  private lastCubeColors: Float32Array | null = null;
  private currentHeldItemBatch: HeldItemRenderBatch = EMPTY_HELD_ITEM_BATCH;
  private lastHeldItemPositions: Float32Array | null = null;
  private lastHeldItemColors: Float32Array | null = null;
  private lastHeldItemFaceTiles0: Float32Array | null = null;
  private lastHeldItemFaceTiles1: Float32Array | null = null;

  constructor(canvas: HTMLCanvasElement, entityDefs: EntityPassDef[]) {
    this.canvas = canvas;
    this.ctx = WebGLUtilities.requestWebGLContext(canvas);
    this.gpuTimer = new GpuTimer(this.ctx);

    const cubeGeometry = new Cube();
    this.blankCubeRenderPass = new RenderPass(this.ctx, blankCubeVSText, blankCubeFSText);
    this.initBlankCubePass(cubeGeometry);
    const heldItemAtlas = createAtlasTexture(this.ctx, HELD_ITEM_ATLAS_TEXTURE_URLS, "held item atlas");
    this.heldItemAtlasTexture = heldItemAtlas.texture;
    this.heldItemAtlasTileCount = heldItemAtlas.tileCount;
    this.heldItemRenderPass = new RenderPass(this.ctx, heldItemCubeVSText, heldItemCubeFSText);
    this.initHeldItemPass(cubeGeometry);

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

    if (view.numCubes > 0) {
      if (view.cubePositions !== this.lastCubePositions) {
        this.blankCubeRenderPass.updateAttributeBuffer("aOffset", view.cubePositions);
        this.lastCubePositions = view.cubePositions;
      }
      if (view.cubeColors !== this.lastCubeColors) {
        this.blankCubeRenderPass.updateAttributeBuffer("aColor", view.cubeColors);
        this.lastCubeColors = view.cubeColors;
      }
      this.blankCubeRenderPass.drawInstanced(view.numCubes);
    }

    for (const batch of view.heldItemBatches ?? []) {
      if (batch.numCubes === 0) continue;
      this.currentHeldItemBatch = batch;
      this.bindHeldItemBatch(batch);
      this.applyHeldItemBlendState(batch);
      this.heldItemRenderPass.drawInstanced(batch.numCubes);
    }
    gl.disable(gl.BLEND);
    this.currentHeldItemBatch = EMPTY_HELD_ITEM_BATCH;

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

    this.addSharedUniforms(pass);
    pass.setDrawData(gl.TRIANGLES, cube.indicesFlat().length, gl.UNSIGNED_INT, 0);
    pass.setup();
  }

  private initHeldItemPass(cube: Cube): void {
    const gl = this.ctx;
    const pass = this.heldItemRenderPass;

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
    pass.addInstancedAttribute(
      "aFaceTiles0",
      3,
      this.ctx.FLOAT,
      false,
      3 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addInstancedAttribute(
      "aFaceTiles1",
      3,
      this.ctx.FLOAT,
      false,
      3 * Float32Array.BYTES_PER_ELEMENT,
      0,
      undefined,
      new Float32Array(0),
    );
    pass.addTexture(this.heldItemAtlasTexture);

    this.addHeldItemUniforms(pass);
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

  private addHeldItemUniforms(pass: RenderPass): void {
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
    pass.addUniform("uCubeModel", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(
        loc,
        false,
        new Float32Array(this.currentHeldItemBatch.cubeModelMatrix ?? IDENTITY_HELD_ITEM_MODEL_MATRIX),
      );
    });
    pass.addUniform("uBlockAtlas", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(loc, 0);
    });
    pass.addUniform("uBlockAtlasTileCount", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.heldItemAtlasTileCount);
    });
    pass.addUniform("uCubeLighting", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.currentHeldItemBatch.cubeLighting ?? 1);
    });
    pass.addUniform("uCubeTextureFlipU", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.currentHeldItemBatch.cubeTextureFlipU ?? 0);
    });
    pass.addUniform("uCubeTextureFlipV", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.currentHeldItemBatch.cubeTextureFlipV ?? 0);
    });
    pass.addUniform("uCubeTextureAlpha", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.currentHeldItemBatch.cubeTextureAlpha ?? 0);
    });
    pass.addUniform("uCubeTransparentMissingFaces", (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.currentHeldItemBatch.cubeTransparentMissingFaces ?? 0);
    });
  }

  private bindHeldItemBatch(batch: HeldItemRenderBatch): void {
    if (batch.cubePositions !== this.lastHeldItemPositions) {
      this.heldItemRenderPass.updateAttributeBuffer("aOffset", batch.cubePositions);
      this.lastHeldItemPositions = batch.cubePositions;
    }
    if (batch.cubeColors !== this.lastHeldItemColors) {
      this.heldItemRenderPass.updateAttributeBuffer("aColor", batch.cubeColors);
      this.lastHeldItemColors = batch.cubeColors;
    }
    if (batch.cubeFaceTiles0 !== this.lastHeldItemFaceTiles0) {
      this.heldItemRenderPass.updateAttributeBuffer("aFaceTiles0", batch.cubeFaceTiles0);
      this.lastHeldItemFaceTiles0 = batch.cubeFaceTiles0;
    }
    if (batch.cubeFaceTiles1 !== this.lastHeldItemFaceTiles1) {
      this.heldItemRenderPass.updateAttributeBuffer("aFaceTiles1", batch.cubeFaceTiles1);
      this.lastHeldItemFaceTiles1 = batch.cubeFaceTiles1;
    }
  }

  private applyHeldItemBlendState(batch: HeldItemRenderBatch): void {
    const gl = this.ctx;
    if ((batch.cubeTextureAlpha ?? 0) > 0 || (batch.cubeTransparentMissingFaces ?? 0) > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      return;
    }

    gl.disable(gl.BLEND);
  }
}

function createAtlasTexture(gl: WebGLRenderingContext, textureUrls: string[], label: string): AtlasTextureInfo {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error(`Failed to create ${label}`);
  }

  const tileCount = Math.max(1, textureUrls.length);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([64, 64, 64, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  if (textureUrls.length === 0) {
    return { texture, tileCount };
  }

  void loadAtlasCanvas(textureUrls)
    .then((atlas) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    })
    .catch((error: unknown) => {
      console.error(`Failed to load ${label}`, error);
    });

  return { texture, tileCount };
}

async function loadAtlasCanvas(textureUrls: string[]): Promise<HTMLCanvasElement> {
  const images = await Promise.all(textureUrls.map((src) => loadImage(src)));
  const tileWidth = images[0]?.naturalWidth ?? 1;
  const tileHeight = images[0]?.naturalHeight ?? 1;
  const atlas = document.createElement("canvas");
  atlas.width = tileWidth * images.length;
  atlas.height = tileHeight;

  const ctx = atlas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D context for texture atlas");
  }

  ctx.imageSmoothingEnabled = false;
  images.forEach((image, index) => {
    ctx.drawImage(image, index * tileWidth, 0, tileWidth, tileHeight);
  });

  return atlas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}
