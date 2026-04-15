#version 300 es
precision mediump float;

uniform mat4 uProj;
uniform mat4 uViewNoTranslation;

in vec4 aVertPos;

out vec3 vDir;

void main() {
  vDir = aVertPos.xyz;
  gl_Position = uProj * uViewNoTranslation * vec4(aVertPos.xyz, 1.0);
}
