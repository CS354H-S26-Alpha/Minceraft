/** biome-ignore-all lint/style/noNonNullAssertion: WebGL factory methods are non-null in valid contexts */
import type { Mat4Like } from "gl-matrix";
import highlightFragSrc from "./shaders/highlight.frag";
import highlightVertSrc from "./shaders/highlight.vert";

// Wireframe cube: 12 edges, each edge is a GL_LINES segment.
// Vertices are slightly expanded (-E to 1+E) to avoid z-fighting with block faces.
const E = 0.005;
const LO = -E;
const HI = 1 + E;

// prettier-ignore
const WIREFRAME_VERTICES = new Float32Array([
  // Bottom face edges
  LO,
  LO,
  LO,
  HI,
  LO,
  LO,
  HI,
  LO,
  LO,
  HI,
  LO,
  HI,
  HI,
  LO,
  HI,
  LO,
  LO,
  HI,
  LO,
  LO,
  HI,
  LO,
  LO,
  LO,
  // Top face edges
  LO,
  HI,
  LO,
  HI,
  HI,
  LO,
  HI,
  HI,
  LO,
  HI,
  HI,
  HI,
  HI,
  HI,
  HI,
  LO,
  HI,
  HI,
  LO,
  HI,
  HI,
  LO,
  HI,
  LO,
  // Vertical edges
  LO,
  LO,
  LO,
  LO,
  HI,
  LO,
  HI,
  LO,
  LO,
  HI,
  HI,
  LO,
  HI,
  LO,
  HI,
  HI,
  HI,
  HI,
  LO,
  LO,
  HI,
  LO,
  HI,
  HI,
]);

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export class BlockHighlight {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uView: WebGLUniformLocation;
  private uProj: WebGLUniformLocation;
  private uBlockPos: WebGLUniformLocation;

  constructor(private gl: WebGL2RenderingContext) {
    const vert = compileShader(gl, gl.VERTEX_SHADER, highlightVertSrc);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, highlightFragSrc);

    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vert);
    gl.attachShader(this.program, frag);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(this.program)}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    this.uView = gl.getUniformLocation(this.program, "uView")!;
    this.uProj = gl.getUniformLocation(this.program, "uProj")!;
    this.uBlockPos = gl.getUniformLocation(this.program, "uBlockPos")!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, WIREFRAME_VERTICES, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  draw(
    viewMatrix: Readonly<Mat4Like>,
    projMatrix: Readonly<Mat4Like>,
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

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.lineWidth(2.0);
    gl.drawArrays(gl.LINES, 0, 24);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(null);
  }
}
