import type { Mat4, Vec4 } from "gl-matrix";
import { WebGLUtilities } from "@/lib/webglutils/CanvasAnimation";
import { RenderPass } from "@/lib/webglutils/RenderPass";
import type { EntityDrawData, EntityPassDef } from "../entities/pipeline";
import { Cube } from "./cube";
import { BLOCK_ATLAS_TEXTURE_URLS } from "./cube-types";
import blankCubeFSText from "./shaders/blankCube.frag";
import blankCubeVSText from "./shaders/blankCube.vert";

export interface RenderView {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  cubePositions: Float32Array;
  cubeColors: Float32Array;
  cubeFaceTiles0: Float32Array;
  cubeFaceTiles1: Float32Array;
  numCubes: number;
  lightPosition: Vec4;
  backgroundColor: Vec4;
  entities: EntityDrawData[];
}

interface EntityPass {
  pass: RenderPass;
  cullFace: boolean;
  instancedAttributes: { name: string; size: number }[];
}

interface BlockAtlasTextureInfo {
  texture: WebGLTexture;
  tileCount: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: WebGLRenderingContext;
  private readonly blankCubeRenderPass: RenderPass;
  private readonly blockAtlasTexture: WebGLTexture;
  private readonly blockAtlasTileCount: number;
  private readonly entityPasses: Map<string, EntityPass>;

  private currentView!: RenderView;
  private lastCubePositions: Float32Array | null = null;
  private lastCubeColors: Float32Array | null = null;
  private lastCubeFaceTiles0: Float32Array | null = null;
  private lastCubeFaceTiles1: Float32Array | null = null;

  constructor(canvas: HTMLCanvasElement, entityDefs: EntityPassDef[]) {
    this.canvas = canvas;
    this.ctx = WebGLUtilities.requestWebGLContext(canvas);
    WebGLUtilities.requestIntIndicesExt(this.ctx);
    const extVAO = WebGLUtilities.requestVAOExt(this.ctx);

    const cubeGeometry = new Cube();
    const blockAtlas = createBlockAtlasTexture(this.ctx);
    this.blockAtlasTexture = blockAtlas.texture;
    this.blockAtlasTileCount = blockAtlas.tileCount;
    this.blankCubeRenderPass = new RenderPass(extVAO, this.ctx, blankCubeVSText, blankCubeFSText);
    this.initBlankCubePass(cubeGeometry);

    this.entityPasses = new Map();
    for (const def of entityDefs) {
      const pass = new RenderPass(extVAO, this.ctx, def.vertexShader, def.fragmentShader);
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
    const bg = view.backgroundColor;
    gl.clearColor(bg.r, bg.g, bg.b, bg.a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (view.cubePositions !== this.lastCubePositions) {
      this.blankCubeRenderPass.updateAttributeBuffer("aOffset", view.cubePositions);
      this.lastCubePositions = view.cubePositions;
    }
    if (view.cubeColors !== this.lastCubeColors) {
      this.blankCubeRenderPass.updateAttributeBuffer("aColor", view.cubeColors);
      this.lastCubeColors = view.cubeColors;
    }
    if (view.cubeFaceTiles0 !== this.lastCubeFaceTiles0) {
      this.blankCubeRenderPass.updateAttributeBuffer("aFaceTiles0", view.cubeFaceTiles0);
      this.lastCubeFaceTiles0 = view.cubeFaceTiles0;
    }
    if (view.cubeFaceTiles1 !== this.lastCubeFaceTiles1) {
      this.blankCubeRenderPass.updateAttributeBuffer("aFaceTiles1", view.cubeFaceTiles1);
      this.lastCubeFaceTiles1 = view.cubeFaceTiles1;
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
    pass.addTexture(this.blockAtlasTexture);

    this.addSharedUniforms(pass);
    pass.setDrawData(gl.TRIANGLES, cube.indicesFlat().length, gl.UNSIGNED_INT, 0);
    pass.setup();
  }

  private addSharedUniforms(pass: RenderPass): void {
    pass.addUniform("uLightPos", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform4fv(loc, this.currentView.lightPosition);
    });
    pass.addUniform("uProj", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.projMatrix));
    });
    pass.addUniform("uView", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniformMatrix4fv(loc, false, new Float32Array(this.currentView.viewMatrix));
    });
    pass.addUniform("uBlockAtlas", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(loc, 0);
    });
    pass.addUniform("uBlockAtlasTileCount", (gl: WebGLRenderingContext, loc: WebGLUniformLocation) => {
      gl.uniform1f(loc, this.blockAtlasTileCount);
    });
  }
}

function createBlockAtlasTexture(gl: WebGLRenderingContext): BlockAtlasTextureInfo {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error("Failed to create block atlas texture");
  }

  const tileCount = Math.max(1, BLOCK_ATLAS_TEXTURE_URLS.length);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([64, 64, 64, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  if (BLOCK_ATLAS_TEXTURE_URLS.length === 0) {
    return { texture, tileCount };
  }

  void loadBlockAtlasCanvas(BLOCK_ATLAS_TEXTURE_URLS)
    .then((atlas) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    })
    .catch((error: unknown) => {
      console.error("Failed to load block atlas texture", error);
    });

  return { texture, tileCount };
}

async function loadBlockAtlasCanvas(textureUrls: string[]): Promise<HTMLCanvasElement> {
  const images = await Promise.all(textureUrls.map((src) => loadImage(src)));
  const tileWidth = images[0]?.naturalWidth ?? 1;
  const tileHeight = images[0]?.naturalHeight ?? 1;
  const atlas = document.createElement("canvas");
  atlas.width = tileWidth * images.length;
  atlas.height = tileHeight;

  const ctx = atlas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D context for block atlas");
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
