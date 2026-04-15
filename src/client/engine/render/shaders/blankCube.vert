precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec2 aUV;
attribute vec4 aOffset;
attribute vec3 aColor;
attribute vec4 aAoTop;
attribute vec4 aAoLeft;
attribute vec4 aAoRight;
attribute vec4 aAoFront;
attribute vec4 aAoBack;
attribute vec4 aAoBottom;

varying vec4 normal;
varying vec4 wsPos;
varying vec3 color;
varying vec4 faceAo;
varying vec2 faceUv;

void main() {
  wsPos = vec4(aVertPos.xyz + aOffset.xyz, 1.0);
  gl_Position = uProj * uView * wsPos;
  normal = normalize(aNorm);
  color = aColor;
  faceUv = aUV;

  if (normal.y > 0.5) {
    faceAo = aAoTop;
  } else if (normal.y < -0.5) {
    faceAo = aAoBottom;
  } else if (normal.x < -0.5) {
    faceAo = aAoLeft;
  } else if (normal.x > 0.5) {
    faceAo = aAoRight;
  } else if (normal.z > 0.5) {
    faceAo = aAoFront;
  } else {
    faceAo = aAoBack;
  }
}
