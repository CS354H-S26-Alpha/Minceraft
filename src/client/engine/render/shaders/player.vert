precision mediump float;

uniform vec4 uLightPos;
uniform mat4 uView;
uniform mat4 uProj;

attribute vec4 aNorm;
attribute vec4 aVertPos;
attribute vec4 aOffset; // xyz = position, w = yaw
attribute float aPitch;
attribute vec2 aUV;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;

void main() {
  float yaw = -aOffset.w + 3.14159265;
  float cy = cos(yaw);
  float sy = sin(yaw);
  float cp = cos(-aPitch);
  float sp = sin(-aPitch);

  // Rotate vertex by pitch (around local X axis), then yaw (around Y axis)
  vec3 pitched = vec3(
      aVertPos.x,
      aVertPos.y * cp - aVertPos.z * sp,
      aVertPos.y * sp + aVertPos.z * cp
    );
  vec3 rotated = vec3(
      pitched.x * cy + pitched.z * sy,
      pitched.y,
      -pitched.x * sy + pitched.z * cy
    );

  vec3 worldPos = rotated + aOffset.xyz;
  gl_Position = uProj * uView * vec4(worldPos, 1.0);
  wsPos = vec4(worldPos, 1.0);

  // Rotate normal the same way
  vec3 np = vec3(
      aNorm.x,
      aNorm.y * cp - aNorm.z * sp,
      aNorm.y * sp + aNorm.z * cp
    );
  vec3 rn = vec3(
      np.x * cy + np.z * sy,
      np.y,
      -np.x * sy + np.z * cy
    );
  normal = vec4(normalize(rn), 0.0);
  uv = aUV;
}
