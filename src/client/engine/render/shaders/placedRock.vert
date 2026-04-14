precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aVertPos;
attribute vec4 aNorm;
attribute vec4 aOffset; // xyz = base position, w = yaw
attribute float aScale;

varying float lightMix;
varying float heightMix;
varying vec3 localPos;

void main() {
  float yaw = aOffset.w;
  float cy = cos(yaw);
  float sy = sin(yaw);

  vec3 local = vec3(aVertPos.x, aVertPos.y, aVertPos.z) * aScale;
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
  lightMix = clamp(dot(rotatedNormal, lightDir) * 0.65 + 0.4, 0.22, 1.0);
  heightMix = clamp(aVertPos.y / 0.78, 0.0, 1.0);
  localPos = local;
}
