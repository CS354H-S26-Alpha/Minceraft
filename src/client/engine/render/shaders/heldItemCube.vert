precision mediump float;

uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uCubeModel;

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

vec3 rotateY(vec3 value, float radians) {
  float cy = cos(radians);
  float sy = sin(radians);
  return vec3(
    value.x * cy + value.z * sy,
    value.y,
    -value.x * sy + value.z * cy
  );
}

void main() {
  vec4 modelPos = uCubeModel * aVertPos;
  wsPos = vec4(rotateY(modelPos.xyz, aOffset.w) + aOffset.xyz, 1.0);
  gl_Position = uProj * uView * wsPos;
  normal = vec4(normalize(rotateY((uCubeModel * aNorm).xyz, aOffset.w)), 0.0);
  uv = aUV;
  color = aColor;
  faceTile = resolveFaceTile(aNorm, aFaceTiles0, aFaceTiles1);
}
