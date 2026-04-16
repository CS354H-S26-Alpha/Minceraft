#version 300 es
precision mediump float;

uniform vec3 uAmbient;
uniform vec3 uSunColor;

in vec3 vDir;
out vec4 fragColor;

// Hash lattice point to a gradient direction — fract/multiply, no sin().
vec3 grad3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return normalize(fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0);
}

float fade(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float lerp1(float a, float b, float t) {
  return a + t * (b - a);
}

// Classic gradient Perlin noise in 3D.
float perlin3(vec3 p) {
  vec3 pi = floor(p);
  vec3 pf = fract(p);

  vec3 g000 = grad3(pi + vec3(0.0, 0.0, 0.0));
  vec3 g100 = grad3(pi + vec3(1.0, 0.0, 0.0));
  vec3 g010 = grad3(pi + vec3(0.0, 1.0, 0.0));
  vec3 g110 = grad3(pi + vec3(1.0, 1.0, 0.0));
  vec3 g001 = grad3(pi + vec3(0.0, 0.0, 1.0));
  vec3 g101 = grad3(pi + vec3(1.0, 0.0, 1.0));
  vec3 g011 = grad3(pi + vec3(0.0, 1.0, 1.0));
  vec3 g111 = grad3(pi + vec3(1.0, 1.0, 1.0));

  float n000 = dot(g000, pf - vec3(0.0, 0.0, 0.0));
  float n100 = dot(g100, pf - vec3(1.0, 0.0, 0.0));
  float n010 = dot(g010, pf - vec3(0.0, 1.0, 0.0));
  float n110 = dot(g110, pf - vec3(1.0, 1.0, 0.0));
  float n001 = dot(g001, pf - vec3(0.0, 0.0, 1.0));
  float n101 = dot(g101, pf - vec3(1.0, 0.0, 1.0));
  float n011 = dot(g011, pf - vec3(0.0, 1.0, 1.0));
  float n111 = dot(g111, pf - vec3(1.0, 1.0, 1.0));

  vec3 f = vec3(fade(pf.x), fade(pf.y), fade(pf.z));

  float nx00 = lerp1(n000, n100, f.x);
  float nx10 = lerp1(n010, n110, f.x);
  float nx01 = lerp1(n001, n101, f.x);
  float nx11 = lerp1(n011, n111, f.x);
  float nxy0 = lerp1(nx00, nx10, f.y);
  float nxy1 = lerp1(nx01, nx11, f.y);
  return lerp1(nxy0, nxy1, f.z);
}

float fbmPerlin3(vec3 p) {
  float total = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float norm = 0.0;

  for (int i = 0; i < 2; i++) {
    total += perlin3(p * freq) * amp;
    norm += amp;
    freq *= 2.0;
    amp *= 0.5;
  }

  return total / norm;
}

void main() {
  vec3 dir = normalize(vDir);

  float dayFactor = clamp((uSunColor.r - 0.3) / 0.7, 0.0, 1.0);

  float horizon = smoothstep(-0.2, 0.5, dir.y);
  vec3 skyNightBottom = vec3(0.01, 0.02, 0.06);
  vec3 skyNightTop = vec3(0.02, 0.05, 0.12);
  vec3 skyDayBottom = vec3(0.55, 0.72, 0.95);
  vec3 skyDayTop = vec3(0.18, 0.44, 0.9);

  vec3 nightSky = mix(skyNightBottom, skyNightTop, horizon);
  vec3 daySky = mix(skyDayBottom, skyDayTop, horizon);
  vec3 sky = mix(nightSky, daySky, dayFactor);

  // 3D Perlin cloud field sampled in direction space; seam-free across cube faces.
  float n = fbmPerlin3(dir * 4.5 + vec3(11.7, 5.2, 3.9));
  float cloud = smoothstep(0.12, 0.35, n);
  cloud *= smoothstep(-0.05, 0.2, dir.y);

  vec3 cloudNight = vec3(0.18, 0.2, 0.26);
  vec3 cloudDay = vec3(0.95, 0.97, 1.0);
  vec3 cloudColor = mix(cloudNight, cloudDay, dayFactor);

  vec3 lightingTint = clamp(uAmbient + 0.35 * uSunColor, 0.0, 1.4);
  vec3 color = mix(sky, cloudColor * lightingTint, cloud);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
