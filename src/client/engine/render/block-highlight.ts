/** biome-ignore-all lint/style/noNonNullAssertion: WebGL factory methods are non-null in valid contexts */
import type { Mat4Like } from "gl-matrix";
import { WebGLUtilities } from "@/lib/webglutils/CanvasAnimation";
import highlightFragSrc from "./shaders/highlight.frag";
import highlightVertSrc from "./shaders/highlight.vert";

// Minecraft-style outline: each of the 12 cube edges becomes a thin screen-space
// quad (two triangles) so the line stays a consistent pixel thickness regardless
// of distance or GPU (gl.lineWidth > 1 is ignored on most WebGL implementations).
// Each vertex stores both edge endpoints + its end param (0=A, 1=B) + a side sign
// (-1/+1); the vertex shader projects both endpoints and expands the quad
// perpendicular to the screen-space line direction.

const E = 0.002;
const LO = -E;
const HI = 1 + E;

const EDGES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  // Bottom ring
  [LO, LO, LO, HI, LO, LO],
  [HI, LO, LO, HI, LO, HI],
  [HI, LO, HI, LO, LO, HI],
  [LO, LO, HI, LO, LO, LO],
  // Top ring
  [LO, HI, LO, HI, HI, LO],
  [HI, HI, LO, HI, HI, HI],
  [HI, HI, HI, LO, HI, HI],
  [LO, HI, HI, LO, HI, LO],
  // Vertical pillars
  [LO, LO, LO, LO, HI, LO],
  [HI, LO, LO, HI, HI, LO],
  [HI, LO, HI, HI, HI, HI],
  [LO, LO, HI, LO, HI, HI],
];

const FLOATS_PER_VERT = 8;
const VERTS_PER_EDGE = 4;
const INDICES_PER_EDGE = 6;
const EDGE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [1, 1],
  [1, -1],
];

function buildGeometry(): { vertices: Float32Array; indices: Uint16Array } {
  const vertices = new Float32Array(EDGES.length * VERTS_PER_EDGE * FLOATS_PER_VERT);
  const indices = new Uint16Array(EDGES.length * INDICES_PER_EDGE);

  for (let e = 0; e < EDGES.length; e++) {
    const [ax, ay, az, bx, by, bz] = EDGES[e]!;
    const vBase = e * VERTS_PER_EDGE;
    for (let c = 0; c < VERTS_PER_EDGE; c++) {
      const [endParam, side] = EDGE_CORNERS[c]!;
      const offset = (vBase + c) * FLOATS_PER_VERT;
      vertices[offset] = ax;
      vertices[offset + 1] = ay;
      vertices[offset + 2] = az;
      vertices[offset + 3] = bx;
      vertices[offset + 4] = by;
      vertices[offset + 5] = bz;
      vertices[offset + 6] = endParam;
      vertices[offset + 7] = side;
    }
    const iBase = e * INDICES_PER_EDGE;
    indices[iBase] = vBase;
    indices[iBase + 1] = vBase + 1;
    indices[iBase + 2] = vBase + 2;
    indices[iBase + 3] = vBase;
    indices[iBase + 4] = vBase + 2;
    indices[iBase + 5] = vBase + 3;
  }

  return { vertices, indices };
}

const INDEX_COUNT = EDGES.length * INDICES_PER_EDGE;

export class BlockHighlight {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uView: WebGLUniformLocation;
  private uProj: WebGLUniformLocation;
  private uBlockPos: WebGLUniformLocation;
  private uViewport: WebGLUniformLocation;
  private uLineWidth: WebGLUniformLocation;

  constructor(private gl: WebGL2RenderingContext) {
    this.program = WebGLUtilities.createProgram(gl, highlightVertSrc, highlightFragSrc);

    this.uView = gl.getUniformLocation(this.program, "uView")!;
    this.uProj = gl.getUniformLocation(this.program, "uProj")!;
    this.uBlockPos = gl.getUniformLocation(this.program, "uBlockPos")!;
    this.uViewport = gl.getUniformLocation(this.program, "uViewport")!;
    this.uLineWidth = gl.getUniformLocation(this.program, "uLineWidth")!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const { vertices, indices } = buildGeometry();
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const stride = FLOATS_PER_VERT * 4;
    const aPosA = gl.getAttribLocation(this.program, "aPosA");
    gl.enableVertexAttribArray(aPosA);
    gl.vertexAttribPointer(aPosA, 3, gl.FLOAT, false, stride, 0);
    const aPosB = gl.getAttribLocation(this.program, "aPosB");
    gl.enableVertexAttribArray(aPosB);
    gl.vertexAttribPointer(aPosB, 3, gl.FLOAT, false, stride, 12);
    const aEndParam = gl.getAttribLocation(this.program, "aEndParam");
    gl.enableVertexAttribArray(aEndParam);
    gl.vertexAttribPointer(aEndParam, 1, gl.FLOAT, false, stride, 24);
    const aSide = gl.getAttribLocation(this.program, "aSide");
    gl.enableVertexAttribArray(aSide);
    gl.vertexAttribPointer(aSide, 1, gl.FLOAT, false, stride, 28);

    gl.bindVertexArray(null);
  }

  draw(
    viewMatrix: Readonly<Mat4Like>,
    projMatrix: Readonly<Mat4Like>,
    viewportWidth: number,
    viewportHeight: number,
    blockX: number,
    blockY: number,
    blockZ: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniformMatrix4fv(this.uView, false, viewMatrix as Float32Array);
    gl.uniformMatrix4fv(this.uProj, false, projMatrix as Float32Array);
    gl.uniform3f(this.uBlockPos, blockX, blockY, blockZ);
    gl.uniform2f(this.uViewport, viewportWidth, viewportHeight);
    gl.uniform1f(this.uLineWidth, 2.5);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, INDEX_COUNT, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(null);
  }
}
