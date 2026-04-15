precision highp float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;

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

  vec3 col1 = color;
  vec3 col2 = color * 0.5;

  if (type == CUBE_GRASS || type == CUBE_FORESTGRASS) {
    vec3 dirt = (type == CUBE_GRASS) ? vec3(0.55, 0.36, 0.18) : vec3(0.45, 0.30, 0.15);
    if      (normal.y >  0.5) { col1 = color; col2 = color * 0.5; }
    else if (normal.y < -0.5) { col1 = dirt;  col2 = dirt  * 0.5; }
    else {
      float strip = 1.0 - smoothstep(0.0, 0.18, uv.y);
      col1 = mix(dirt, color, strip); col2 = col1 * 0.5;
    }
  }
  else if (type == CUBE_SNOW)       { col2 = vec3(0.80, 0.90, 1.00); }
  else if (type == CUBE_STONE)      { col2 = color * 0.35; }
  else if (type == CUBE_BEDROCK)    { col1 = vec3(0.08, 0.08, 0.09); col2 = vec3(0.02, 0.02, 0.03); }
  else if (type == CUBE_COALORE)    { col1 = vec3(0.50, 0.50, 0.50); col2 = vec3(0.12, 0.12, 0.13); }
  else if (type == CUBE_IRONORE)    { col1 = vec3(0.50, 0.50, 0.50); col2 = vec3(0.72, 0.46, 0.30); }
  else if (type == CUBE_GOLDORE)    { col1 = vec3(0.50, 0.50, 0.50); col2 = vec3(0.94, 0.82, 0.08); }
  else if (type == CUBE_DIAMONDORE) { col1 = vec3(0.50, 0.50, 0.50); col2 = vec3(0.25, 0.88, 0.92); }

  float t  = noise(uv * 4.0 + seed * 3.1, seed);
  vec3  kd = mix(col2, col1 * 1.1, t);

  vec4  lightDir = uLightPos - wsPos;
  float dot_nl   = clamp(dot(normalize(lightDir), normalize(normal)), 0.0, 1.0);
  gl_FragColor   = vec4(clamp(kd * (uAmbient + dot_nl * uSunColor), 0.0, 1.0), 1.0);
}
