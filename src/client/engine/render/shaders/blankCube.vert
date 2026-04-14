precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec4 aOffset;
attribute vec2 aUV;
attribute vec3 aColor;
attribute vec3 aFaceTiles0;
attribute vec3 aFaceTiles1;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 color;
varying float faceTile;

float resolveFaceTile(vec4 n, vec3 faceTiles0, vec3 faceTiles1) {
  if (n.y > 0.5) {
    return faceTiles0.x;
  }
  if (n.x < -0.5) {
    return faceTiles0.y;
  }
  if (n.x > 0.5) {
    return faceTiles0.z;
  }
  if (n.z > 0.5) {
    return faceTiles1.x;
  }
  if (n.z < -0.5) {
    return faceTiles1.y;
  }
  return faceTiles1.z;
}

void main() {
  wsPos = vec4(aVertPos.xyz + aOffset.xyz, 1.0);
  gl_Position = uProj * uView * wsPos;
  normal = normalize(aNorm);
  uv = aUV;
  color = aColor;
  faceTile = resolveFaceTile(aNorm, aFaceTiles0, aFaceTiles1);
}
