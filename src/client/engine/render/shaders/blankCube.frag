precision mediump float;

uniform vec4 uLightPos;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 color;
varying float cubeType;
varying vec3 cubeOrigin;

// CubeType enum values — must stay in sync with cube-types.ts
const int CUBE_AIR         = 0;
const int CUBE_GRASS       = 1;
const int CUBE_DIRT        = 2;
const int CUBE_STONE       = 3;
const int CUBE_SAND        = 4;
const int CUBE_SNOW        = 5;
const int CUBE_BEDROCK     = 6;
const int CUBE_FORESTGRASS = 7;
const int CUBE_COALORE     = 8;
const int CUBE_IRONORE     = 9;
const int CUBE_GOLDORE     = 10;
const int CUBE_DIAMONDORE  = 11;

// ============================================================
// Gradient (Perlin) noise
// ============================================================

vec3 hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7,  74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}

// 3D Perlin noise, returns [-1, 1]
// Uses linear interpolation for harder, less smooth edges.
float perlin3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f; // linear — sharper than smoothstep

  float v000 = dot(hash3(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));
  float v100 = dot(hash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float v010 = dot(hash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float v110 = dot(hash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float v001 = dot(hash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float v101 = dot(hash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float v011 = dot(hash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float v111 = dot(hash3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));

  return mix(
    mix(mix(v000, v100, u.x), mix(v010, v110, u.x), u.y),
    mix(mix(v001, v101, u.x), mix(v011, v111, u.x), u.y),
    u.z
  );
}

// ============================================================
// Per-cube seed + UV-based noise
//
// Spec: "a shader function which computes a color given uv
// coordinates and a random seed."
//
// seed  — scalar in [0, 1] derived from the cube's integer
//         world-space position; unique per cube, stable per face.
// nCoord(freq) — builds the 3D noise input from uv (the
//         within-face coordinate) and the seed (the between-cube
//         randomiser), so pattern shape comes from UV and
//         per-cube uniqueness comes from the seed.
// ============================================================

// Hash cube integer coords to a scalar seed in [0, 1].
float cubeSeed(vec3 cubeCoord) {
  vec3 h = vec3(
    dot(cubeCoord, vec3(127.1, 311.7,  74.7)),
    dot(cubeCoord, vec3(269.5, 183.3, 246.1)),
    dot(cubeCoord, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(dot(h, vec3(1.0, 57.0, 113.0))) * 43758.5453);
}

// Build a 3D noise coordinate from UV + seed.
// uv  → determines the texture pattern shape on this face
// seed → shifts the pattern so each cube looks different
vec3 nCoord(float freq, float seed) {
  return vec3(uv * freq + vec2(seed * 31.7, seed * 19.3), seed * 5.0);
}

// 4-octave fBm over nCoord, returns [0, 1].
float fbm(float freq, float seed) {
  vec3 p     = nCoord(freq, seed);
  float n    = 0.0;
  float amp  = 0.5;
  float total = 0.0;
  n += amp * perlin3D(p);                               total += amp; amp *= 0.6;
  n += amp * perlin3D(p * 2.1 + vec3(5.2,  1.3, 2.8)); total += amp; amp *= 0.6;
  n += amp * perlin3D(p * 4.3 + vec3(1.7,  9.2, 3.5)); total += amp; amp *= 0.6;
  n += amp * perlin3D(p * 8.7 + vec3(8.3,  2.8, 6.1)); total += amp;
  return clamp(0.5 + 0.5 * (n / total), 0.0, 1.0);
}

// ============================================================
// Texture categories
// To add a new block type: pick a category and add one line
// to the dispatch table in main().
// ============================================================

// GRASS-LIKE — green top, dirt sides with green strip, dirt bottom.
vec3 textureGrassLike(vec3 top, vec3 dirt, float freq, float seed) {
  float n = fbm(freq, seed);
  // sharpen: push noise away from mid-grey toward extremes
  n = smoothstep(0.2, 0.8, n);
  if (normal.y > 0.5) {
    return top * (0.55 + 0.9 * n);
  } else if (normal.y < -0.5) {
    float nb = smoothstep(0.2, 0.8, fbm(freq * 0.6, seed));
    return dirt * (0.55 + 0.9 * nb);
  } else {
    float sideN      = smoothstep(0.2, 0.8, fbm(freq * 0.6, seed));
    float greenStrip = 1.0 - smoothstep(0.0, 0.18, uv.y);
    return mix(dirt * (0.55 + 0.9 * sideN), top * (0.55 + 0.9 * sideN), greenStrip);
  }
}

// SIMPLE — noise blend between shadow and base, contrast-boosted.
vec3 textureSimple(vec3 base, vec3 shadowColor, float freq, float seed) {
  float n = smoothstep(0.15, 0.85, fbm(freq, seed));
  return mix(shadowColor, base * 1.2, n);
}

// CRACKED — coarse base with deep, sharp veins.
vec3 textureCracked(vec3 base, float coarseFreq, float crackFreq, float seed) {
  float coarse = smoothstep(0.2, 0.8, fbm(coarseFreq, seed));
  // sharp cracks: raw perlin near zero = dark vein
  float crack  = abs(perlin3D(nCoord(crackFreq, seed)));
  crack = 1.0 - smoothstep(0.0, 0.25, crack); // thin bright lines → thin dark cracks
  crack = crack * crack;
  return base * (0.35 + 1.1 * mix(coarse, 1.0 - crack, 0.5));
}

// RIPPLED — bold sine bands with strong grain overlay.
vec3 textureRippled(vec3 base, float rippleFreq, float grainFreq, float seed) {
  vec3 rc      = nCoord(1.5, seed);
  float ripple = 0.5 + 0.5 * sin((uv.x + uv.y) * rippleFreq + perlin3D(rc) * 5.5);
  ripple = smoothstep(0.15, 0.85, ripple);
  float grain  = smoothstep(0.2, 0.8, fbm(grainFreq, seed));
  return base * (0.6 + 0.8 * mix(ripple, grain, 0.4));
}

// ORE — stone base with embedded mineral patches.
vec3 textureOre(vec3 oreColor, float spotFreq, float spotCutoff, float seed) {
  vec3 stone = vec3(0.5, 0.5, 0.5);
  float coarse = fbm(1.5, seed);
  float crack  = 1.0 - abs(perlin3D(nCoord(4.5, seed)));
  crack = crack * crack * crack;
  vec3 stoneBase = stone * (0.55 + 0.9 * mix(coarse, crack, 0.4));

  float spot1  = perlin3D(nCoord(spotFreq, seed));
  float spot2  = perlin3D(nCoord(spotFreq, seed + 0.37));
  float oreMask = smoothstep(spotCutoff, spotCutoff + 0.15, (spot1 + spot2) * 0.5);

  float oreSheen = fbm(spotFreq * 2.0, seed + 0.61);
  vec3 oreBase   = oreColor * (0.8 + 0.4 * oreSheen);

  return mix(stoneBase, oreBase, oreMask);
}

// ============================================================
// Dispatch — one line per block type.
// ============================================================

void main() {
  int   type = int(cubeType + 0.5);
  float seed = cubeSeed(cubeOrigin); // cubeOrigin is constant per instance — no mid-face seed split

  vec3 kd;
  if      (type == CUBE_GRASS)       kd = textureGrassLike(color, vec3(0.55, 0.36, 0.18), 5.0, seed);
  else if (type == CUBE_FORESTGRASS) kd = textureGrassLike(color, vec3(0.45, 0.30, 0.15), 6.0, seed);
  else if (type == CUBE_DIRT)        kd = textureSimple(color, color * 0.55, 3.0, seed);
  else if (type == CUBE_SNOW)        kd = textureSimple(color, vec3(0.80, 0.90, 1.0), 4.5, seed);
  else if (type == CUBE_STONE)       kd = textureCracked(color, 1.5, 4.5, seed);
  else if (type == CUBE_BEDROCK)     kd = textureCracked(vec3(0.06, 0.06, 0.07), 2.5, 6.0, seed);
  else if (type == CUBE_SAND)        kd = textureRippled(color, 2.5, 9.0, seed);
  else if (type == CUBE_COALORE)     kd = textureOre(vec3(0.12, 0.12, 0.13), 3.5, 0.20, seed);
  else if (type == CUBE_IRONORE)     kd = textureOre(vec3(0.72, 0.46, 0.30), 3.0, 0.25, seed);
  else if (type == CUBE_GOLDORE)     kd = textureOre(vec3(0.94, 0.82, 0.08), 2.5, 0.30, seed);
  else if (type == CUBE_DIAMONDORE)  kd = textureOre(vec3(0.25, 0.88, 0.92), 2.0, 0.35, seed);
  else                               kd = textureSimple(color, color * 0.6, 3.0, seed);

  // Phong lighting
  vec3 ka = vec3(0.1, 0.1, 0.1);
  vec4 lightDir = uLightPos - wsPos;
  float dot_nl  = clamp(dot(normalize(lightDir), normalize(normal)), 0.0, 1.0);

  gl_FragColor = vec4(clamp(ka + dot_nl * kd, 0.0, 1.0), 1.0);
}
