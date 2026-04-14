precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec4 aOffset; // xyz = base position
attribute float aScale;
attribute vec2 aMeta; // x = render type, y = random yaw
attribute vec2 aUV;

varying vec2 uv;
varying float objectType;
varying float lightMix;
varying float heightMix;
varying vec3 localPos;

vec2 sizeForType(float typeIndex) {
  if (typeIndex < 0.5) return vec2(0.45, 0.85);
  if (typeIndex < 1.5) return vec2(0.34, 1.45);
  if (typeIndex < 2.5) return vec2(0.42, 0.72);
  if (typeIndex < 3.5) return vec2(0.42, 0.78);
  if (typeIndex < 4.5) return vec2(1.1, 1.35);
  if (typeIndex < 5.5) return vec2(1.15, 1.05);
  if (typeIndex < 6.5) return vec2(2.2, 3.8);
  if (typeIndex < 7.5) return vec2(0.62, 0.8);
  return vec2(1.35, 2.3);
}

void main() {
  float yaw = aMeta.y;
  float cy = cos(yaw);
  float sy = sin(yaw);
  vec2 size = sizeForType(aMeta.x) * aScale;

  vec3 local = vec3(aVertPos.x * size.x, (aVertPos.y + 0.5) * size.y, aVertPos.z * size.x);
  vec3 rotated = vec3(
    local.x * cy + local.z * sy,
    local.y,
    -local.x * sy + local.z * cy
  );
  vec3 worldPos = aOffset.xyz + rotated;

  vec3 localNormal = vec3(aNorm.x, aNorm.y, aNorm.z);
  vec3 rotatedNormal = normalize(vec3(
    localNormal.x * cy + localNormal.z * sy,
    localNormal.y,
    -localNormal.x * sy + localNormal.z * cy
  ));
  vec3 lightDir = normalize(uLightPos.xyz - worldPos);

  gl_Position = uProj * uView * vec4(worldPos, 1.0);
  uv = aUV;
  objectType = aMeta.x;
  lightMix = clamp(dot(rotatedNormal, lightDir) * 0.45 + 0.55, 0.3, 1.0);
  heightMix = clamp((aVertPos.y + 0.5), 0.0, 1.0);
  localPos = rotated;
}
