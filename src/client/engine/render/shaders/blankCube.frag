#version 300 es
precision highp float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;

// Per-type LUT uniforms (indexed by CubeType, 12 entries each).
// col1 = mix(color,          uLut1Fixed[type], uLut1Blend[type])
// col2 = mix(color * scale,  uLut2Fixed[type], uLut2Blend[type])
uniform vec3 uLut1Fixed[12];
uniform float uLut1Blend[12];
uniform vec3 uLut2Fixed[12];
uniform float uLut2Blend[12];
uniform float uLut2Scale[12];

in vec4 normal;
in vec4 wsPos;
in vec2 uv;
in vec3 color;
flat in float cubeType;
flat in float cubeSeed;
flat in vec4 faceAmbientOcclusion;

out vec4 fragColor;

// CubeType enum values — must stay in sync with cube-types.ts
const int CUBE_GRASS = 1;
const int CUBE_FORESTGRASS = 7;
const int CUBE_COAL_ORE = 8;
const int CUBE_DIAMOND_ORE = 11;
const int CUBE_PERMAFROST  = 14;

// Scalar hash: vec2 + seed → [0, 1]
float hash(vec2 p, float seed) {
  p = mod(p + seed * 17.3, 289.0);
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

// 1D value noise: 2 hash lookups + smooth interpolation
float noise1D(float x, float seed) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2(i, 0.0), seed), hash(vec2(i + 1.0, 0.0), seed), f);
}

// 2D value noise: 4 hash lookups + bilinear smooth interpolation
float noise(vec2 p, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i, seed), hash(i + vec2(1.0, 0.0), seed), f.x),
    mix(hash(i + vec2(0.0, 1.0), seed), hash(i + vec2(1.0, 1.0), seed), f.x),
    f.y
  );
}

// 2-octave FBM — coarse shape + finer grain
float fbm(vec2 p, float seed) {
  float v = 0.6 * noise(p, seed);
  v += 0.3 * noise(p * 2.13, seed + 1.7);
  return v;
}

void main() {
  int type = int(cubeType + 0.5);
  float seed = cubeSeed;

  // Quantize UV to a 16×16 grid — one flat-shaded colour per texel, Minecraft-style.
  // Clamp the floored texel index so UVs that land exactly on 1.0 stay within the 0..15 grid.
  vec2 quv = (min(floor(uv * 16.0), vec2(15.0)) + 0.5) / 16.0;

  // Branchless LUT lookup — same code path for all block types
  vec3 col1 = mix(color, uLut1Fixed[type], uLut1Blend[type]);
  vec3 col2 = mix(color * uLut2Scale[type], uLut2Fixed[type], uLut2Blend[type]);

  // Grass/ForestGrass: face-dependent colour — unavoidable since it varies per fragment
  if (type == CUBE_GRASS || type == CUBE_FORESTGRASS || type == CUBE_PERMAFROST) {
    vec3  dirt       = (type == CUBE_GRASS) ? vec3(0.55, 0.36, 0.18) : vec3(0.45, 0.30, 0.15);
    float topFace    = step(0.5,  normal.y);
    float bottomFace = step(0.5, -normal.y);
    float sideFace = 1.0 - topFace - bottomFace;
    float fringe = 0.2 + 0.25 * noise1D(quv.x * 6.0, seed);
    float strip = sideFace * step(quv.y, fringe);
    col1 = topFace * color + bottomFace * dirt + sideFace * mix(dirt, color, strip);
    col2 = col1 * 0.5;
  }

  vec3 kd;
  if (type >= CUBE_COAL_ORE && type <= CUBE_DIAMOND_ORE) {
    // Sharper, higher-frequency speckles — ore tint reads as distinct spots on stone.
    float speckle = fbm(quv * 11.0 + seed * 5.0, seed + 2.3);
    float mask = step(0.5, speckle);
    kd = mix(col1, col2, mask);
  } else {
    float t = fbm(quv * 9.0 + seed * 3.1, seed);
    kd = mix(col2, col1 * 1.1, t);
  }

  kd *= 0.92 + 0.16 * seed;

  // uLightPos is supplied by the render path as a world-space light position,
  // so derive the incoming light direction per fragment from the fragment world position.
  vec3 lightDir = normalize(uLightPos.xyz - wsPos.xyz);
  float dot_nl = clamp(dot(lightDir, normalize(normal.xyz)), 0.0, 1.0);

  // Smooth bilinear AO — interpolated per-fragment (not quantized to the texel grid)
  float aoLow = mix(faceAmbientOcclusion.x, faceAmbientOcclusion.w, uv.x);
  float aoHigh = mix(faceAmbientOcclusion.y, faceAmbientOcclusion.z, uv.x);
  float ao = clamp(mix(aoLow, aoHigh, uv.y) / 3.0, 0.0, 1.0);
  float aoFactor = mix(0.3, 1.0, pow(ao, 0.75));

  vec3 lit = kd * (uAmbient + dot_nl * uSunColor) * aoFactor;

  fragColor = vec4(lit / (1.0 + lit * 0.5), 1.0);
}
