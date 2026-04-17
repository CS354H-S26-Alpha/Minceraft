#version 300 es
precision mediump float;

uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform vec3 uCameraPos;
uniform float uTime;
uniform vec2 uCloudSeed;
uniform mat4 uProj;
uniform mat4 uViewNoTranslation;

in vec3 vDir;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

float fade1(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float coverage2(vec2 p) {
  vec2 pi = floor(p);
  vec2 pf = fract(p);
  vec2 f = vec2(fade1(pf.x), fade1(pf.y));
  float a = hash21(pi);
  float b = hash21(pi + vec2(1.0, 0.0));
  float c = hash21(pi + vec2(0.0, 1.0));
  float d = hash21(pi + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 2-octave FBM with detuned scaling (2.03 breaks peak alignment — iq's trick
// against the "unrealistic pattern" artifact in stacked octaves).
float fbm2(vec2 p) {
  return coverage2(p) * 0.6 + coverage2(p * 2.03) * 0.4;
}

const vec3 CELL = vec3(12.0, 4.0, 12.0);
const float CLOUD_Y_MIN = 140.0;
const float CLOUD_Y_MAX = 144.0;

// Domain-warped FBM (iquilezles.org/articles/warp). A 2-channel noise offset
// distorts the FBM input, pulling blob edges into swirled, elongated shapes
// instead of the symmetric lobes plain FBM produces.
float cellDensity(vec3 worldPos) {
  vec3 cell = floor(worldPos / CELL);
  vec2 p = cell.xz * 0.05 + uCloudSeed;
  vec2 q = vec2(coverage2(p), coverage2(p + vec2(5.2, 1.3)));
  float n = fbm2(p + 4.0 * q);
  return n > 0.56 ? 1.0 : 0.0;
}

// World-distance along `dir` → depth buffer value. Uses the same rotation the
// cube was rasterized with so the result matches the main depth buffer.
float worldDistToDepth(vec3 dir, float t) {
  vec4 viewPos = uViewNoTranslation * vec4(dir * t, 0.0);
  viewPos.w = 1.0;
  vec4 clipPos = uProj * viewPos;
  return 0.5 * (clipPos.z / clipPos.w) + 0.5;
}

void main() {
  vec3 dir = normalize(vDir);

  float cloudAlpha = 0.0;
  float cloudEnterT = -1.0;

  if (abs(dir.y) > 0.01) {
    float t1 = (CLOUD_Y_MIN - uCameraPos.y) / dir.y;
    float t2 = (CLOUD_Y_MAX - uCameraPos.y) / dir.y;
    float tEnter = max(0.0, min(t1, t2));
    float tExit = min(max(t1, t2), 1800.0);

    if (tExit > tEnter) {
      // 3D-DDA through density space (world minus wind offset). One cell per
      // iteration, so every cell contributes exactly one Beer-Lambert segment.
      vec3 wind = vec3(uTime * 1.2, 0.0, uTime * 0.45);
      vec3 rayStart = uCameraPos - wind + dir * tEnter;
      vec3 cell = floor(rayStart / CELL);
      vec3 stepDir = sign(dir);
      vec3 nextBound = (cell + max(stepDir, vec3(0.0))) * CELL;
      vec3 safeDir = vec3(
          abs(dir.x) < 1e-4 ? 1e-4 : dir.x,
          abs(dir.y) < 1e-4 ? 1e-4 : dir.y,
          abs(dir.z) < 1e-4 ? 1e-4 : dir.z
        );
      vec3 tMax = (nextBound - rayStart) / safeDir;
      if (abs(dir.x) < 1e-4) tMax.x = 1e9;
      if (abs(dir.z) < 1e-4) tMax.z = 1e9;
      vec3 tDelta = CELL / max(abs(dir), vec3(1e-4));

      float tLocal = 0.0;
      float tSpan = tExit - tEnter;
      const int MAX_STEPS = 28;

      for (int i = 0; i < MAX_STEPS; i++) {
        if (tLocal >= tSpan) break;
        float tNext = min(min(tMax.x, tMax.y), tMax.z);
        float tEnd = min(tNext, tSpan);
        float segLen = tEnd - tLocal;
        if (segLen > 0.01) {
          vec3 samplePos = rayStart + dir * (tLocal + segLen * 0.5);
          if (cellDensity(samplePos) > 0.0) {
            if (cloudEnterT < 0.0) cloudEnterT = tEnter + tLocal;
            float segAlpha = 1.0 - exp(-segLen * 0.08);
            float transmission = 1.0 - cloudAlpha;
            cloudAlpha += segAlpha * transmission;
            if (cloudAlpha > 0.97) break;
          }
        }

        if (tMax.x <= tMax.y && tMax.x <= tMax.z) {
          tMax.x += tDelta.x;
        } else if (tMax.y <= tMax.z) {
          tMax.y += tDelta.y;
        } else {
          tMax.z += tDelta.z;
        }
        tLocal = tNext;
      }

      float distFade = 1.0 - smoothstep(900.0, 1700.0, tEnter);
      float slantFade = smoothstep(0.015, 0.12, abs(dir.y));
      cloudAlpha *= distFade * slantFade * 0.95;
    }
  }

  if (cloudAlpha < 0.01) discard;

  float dayFactor = clamp((uSunColor.r - 0.3) / 0.7, 0.0, 1.0);
  // Warmth rises when sun is red-shifted (golden hour). Subtracting 0.15
  // zeroes out noon's slight red-bias so mid-day clouds stay neutral.
  float warmth = clamp((uSunColor.r - uSunColor.b - 0.15) / 0.7, 0.0, 1.0);
  // 1 during day or golden hour, 0 at deep night.
  float daylit = smoothstep(0.3, 0.75, uSunColor.r + warmth * 0.5);

  // Daytime cloud: sun-driven warm white. No sky-color contamination so clouds
  // read as actual white illuminated by the sun, not the blue hemisphere.
  vec3 dayCloud = uSunColor * 0.8 + uAmbient * 0.1;
  dayCloud += warmth * vec3(0.55, 0.18, 0.02); // golden-hour amber

  // Night cloud: track the sky gradient so voxel edges blend into the dark
  // hemisphere instead of popping as bright lavender against near-black sky.
  float horizonT = smoothstep(-0.2, 0.5, dir.y);
  vec3 skyNightBottom = vec3(0.01, 0.02, 0.06);
  vec3 skyNightTop = vec3(0.02, 0.05, 0.12);
  vec3 nightSkyAtDir = mix(skyNightBottom, skyNightTop, horizonT);
  vec3 nightCloud = nightSkyAtDir + vec3(0.11, 0.13, 0.18);

  vec3 litCloud = clamp(mix(nightCloud, dayCloud, daylit), vec3(0.0), vec3(1.4));

  fragColor = vec4(litCloud, cloudAlpha);
  gl_FragDepth = worldDistToDepth(dir, max(cloudEnterT, 0.01));
}
