import { WebGLUtilities } from "./CanvasAnimation.js";

export class RenderPass {
  private ctx: WebGL2RenderingContext;

  /* Shader information */
  private vShader: string;
  private fShader: string;
  private shaderProgram: WebGLProgram;

  /* Attributes and indices */
  private VAO: WebGLVertexArrayObject;
  private indexBuffer: WebGLBuffer;
  private indexBufferData: Uint32Array;
  private attributeBuffers: Map<string, AttributeBuffer>;
  private attributes: Attribute[];

  private uniforms: Map<string, Uniform>;

  private drawMode: GLenum;
  private drawCount: number;
  private drawType: GLenum;
  private drawOffset: number;

  private textureMap: string;
  private textureMapped: boolean;
  private textureLoaded: boolean;
  public texture: WebGLTexture;

  private instancedAttributes: Set<string>;

  constructor(context: WebGL2RenderingContext, vShader: string, fShader: string) {
    this.ctx = context;
    this.instancedAttributes = new Set();
    this.vShader = vShader.slice();
    this.fShader = fShader.slice();
    this.shaderProgram = 0;

    this.VAO = 0;
    this.indexBuffer = 0;
    this.indexBufferData = new Uint32Array(0);
    this.attributeBuffers = new Map();
    this.attributes = [];

    this.uniforms = new Map();

    this.drawMode = 0;
    this.drawCount = 0;
    this.drawType = 0;
    this.drawOffset = 0;

    this.textureMapped = false;
    this.textureLoaded = false;
    this.textureMap = "";
    this.texture = 0;
  }

  public setup() {
    const gl = this.ctx;
    this.shaderProgram = WebGLUtilities.createProgram(gl, this.vShader, this.fShader);
    gl.useProgram(this.shaderProgram);

    /* Setup VAO */
    this.VAO = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(this.VAO);

    /* Setup Index Buffer */
    this.indexBuffer = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indexBufferData, gl.STATIC_DRAW);

    /* Setup Attribute Buffers */
    this.attributeBuffers.forEach((attrBuffer) => {
      attrBuffer.bufferId = gl.createBuffer() as WebGLBuffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer.bufferId);
      gl.bufferData(gl.ARRAY_BUFFER, attrBuffer.data, gl.STATIC_DRAW);
    });

    /* Setup Attributes */
    this.attributes.forEach((attr) => {
      const attrLoc = gl.getAttribLocation(this.shaderProgram, attr.name);
      if (attrLoc < 0) {
        return;
      }
      const attrBuffer = this.attributeBuffers.get(attr.bufferName);
      if (attrLoc >= 0 && attrBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer.bufferId);
        gl.vertexAttribPointer(attrLoc, attr.size, attr.type, attr.normalized, attr.stride, attr.offset);
        gl.enableVertexAttribArray(attrLoc);
        if (this.instancedAttributes.has(attr.name)) {
          gl.vertexAttribDivisor(attrLoc, 1);
        }
      } else if (!attrBuffer) {
        console.error("Attribute's buffer name not found", this);
      }
    });

    /* Setup Uniforms */
    for (const [key, value] of this.uniforms) {
      value.location = gl.getUniformLocation(this.shaderProgram, key) as WebGLUniformLocation;
    }

    /* Setup Maps */
    if (this.textureMapped) {
      if (!this.textureLoaded) {
        const createTextureResult = gl.createTexture();
        if (createTextureResult === null) {
          console.error("Error creating texture");
        } else {
          this.texture = createTextureResult;
        }
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255])); // Temporary color
        const img = new Image();
        img.onload = (_ev: Event) => {
          console.log(`Loaded texturemap: ${this.textureMap}`);
          gl.useProgram(this.shaderProgram);
          gl.bindVertexArray(this.VAO);
          gl.bindTexture(gl.TEXTURE_2D, this.texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.useProgram(null);
          gl.bindVertexArray(null);
        };
        img.src = `/static/assets/skinning/${this.textureMap}`;
      }
    }

    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  public draw() {
    const gl = this.ctx;
    gl.useProgram(this.shaderProgram);
    gl.bindVertexArray(this.VAO);

    this.uniforms.forEach((uniform) => {
      uniform.bindFunction(gl, uniform.location);
    });
    if (this.textureMapped) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }
    gl.drawElements(this.drawMode, this.drawCount, this.drawType, this.drawOffset);

    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  public addInstancedAttribute(
    attribName: string,
    size: number,
    type: GLenum,
    normalized: boolean,
    stride: number,
    offset: number,
    bufferName?: string,
    bufferData?: BufferData,
  ) {
    this.instancedAttributes.add(attribName);
    this.addAttribute(attribName, size, type, normalized, stride, offset, bufferName, bufferData);
  }

  public updateAttributeBuffer(attribName: string, data: BufferData) {
    const gl = this.ctx;
    gl.useProgram(this.shaderProgram);
    gl.bindVertexArray(this.VAO);
    const buf = this.attributeBuffers.get(attribName);
    if (buf) {
      buf.data = data;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.bufferId);
      if (data.byteLength > buf.byteCapacity) {
        const nextCapacity = Math.max(data.byteLength, Math.max(256, buf.byteCapacity * 2));
        gl.bufferData(gl.ARRAY_BUFFER, nextCapacity, gl.DYNAMIC_DRAW);
        buf.byteCapacity = nextCapacity;
      }
      if (data.byteLength > 0) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      }
    } else {
      console.error("Attribute buffer not found:", attribName);
    }
    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  public drawInstanced(instanceCount: number) {
    const gl = this.ctx;
    gl.useProgram(this.shaderProgram);
    gl.bindVertexArray(this.VAO);

    this.uniforms.forEach((uniform) => {
      uniform.bindFunction(gl, uniform.location);
    });
    if (this.textureMapped) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }
    gl.drawElementsInstanced(this.drawMode, this.drawCount, this.drawType, this.drawOffset, instanceCount);

    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  public setDrawData(drawMode: GLenum, drawCount: number, drawType: GLenum, drawOffset: number) {
    this.drawMode = drawMode;
    this.drawCount = drawCount;
    this.drawType = drawType;
    this.drawOffset = drawOffset;
  }

  public addUniform(name: string, bindFunction: (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => void) {
    this.uniforms.set(name, new Uniform(0, bindFunction));
  }

  public setIndexBufferData(data: Uint32Array) {
    this.indexBufferData = data;
  }

  public addAttribute(
    attribName: string,
    size: number,
    type: GLenum,
    normalized: boolean,
    stride: number,
    offset: number,
    bufferName?: string,
    bufferData?: BufferData,
  ) {
    if (!bufferName) {
      bufferName = attribName;
      if (!bufferData) {
        console.error("Impossible to determine data for buffer");
      } else {
        this.attributeBuffers.set(bufferName, new AttributeBuffer(0, bufferData));
      }
    } else {
      if (!this.attributeBuffers.has(bufferName)) {
        if (!bufferData) {
          console.error("Impossible to determine data for buffer");
        } else {
          this.attributeBuffers.set(bufferName, new AttributeBuffer(0, bufferData));
        }
      }
    }

    this.attributes.push(new Attribute(attribName, size, type, normalized, stride, offset, bufferName));
  }

  public addTextureMap(texture: string, vShader?: string, fShader?: string) {
    if (vShader) {
      this.vShader = vShader;
    }
    if (fShader) {
      this.fShader = fShader;
    }
    this.textureMapped = true;
    this.textureMap = texture;
  }

  public addTexture(tex: WebGLTexture) {
    this.textureMapped = true;
    this.textureLoaded = true;
    this.texture = tex;
  }

  public setVertexShader(vShader: string) {
    this.vShader = vShader;
  }
  public setFragmentShader(fShader: string) {
    this.fShader = fShader;
  }
  public setShaders(vShader: string, fShader: string) {
    this.vShader = vShader;
    this.fShader = fShader;
  }
}

class Uniform {
  public location: WebGLUniformLocation;
  public bindFunction: (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => void;

  constructor(
    location: WebGLUniformLocation,
    bindFunction: (gl: WebGL2RenderingContext, loc: WebGLUniformLocation) => void,
  ) {
    this.location = location;
    this.bindFunction = bindFunction;
  }
}

class Attribute {
  public name: string;
  public size: number;
  public type: GLenum;
  public normalized: boolean;
  public stride: number;
  public offset: number;
  public bufferName: string;

  constructor(
    name: string,
    size: number,
    type: GLenum,
    normalized: boolean,
    stride: number,
    offset: number,
    bufferName: string,
  ) {
    this.name = name;
    this.size = size;
    this.type = type;
    this.normalized = normalized;
    this.stride = stride;
    this.offset = offset;
    this.bufferName = bufferName;
  }
}

class AttributeBuffer {
  public bufferId: WebGLBuffer;
  public data: BufferData;
  public byteCapacity: number;

  constructor(bufferId: WebGLBuffer, data: BufferData) {
    this.bufferId = bufferId;
    this.data = data;
    this.byteCapacity = data.byteLength;
  }
}

type BufferData = Uint32Array | Float32Array | Int32Array | Uint8Array;
