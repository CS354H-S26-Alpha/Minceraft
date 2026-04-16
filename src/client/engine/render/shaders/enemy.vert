precision mediump float;

uniform mat4 uView;
uniform mat4 uProj;

// World-space offset for this enemy (added after skinning).
uniform vec3 uOffset;
// Facing direction in radians, around Y axis. Rotates the skinned mesh before
// translation so the body faces where it's walking.
uniform float uYaw;

// Current skeleton pose: per-bone world translations and rotations.
uniform vec3 jTrans[64];
uniform vec4 jRots[64];

attribute vec3 aNorm;
attribute vec2 aUV;
attribute vec4 skinIndices;
attribute vec4 skinWeights;
// Per-vertex position expressed in the local frame of each influencing bone.
attribute vec4 v0;
attribute vec4 v1;
attribute vec4 v2;
attribute vec4 v3;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;

// Rotate vector v by unit quaternion q.
vec3 qtrans(vec4 q, vec3 v) {
  return v + 2.0 * cross(cross(v, q.xyz) - q.w * v, q.xyz);
}

// Rotate vector v around the Y axis by angle a (radians).
vec3 yawRotate(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

void main() {
  int i0 = int(skinIndices.x);
  int i1 = int(skinIndices.y);
  int i2 = int(skinIndices.z);
  int i3 = int(skinIndices.w);

  vec3 pos0 = jTrans[i0] + qtrans(jRots[i0], v0.xyz);
  vec3 pos1 = jTrans[i1] + qtrans(jRots[i1], v1.xyz);
  vec3 pos2 = jTrans[i2] + qtrans(jRots[i2], v2.xyz);
  vec3 pos3 = jTrans[i3] + qtrans(jRots[i3], v3.xyz);

  vec3 skinned = skinWeights.x * pos0
               + skinWeights.y * pos1
               + skinWeights.z * pos2
               + skinWeights.w * pos3;

  vec3 oriented = yawRotate(skinned, uYaw);
  vec3 worldPos = oriented + uOffset;
  wsPos = vec4(worldPos, 1.0);
  gl_Position = uProj * uView * wsPos;

  // Normal is rotated by yaw only. Skinning normals against the bone
  // transforms is a TODO — fine for the current keyframe magnitudes.
  normal = vec4(yawRotate(aNorm, uYaw), 0.0);
  uv = aUV;
}
