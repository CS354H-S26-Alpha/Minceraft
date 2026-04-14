precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec4 aOffset;
attribute vec2 aUV;
attribute vec3 aColor;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 color;
varying float cubeType;
varying vec3 cubeOrigin; // integer cube position — constant across all vertices of an instance

void main() {
  gl_Position = uProj * uView * (aVertPos + vec4(aOffset.xyz, 1.0));
  wsPos = vec4(aOffset.xyz, 1.0) + aVertPos;
  normal = normalize(aNorm);
  uv = aUV;
  color = aColor;
  cubeType = aOffset.w;
  cubeOrigin = aOffset.xyz;
}
