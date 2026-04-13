precision mediump float;

uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aVertPos;
attribute vec4 aOffset; // xyz = base position, w = render type
attribute float aScale;
attribute vec2 aUV;

varying vec2 uv;
varying float objectType;

vec2 sizeForType(float typeIndex) {
  if (typeIndex < 0.5) return vec2(0.45, 0.85);
  if (typeIndex < 1.5) return vec2(0.9, 1.1);
  if (typeIndex < 2.5) return vec2(1.0, 1.0);
  if (typeIndex < 3.5) return vec2(1.8, 3.4);
  return vec2(1.2, 2.2);
}

void main() {
  vec2 local = vec2(aVertPos.x, aVertPos.y + 0.5);
  vec2 size = sizeForType(aOffset.w) * aScale;

  vec3 cameraRight = normalize(uView[0].xyz);
  vec3 cameraUp = normalize(uView[1].xyz);
  vec3 worldPos = aOffset.xyz + cameraRight * local.x * size.x + cameraUp * local.y * size.y;

  gl_Position = uProj * uView * vec4(worldPos, 1.0);
  uv = aUV;
  objectType = aOffset.w;
}
