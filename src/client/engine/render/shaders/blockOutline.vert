#version 300 es
precision mediump float;

uniform mat4 uView;
uniform mat4 uProj;

in vec3 aVertPos;
in vec4 aOffset;

void main() {
  // Draw the wireframe exactly on voxel boundaries; depth bias handles coplanar visibility.
  vec3 worldPos = aVertPos + aOffset.xyz;
  gl_Position = uProj * uView * vec4(worldPos, 1.0);

  // Apply a small clip-space depth bias so lines render in front of coplanar terrain,
  // without pushing geometry into neighboring blocks.
  gl_Position.z -= 1e-4 * gl_Position.w;
}
