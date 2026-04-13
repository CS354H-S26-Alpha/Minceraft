precision mediump float;

varying vec2 uv;
varying float objectType;

float rect(vec2 p, vec2 minP, vec2 maxP) {
  vec2 inside = step(minP, p) * step(p, maxP);
  return inside.x * inside.y;
}

float circle(vec2 p, vec2 center, float radius) {
  return step(distance(p, center), radius);
}

void main() {
  float alpha = 0.0;
  vec3 color = vec3(0.0);

  if (objectType < 0.5) {
    float blades = rect(uv, vec2(0.18, 0.0), vec2(0.3, 0.7));
    blades += rect(uv, vec2(0.42, 0.0), vec2(0.56, 0.95));
    blades += rect(uv, vec2(0.68, 0.0), vec2(0.82, 0.75));
    alpha = clamp(blades, 0.0, 1.0);
    color = mix(vec3(0.16, 0.45, 0.12), vec3(0.27, 0.63, 0.19), uv.y);
  } else if (objectType < 1.5) {
    float body = circle(uv, vec2(0.5, 0.43), 0.3);
    body += circle(uv, vec2(0.32, 0.38), 0.2);
    body += circle(uv, vec2(0.68, 0.38), 0.2);
    alpha = clamp(body, 0.0, 1.0);
    color = mix(vec3(0.24, 0.39, 0.12), vec3(0.37, 0.58, 0.18), uv.y);
  } else if (objectType < 2.5) {
    float rock = circle(uv, vec2(0.5, 0.28), 0.28);
    rock += circle(uv, vec2(0.34, 0.26), 0.18);
    rock += circle(uv, vec2(0.68, 0.24), 0.15);
    alpha = clamp(rock, 0.0, 1.0);
    color = mix(vec3(0.37, 0.38, 0.4), vec3(0.58, 0.6, 0.64), uv.y);
  } else if (objectType < 3.5) {
    float trunk = rect(uv, vec2(0.43, 0.0), vec2(0.57, 0.45));
    float canopy = circle(uv, vec2(0.5, 0.72), 0.24);
    canopy += circle(uv, vec2(0.34, 0.62), 0.18);
    canopy += circle(uv, vec2(0.66, 0.62), 0.18);
    alpha = clamp(trunk + canopy, 0.0, 1.0);
    color = canopy > 0.0 ? mix(vec3(0.14, 0.34, 0.08), vec3(0.23, 0.53, 0.12), uv.y) : vec3(0.42, 0.25, 0.08);
  } else {
    float obelisk = rect(uv, vec2(0.42, 0.05), vec2(0.58, 0.88));
    float outerRune = circle(uv, vec2(0.5, 0.72), 0.15);
    float innerRune = circle(uv, vec2(0.5, 0.72), 0.08);
    float base = rect(uv, vec2(0.28, 0.0), vec2(0.72, 0.14));
    alpha = clamp(obelisk + base + max(outerRune - innerRune, 0.0), 0.0, 1.0);
    color = outerRune > innerRune ? vec3(0.91, 0.23, 0.18) : vec3(0.35, 0.12, 0.14);
  }

  if (alpha < 0.5) discard;

  float shade = 0.82 + uv.y * 0.18;
  gl_FragColor = vec4(color * shade, 1.0);
}
