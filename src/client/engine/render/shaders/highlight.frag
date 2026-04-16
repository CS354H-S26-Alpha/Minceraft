#version 300 es
precision mediump float;

out vec4 fragColor;

void main() {
  // Minecraft-style outline: near-solid black, slight translucency to soften.
  fragColor = vec4(0.0, 0.0, 0.0, 0.85);
}
