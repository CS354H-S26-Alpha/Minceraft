precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec4 aOffset;
attribute vec2 aUV;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;

void main() {
  gl_Position = uProj * uView * (aVertPos + aOffset);
  wsPos = aVertPos + aOffset;
  normal = normalize(aNorm);
  uv = aUV;
}
