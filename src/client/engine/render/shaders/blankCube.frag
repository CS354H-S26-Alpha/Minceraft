#version 300 es
precision highp float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

// Per-type LUT uniforms (indexed by CubeType, 20 entries each).
// col1 = mix(color,          uLut1Fixed[type], uLut1Blend[type])
// col2 = mix(color * scale,  uLut2Fixed[type], uLut2Blend[type])
uniform vec3 uLut1Fixed[20];
uniform float uLut1Blend[20];
uniform vec3 uLut2Fixed[20];
uniform float uLut2Blend[20];
uniform float uLut2Scale[20];

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
const int CUBE_WATER = 12;
const int CUBE_LAVA = 13;
const int CUBE_PERMAFROST = 14;

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

// Animated scrolling-fbm for fluids — two counter-scrolling octaves summed so
// the surface moves without tearing at block boundaries.
float fluidNoise(vec2 p, float t) {
  float slow = fbm(p * 0.9 + vec2(t * 0.35, -t * 0.27), 0.0);
  float fast = fbm(p * 2.4 + vec2(-t * 0.65, t * 0.45), 3.7);
  return 0.6 * slow + 0.5 * fast;
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
    vec3 dirt = vec3(0.55, 0.36, 0.18);
    float topFace = step(0.5, normal.y);
    float bottomFace = step(0.5, -normal.y);
    float sideFace = 1.0 - topFace - bottomFace;
    float fringe = 0.2 + 0.25 * noise1D(quv.x * 6.0, seed);
    float strip = sideFace * step(quv.y, fringe);
    col1 = topFace * color + bottomFace * dirt + sideFace * mix(dirt, color, strip);
    col2 = col1 * 0.5;
  }

  vec3 kd;
  if (type == CUBE_WATER || type == CUBE_LAVA) {
    // Pixelated and time-stepped: 16-texel-per-block spatial grid, 12 fps
    // temporal grid. Matches the chunky aesthetic of solid-block surfaces.
    vec2 wp = (floor(wsPos.xz * 16.0) + 0.5) / 16.0;
    float qT = floor(uTime * 12.0) / 12.0;
    float n = fluidNoise(wp, qT);
    if (type == CUBE_WATER) {
      // Same fbm + 3-palette shape as lava, just blue: dark deep water,
      // mid-range blue body, bright highlight on noise peaks.
      vec3 deep   = vec3(0.03, 0.16, 0.48);
      vec3 mid    = vec3(0.12, 0.50, 0.95);
      vec3 bright = vec3(0.72, 0.92, 1.00);
      float wave  = smoothstep(0.30, 0.80, n);
      kd = mix(deep, mid, wave);
      kd = mix(kd, bright, step(0.82, n));
    } else {
      // Lava crust: mostly dark with glowing cracks where the noise peaks.
      vec3 crust  = vec3(0.22, 0.03, 0.01);
      vec3 molten = vec3(1.00, 0.48, 0.06);
      vec3 bright = vec3(1.00, 0.92, 0.55);
      float heat  = smoothstep(0.30, 0.80, n);
      kd = mix(crust, molten, heat);
      kd = mix(kd, bright, step(0.82, n));
    }
  } else if (type >= CUBE_COAL_ORE && type <= CUBE_DIAMOND_ORE) {
    // Sharper, higher-frequency speckles — ore tint reads as distinct spots on stone.
    float speckle = fbm(quv * 11.0 + seed * 5.0, seed + 2.3);
    float mask = step(0.5, speckle);
    kd = mix(col1, col2, mask);
  } else {
    float t = fbm(quv * 9.0 + seed * 3.1, seed);
    kd = mix(col2, col1 * 1.1, t);
  }

  if (type != CUBE_WATER && type != CUBE_LAVA) {
    // Per-block tonal jitter — avoided on fluids so their surface animation
    // stays smooth across adjacent voxels rather than stepping block-by-block.
    kd *= 0.92 + 0.16 * seed;
  }

  // uLightPos is supplied by the render path as a world-space light position,
  // so derive the incoming light direction per fragment from the fragment world position.
  vec3 lightDir = normalize(uLightPos.xyz - wsPos.xyz);
  float dot_nl = clamp(dot(lightDir, normalize(normal.xyz)), 0.0, 1.0);

  // Smooth bilinear AO — interpolated per-fragment (not quantized to the texel grid)
  float aoLow = mix(faceAmbientOcclusion.x, faceAmbientOcclusion.w, uv.x);
  float aoHigh = mix(faceAmbientOcclusion.y, faceAmbientOcclusion.z, uv.x);
  float ao = clamp(mix(aoLow, aoHigh, uv.y) / 3.0, 0.0, 1.0);
  float aoFactor = mix(0.3, 1.0, pow(ao, 0.75));

  vec3 lit;
  if (type == CUBE_LAVA) {
    // Lava glows regardless of sun; ambient still tints it so caves feel
    // dimmer than daylight but never pitch-black-black.
    lit = kd * (0.85 + 0.25 * uAmbient);
  } else if (type == CUBE_WATER) {
    // Water is lit by the sun but skips the heavy AO — dark cave water
    // otherwise reads as ink.
    float waterAO = mix(0.65, 1.0, aoFactor);
    lit = kd * (uAmbient + dot_nl * uSunColor) * waterAO;
  } else {
    lit = kd * (uAmbient + dot_nl * uSunColor) * aoFactor;
  }

  vec3 toned = lit / (1.0 + lit * 0.5);

  // Render-distance fog, matching Minecraft 1.21's cylindrical metric:
  // max(horizontal distance, vertical distance) — fogs the sky column above
  // and the void below as well as the horizon, so load boundaries in any
  // direction fade into the sky.
  vec3 d = wsPos.xyz - uCameraPos;
  float cylDist = max(length(d.xz), abs(d.y));
  float fog = clamp((cylDist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
  fragColor = vec4(mix(toned, uFogColor, fog), 1.0);
}
