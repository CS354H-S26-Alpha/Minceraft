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
  // without pushing geometry into neighboring blocks. Clamp the biased depth so it
  // stays just inside the near clip plane when the outline is very close to the camera.
  const float depthBias = 1e-4;
  const float nearClipEpsilon = 1e-6;
  float biasedZ = gl_Position.z - depthBias * gl_Position.w;
  gl_Position.z = max(biasedZ, -gl_Position.w + nearClipEpsilon);
}
