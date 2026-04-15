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
out float cubeType;
out vec3 cubeOrigin;
out vec4 faceAmbientOcclusion;

vec4 selectFaceAmbientOcclusion(vec4 norm) {
  if (norm.y > 0.5) return aAOTop;
  if (norm.x < -0.5) return aAOLeft;
  if (norm.x > 0.5) return aAORight;
  if (norm.z > 0.5) return aAOFront;
  if (norm.z < -0.5) return aAOBack;
  return aAOBottom;
}

void main() {
  wsPos = vec4(aVertPos.xyz + aOffset.xyz, 1.0);
  gl_Position = uProj * uView * wsPos;
  normal = normalize(aNorm);
  uv = aUV;
  color = aColor;
  cubeType = aOffset.w;
  cubeOrigin = aOffset.xyz;
  faceAmbientOcclusion = selectFaceAmbientOcclusion(aNorm);
}
