precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uTime;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec4 aOffset; // xyz = position, w = yaw
attribute float aPitch;
attribute vec2 aUV;
attribute vec3 aColor;
attribute float aShirtMask;
attribute float aPart;
attribute vec3 aPivot;
attribute vec2 aMotion; // x = planar speed, y = phase offset
attribute vec3 aShirtColor;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 baseColor;
varying float headFrontFace;

const float PART_HEAD = 0.0;
const float PART_LEFT_ARM = 2.0;
const float PART_RIGHT_ARM = 3.0;
const float PART_LEFT_LEG = 4.0;
const float PART_RIGHT_LEG = 5.0;
const float MAX_WALK_SPEED = 4.317;
const float STRIDE_LENGTH = 1.55;

vec3 rotateAroundX(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

vec3 rotateAroundY(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

float sampleKeyframes(float phase, float k0, float k1, float k2, float k3) {
  float scaled = fract(phase) * 4.0;
  if (scaled < 1.0) return mix(k0, k1, scaled);
  if (scaled < 2.0) return mix(k1, k2, scaled - 1.0);
  if (scaled < 3.0) return mix(k2, k3, scaled - 2.0);
  return mix(k3, k0, scaled - 3.0);
}

void main() {
  float walkSpeed = min(aMotion.x, MAX_WALK_SPEED * 1.35);
  float walkAmount = smoothstep(0.04, 0.18, clamp(walkSpeed / MAX_WALK_SPEED, 0.0, 1.2));
  float walkPhase = uTime * (walkSpeed / STRIDE_LENGTH) + aMotion.y;
  float armSwing = sampleKeyframes(walkPhase, -1.0, 0.0, 1.0, 0.0) * 0.9 * walkAmount;
  float legSwing = sampleKeyframes(walkPhase, 1.0, 0.0, -1.0, 0.0) * 0.75 * walkAmount;
  float bodyBob = sampleKeyframes(walkPhase, 0.0, 1.0, 0.0, 1.0) * 0.05 * walkAmount;

  float yaw = -aOffset.w + 3.14159265;
  vec3 localPos = aVertPos.xyz;
  vec3 localNorm = aNorm.xyz;
  float partRotation = 0.0;

  if (abs(aPart - PART_HEAD) < 0.5) {
    partRotation = clamp(-aPitch, -0.7, 0.55);
  } else if (abs(aPart - PART_LEFT_ARM) < 0.5) {
    partRotation = armSwing;
  } else if (abs(aPart - PART_RIGHT_ARM) < 0.5) {
    partRotation = -armSwing;
  } else if (abs(aPart - PART_LEFT_LEG) < 0.5) {
    partRotation = legSwing;
  } else if (abs(aPart - PART_RIGHT_LEG) < 0.5) {
    partRotation = -legSwing;
  }

  localPos = aPivot + rotateAroundX(localPos - aPivot, partRotation);
  localNorm = rotateAroundX(localNorm, partRotation);
  localPos.y += bodyBob;

  vec3 rotated = rotateAroundY(localPos, yaw);
  vec3 worldPos = rotated + aOffset.xyz;
  gl_Position = uProj * uView * vec4(worldPos, 1.0);
  wsPos = vec4(worldPos, 1.0);

  vec3 rotatedNormal = rotateAroundY(localNorm, yaw);
  normal = vec4(normalize(rotatedNormal), 0.0);
  uv = aUV;
  baseColor = mix(aColor, aShirtColor, aShirtMask);
  headFrontFace = abs(aPart - PART_HEAD) < 0.5 && aNorm.z > 0.5 ? 1.0 : 0.0;
}
