#version 300 es
precision highp float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;

// Per-type LUT uniforms (indexed by CubeType, 12 entries each).
// col1 = mix(color,          uLut1Fixed[type], uLut1Blend[type])
// col2 = mix(color * scale,  uLut2Fixed[type], uLut2Blend[type])
uniform vec3  uLut1Fixed[12];
uniform float uLut1Blend[12];
uniform vec3  uLut2Fixed[12];
uniform float uLut2Blend[12];
uniform float uLut2Scale[12];

in vec4 normal;
in vec4 wsPos;
in vec2 uv;
in vec3 color;
in float cubeType;
in vec3 cubeOrigin;

out vec4 fragColor;

// CubeType enum values — must stay in sync with cube-types.ts
const int CUBE_GRASS       = 1;
const int CUBE_FORESTGRASS = 7;

// Scalar hash: vec2 + seed → [0, 1]
float hash(vec2 p, float seed) {
  p = mod(p + seed * 17.3, 289.0);
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

// 2D value noise: 4 hash lookups + bilinear smooth interpolation
float noise(vec2 p, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i,                  seed), hash(i + vec2(1.0, 0.0), seed), f.x),
    mix(hash(i + vec2(0.0, 1.0), seed), hash(i + vec2(1.0, 1.0), seed), f.x),
    f.y
  );
}

// Per-cube seed (mod 289 prevents collapse at large world coords)
float cubeSeed(vec3 c) {
  c = mod(c, 289.0);
  vec3 p = fract(c * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  int   type = int(cubeType + 0.5);
  float seed = cubeSeed(cubeOrigin);

  // Branchless LUT lookup — same code path for all block types
  vec3 col1 = mix(color,                    uLut1Fixed[type], uLut1Blend[type]);
  vec3 col2 = mix(color * uLut2Scale[type], uLut2Fixed[type], uLut2Blend[type]);

  // Grass/ForestGrass: face-dependent colour — unavoidable since it varies per fragment
  if (type == CUBE_GRASS || type == CUBE_FORESTGRASS) {
    vec3  dirt       = (type == CUBE_GRASS) ? vec3(0.55, 0.36, 0.18) : vec3(0.45, 0.30, 0.15);
    float topFace    = step(0.5,  normal.y);
    float bottomFace = step(0.5, -normal.y);
    float sideFace   = 1.0 - topFace - bottomFace;
    float strip      = sideFace * (1.0 - smoothstep(0.0, 0.18, uv.y));
    col1 = topFace * color + bottomFace * dirt + sideFace * mix(dirt, color, strip);
    col2 = col1 * 0.5;
  }

  float t  = noise(uv * 4.0 + seed * 3.1, seed);
  vec3  kd = mix(col2, col1 * 1.1, t);

  vec4  lightDir = uLightPos - wsPos;
  float dot_nl   = clamp(dot(normalize(lightDir), normalize(normal)), 0.0, 1.0);
  fragColor      = vec4(clamp(kd * (uAmbient + dot_nl * uSunColor), 0.0, 1.0), 1.0);
}
