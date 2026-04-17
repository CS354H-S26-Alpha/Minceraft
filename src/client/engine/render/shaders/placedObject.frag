precision mediump float;

varying vec2 uv;
varying float objectType;
varying float lightMix;
varying float heightMix;
varying vec3 localPos;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

float rect(vec2 p, vec2 minP, vec2 maxP) {
  vec2 inside = step(minP, p) * step(p, maxP);
  return inside.x * inside.y;
}

float circle(vec2 p, vec2 center, float radius) {
  return step(distance(p, center), radius);
}

float ellipse(vec2 p, vec2 center, vec2 radius) {
  vec2 q = (p - center) / radius;
  return step(dot(q, q), 1.0);
}

float canopyBlob(vec2 p, vec2 center, vec2 radius, float seed) {
  float jitter = hash21(center + vec2(seed, seed * 0.5));
  vec2 warpedRadius = radius * mix(0.88, 1.16, jitter);
  return ellipse(p, center + vec2((jitter - 0.5) * 0.05, 0.0), warpedRadius);
}

void main() {
  float alpha = 0.0;
  vec3 color = vec3(0.0);

  if (objectType < 0.5) {
    float bladeA = rect(uv, vec2(0.15, 0.0), vec2(0.27, 0.62));
    bladeA *= step(uv.x, mix(0.24, 0.18, uv.y));
    float bladeB = rect(uv, vec2(0.42, 0.0), vec2(0.56, 0.95));
    float bladeC = rect(uv, vec2(0.68, 0.0), vec2(0.82, 0.76));
    bladeC *= step(mix(0.74, 0.8, uv.y), uv.x);
    float tuft = clamp(bladeA + bladeB + bladeC, 0.0, 1.0);
    alpha = tuft;
    color = mix(vec3(0.12, 0.31, 0.08), vec3(0.34, 0.72, 0.21), heightMix);
  } else if (objectType < 1.5) {
    float bladeA = rect(uv, vec2(0.18, 0.0), vec2(0.3, 0.85));
    bladeA *= step(uv.x, mix(0.28, 0.18, uv.y));
    float bladeB = rect(uv, vec2(0.44, 0.0), vec2(0.56, 1.0));
    float bladeC = rect(uv, vec2(0.68, 0.0), vec2(0.8, 0.91));
    bladeC *= step(mix(0.7, 0.8, uv.y), uv.x);
    float tuft = clamp(bladeA + bladeB + bladeC, 0.0, 1.0);
    alpha = tuft;
    color = mix(vec3(0.05, 0.22, 0.09), vec3(0.22, 0.78, 0.24), heightMix);
  } else if (objectType < 2.5) {
    float stem = rect(uv, vec2(0.47, 0.0), vec2(0.53, 0.72));
    float petals = circle(uv, vec2(0.5, 0.82), 0.13);
    petals += circle(uv, vec2(0.39, 0.76), 0.1);
    petals += circle(uv, vec2(0.61, 0.76), 0.1);
    float center = circle(uv, vec2(0.5, 0.77), 0.05);
    alpha = clamp(stem + petals, 0.0, 1.0);
    color = petals > center ? vec3(0.94, 0.83, 0.16) : vec3(0.45, 0.3, 0.06);
    if (stem > 0.0) color = mix(vec3(0.12, 0.34, 0.08), vec3(0.27, 0.62, 0.14), heightMix);
  } else if (objectType < 3.5) {
    float stem = rect(uv, vec2(0.47, 0.0), vec2(0.53, 0.7));
    float petals = circle(uv, vec2(0.5, 0.8), 0.14);
    petals += circle(uv, vec2(0.4, 0.75), 0.1);
    petals += circle(uv, vec2(0.6, 0.75), 0.1);
    petals += circle(uv, vec2(0.5, 0.68), 0.09);
    float center = circle(uv, vec2(0.5, 0.76), 0.04);
    alpha = clamp(stem + petals, 0.0, 1.0);
    color = petals > center ? vec3(0.78, 0.15, 0.13) : vec3(0.36, 0.22, 0.06);
    if (stem > 0.0) color = mix(vec3(0.12, 0.34, 0.08), vec3(0.27, 0.62, 0.14), heightMix);
  } else if (objectType < 4.5) {
    float base = canopyBlob(uv, vec2(0.5, 0.34), vec2(0.3, 0.2), 0.1);
    float left = canopyBlob(uv, vec2(0.34, 0.44), vec2(0.18, 0.16), 0.4);
    float right = canopyBlob(uv, vec2(0.68, 0.42), vec2(0.19, 0.15), 0.7);
    float crown = canopyBlob(uv, vec2(0.5, 0.58), vec2(0.22, 0.18), 0.9);
    alpha = clamp(base + left + right + crown, 0.0, 1.0);
    float warm = 0.08 * hash21(uv + vec2(0.3, 0.6));
    color = mix(vec3(0.17, 0.27, 0.09), vec3(0.41, 0.6, 0.19) + warm, heightMix);
  } else if (objectType < 5.5) {
    float body = ellipse(uv, vec2(0.5, 0.28), vec2(0.28, 0.22));
    body += ellipse(uv, vec2(0.31, 0.26), vec2(0.13, 0.11));
    body += ellipse(uv, vec2(0.69, 0.24), vec2(0.11, 0.09));
    alpha = clamp(body, 0.0, 1.0);
    float fracture = step(0.52, fract(uv.x * 6.0 + uv.y * 3.0));
    vec3 darkStone = vec3(0.29, 0.31, 0.34);
    vec3 lightStone = vec3(0.56, 0.58, 0.61);
    color = mix(darkStone, lightStone, clamp(heightMix * 0.7 + fracture * 0.15, 0.0, 1.0));
  } else if (objectType < 6.5) {
    float trunk = rect(uv, vec2(0.44, 0.0), vec2(0.56, 0.42));
    float branchShadow = rect(uv, vec2(0.47, 0.18), vec2(0.61, 0.25));
    float canopy = canopyBlob(uv, vec2(0.5, 0.77), vec2(0.26, 0.2), 0.2);
    canopy += canopyBlob(uv, vec2(0.33, 0.64), vec2(0.18, 0.17), 0.5);
    canopy += canopyBlob(uv, vec2(0.67, 0.64), vec2(0.18, 0.17), 0.8);
    canopy += canopyBlob(uv, vec2(0.5, 0.57), vec2(0.21, 0.16), 1.1);
    alpha = clamp(trunk + canopy, 0.0, 1.0);
    vec3 bark = mix(vec3(0.27, 0.16, 0.06), vec3(0.44, 0.28, 0.12), heightMix);
    vec3 leaf = mix(vec3(0.09, 0.23, 0.07), vec3(0.25, 0.57, 0.14), heightMix);
    color = canopy > 0.0 ? leaf : bark;
    color *= branchShadow > 0.0 ? 0.86 : 1.0;
  } else if (objectType < 7.5) {
    float stem = rect(uv, vec2(0.47, 0.0), vec2(0.53, 0.52));
    float branchLeft = rect(uv, vec2(0.26, 0.2), vec2(0.34, 0.62));
    float branchRight = rect(uv, vec2(0.66, 0.18), vec2(0.74, 0.58));
    float branchTop = rect(uv, vec2(0.4, 0.42), vec2(0.6, 0.5));
    float twigLeft = rect(uv, vec2(0.18, 0.46), vec2(0.28, 0.54));
    float twigRight = rect(uv, vec2(0.72, 0.4), vec2(0.82, 0.48));
    alpha = clamp(stem + branchLeft + branchRight + branchTop + twigLeft + twigRight, 0.0, 1.0);
    color = mix(vec3(0.34, 0.22, 0.1), vec3(0.62, 0.5, 0.24), heightMix * 0.72);
  } else {
    float obelisk = rect(uv, vec2(0.42, 0.05), vec2(0.58, 0.88));
    float outerRune = circle(uv, vec2(0.5, 0.72), 0.15);
    float innerRune = circle(uv, vec2(0.5, 0.72), 0.08);
    float base = rect(uv, vec2(0.28, 0.0), vec2(0.72, 0.14));
    alpha = clamp(obelisk + base + max(outerRune - innerRune, 0.0), 0.0, 1.0);
    color = outerRune > innerRune ? vec3(0.91, 0.23, 0.18) : vec3(0.35, 0.12, 0.14);
  }

  if (alpha < 0.5) discard;

  float distanceFade = clamp(1.0 - length(localPos.xz) * 0.18, 0.82, 1.0);
  float shade = lightMix * distanceFade * (0.86 + heightMix * 0.18);
  gl_FragColor = vec4(color * shade, 1.0);
}
