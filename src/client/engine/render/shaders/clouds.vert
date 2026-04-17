#version 300 es
precision mediump float;

uniform mat4 uProj;
uniform mat4 uViewNoTranslation;

in vec4 aVertPos;

out vec3 vDir;

void main() {
  vec3 pos = aVertPos.xyz - 0.5;
  vDir = pos;
  gl_Position = uProj * uViewNoTranslation * vec4(pos, 1.0);
}
