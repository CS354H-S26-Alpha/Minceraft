#version 300 es
precision mediump float;

uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uBlockPos;

in vec3 aPos;

void main() {
  gl_Position = uProj * uView * vec4(aPos + uBlockPos, 1.0);
}
