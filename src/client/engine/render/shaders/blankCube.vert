#version 300 es
precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

in vec4 aNorm;
in vec4 aVertPos;
in vec4 aOffset;
in vec2 aUV;
in vec3 aColor;
in vec4 aAOTop;
in vec4 aAOLeft;
in vec4 aAORight;
in vec4 aAOFront;
in vec4 aAOBack;
in vec4 aAOBottom;

out vec4 normal;
out vec4 wsPos;
out vec2 uv;
out vec3 color;
flat out vec4 faceAmbientOcclusion;
flat out float cubeType;
flat out float cubeSeed;

// Branchless face-AO selection — one of the six step() masks is 1.0, rest are 0.0.
vec4 selectFaceAmbientOcclusion(vec4 norm) {
  return step( 0.5,  norm.y) * aAOTop
       + step( 0.5, -norm.y) * aAOBottom
       + step( 0.5,  norm.x) * aAORight
       + step( 0.5, -norm.x) * aAOLeft
       + step( 0.5,  norm.z) * aAOFront
       + step( 0.5, -norm.z) * aAOBack;
}

// Per-cube seed (mod 289 prevents collapse at large world coords)
float seedFromOrigin(vec3 c) {
  c = mod(c, 289.0);
  vec3 p = fract(c * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  wsPos = vec4(aVertPos.xyz + aOffset.xyz, 1.0);
  gl_Position = uProj * uView * wsPos;
  normal = normalize(aNorm);
  uv = aUV;
  color = aColor;
  cubeType = aOffset.w;
  cubeSeed = seedFromOrigin(aOffset.xyz);
  faceAmbientOcclusion = selectFaceAmbientOcclusion(aNorm);
}
