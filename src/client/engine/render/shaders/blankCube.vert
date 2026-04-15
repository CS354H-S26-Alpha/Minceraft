precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec4 aOffset;
attribute vec3 aColor;

varying vec4 normal;
varying vec4 wsPos;
varying vec3 color;

void main() {
  wsPos = vec4(aVertPos.xyz + aOffset.xyz, 1.0);
  gl_Position = uProj * uView * wsPos;
  normal = normalize(aNorm);
  color = aColor;
}
