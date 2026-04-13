precision mediump float;

uniform vec4 uLightPos;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 color;
varying float cubeType;

// CubeType enum values — must stay in sync with cube-types.ts
const int CUBE_AIR         = 0;
const int CUBE_GRASS       = 1;
const int CUBE_DIRT        = 2;
const int CUBE_STONE       = 3;
const int CUBE_SAND        = 4;
const int CUBE_SNOW        = 5;
const int CUBE_BEDROCK     = 6;
const int CUBE_FORESTGRASS = 7;

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
// Uses linear interpolation (no smoothstep) for harder, less smooth edges.
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

// 4-octave fBm with high persistence (0.6) so fine detail is prominent.
// Returns [0, 1].
float fbm(vec3 p) {
  float n   = 0.0;
  float amp = 0.5;
  float total = 0.0;
  n += amp * perlin3D(p);                              total += amp; amp *= 0.6;
  n += amp * perlin3D(p * 2.1 + vec3(5.2,  1.3, 2.8)); total += amp; amp *= 0.6;
  n += amp * perlin3D(p * 4.3 + vec3(1.7,  9.2, 3.5)); total += amp; amp *= 0.6;
  n += amp * perlin3D(p * 8.7 + vec3(8.3,  2.8, 6.1)); total += amp;
  return clamp(0.5 + 0.5 * (n / total), 0.0, 1.0);
}

// ============================================================
// Texture categories
// To add a new block type: pick a category below and add one
// line to the dispatch table in main(). Only write a new
// category function if the block needs genuinely new behavior.
// ============================================================

// GRASS-LIKE — top face uses surface color; side faces show subsurface
// dirt with a thin green strip at the very top; bottom is pure dirt.
// top  : surface color  |  dirt : subsurface color  |  freq : noise scale
vec3 textureGrassLike(vec3 pos, vec3 top, vec3 dirt, float freq) {
  float n = fbm(pos * freq);
  if (normal.y > 0.5) {
    return top * (0.75 + 0.5 * n);
  } else if (normal.y < -0.5) {
    return dirt * (0.75 + 0.5 * fbm(pos * (freq * 0.6)));
  } else {
    // uv.y == 0 at the top of a side face, 1 at the bottom
    float sideN     = fbm(pos * (freq * 0.6));
    float greenStrip = 1.0 - smoothstep(0.0, 0.25, uv.y);
    return mix(dirt * (0.75 + 0.5 * sideN), top * (0.75 + 0.5 * sideN), greenStrip);
  }
}

// SIMPLE — smooth noise blend between a shadow color and the base color.
// Works for any block with uniform surface variation (dirt, snow, …).
// shadowColor : dark/tinted end of the blend  |  freq : noise scale
vec3 textureSimple(vec3 pos, vec3 base, vec3 shadowColor, float freq) {
  return mix(shadowColor, base, fbm(pos * freq));
}

// CRACKED — coarse base noise crossed with sharp, inward-folded veins.
// Good for stone, bedrock, and other hard rocky materials.
// coarseFreq : large-scale variation  |  crackFreq : vein density
vec3 textureCracked(vec3 pos, vec3 base, float coarseFreq, float crackFreq) {
  float coarse = fbm(pos * coarseFreq);
  float crack  = 1.0 - abs(perlin3D(pos * crackFreq));
  crack = crack * crack * crack;
  return base * (0.55 + 0.9 * mix(coarse, crack, 0.4));
}

// RIPPLED — sine bands distorted by low-freq noise, blended with fine grain.
// Good for sand, gravel, and other granular/stratified materials.
// rippleFreq : band spacing  |  grainFreq : fine surface grain scale
vec3 textureRippled(vec3 pos, vec3 base, float rippleFreq, float grainFreq) {
  float ripple = 0.5 + 0.5 * sin((pos.x + pos.z) * rippleFreq + perlin3D(pos * 1.5) * 4.0);
  float grain  = fbm(pos * grainFreq);
  return base * (0.82 + 0.36 * mix(ripple, grain, 0.35));
}

// ============================================================
// Dispatch — one line per block type.
// New type? Add its constant above and one else-if here.
// ============================================================

void main() {
  vec3 pos  = wsPos.xyz;
  int  type = int(cubeType + 0.5);

  vec3 kd;
  if      (type == CUBE_GRASS)       kd = textureGrassLike(pos, color, vec3(0.55, 0.36, 0.18), 5.0);
  else if (type == CUBE_FORESTGRASS) kd = textureGrassLike(pos, color, vec3(0.45, 0.30, 0.15), 6.0);
  else if (type == CUBE_DIRT)        kd = textureSimple(pos, color, color * 0.55, 3.0);
  else if (type == CUBE_SNOW)        kd = textureSimple(pos, color, vec3(0.80, 0.90, 1.0),  4.5);
  else if (type == CUBE_STONE)       kd = textureCracked(pos, color, 1.5, 4.5);
  else if (type == CUBE_BEDROCK)     kd = textureCracked(pos, vec3(0.06, 0.06, 0.07), 2.5, 6.0);
  else if (type == CUBE_SAND)        kd = textureRippled(pos, color, 2.5, 9.0);
  else                               kd = textureSimple(pos, color, color * 0.6, 3.0);

  // Phong lighting
  vec3 ka = vec3(0.1, 0.1, 0.1);
  vec4 lightDir = uLightPos - wsPos;
  float dot_nl  = clamp(dot(normalize(lightDir), normalize(normal)), 0.0, 1.0);

  gl_FragColor = vec4(clamp(ka + dot_nl * kd, 0.0, 1.0), 1.0);
}
