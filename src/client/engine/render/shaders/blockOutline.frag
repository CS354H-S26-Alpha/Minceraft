#version 300 es
precision mediump float;

out vec4 fragColor;

void main() {
  // Fixed white color for the selection outline.
  fragColor = vec4(1.0, 1.0, 1.0, 1.0);
}
