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

out vec4 normal;
out vec4 wsPos;
out vec2 uv;
out vec3 color;
out float cubeType;
out vec3 cubeOrigin;

void main() {
  gl_Position = uProj * uView * (aVertPos + vec4(aOffset.xyz, 1.0));
  wsPos = vec4(aOffset.xyz, 1.0) + aVertPos;
  normal = normalize(aNorm);
  uv = aUV;
  color = aColor;
  cubeType = aOffset.w;
  cubeOrigin = aOffset.xyz;
}
