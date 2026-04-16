precision mediump float;

varying vec2 uv;

void main() {
  vec3 core = vec3(1.0, 0.08, 0.08);
  vec3 stripe = vec3(1.0, 0.95, 0.2);
  vec3 edge = vec3(1.0, 0.55, 0.0);
  vec3 crown = vec3(1.0, 0.35, 0.35);

  float horizontalBand = step(0.35, uv.y) * step(uv.y, 0.7);
  float verticalBand = step(0.42, uv.x) * step(uv.x, 0.58);
  float crosshair = max(horizontalBand, verticalBand);
  float border = step(uv.x, 0.08) + step(0.92, uv.x) + step(uv.y, 0.08) + step(0.92, uv.y);
  float crownMask = step(0.84, uv.y);

  vec3 color = mix(core, stripe, crosshair * 0.95);
  color = mix(color, crown, crownMask * 0.8);
  color = mix(color, edge, clamp(border, 0.0, 1.0));

  gl_FragColor = vec4(min(color * 1.15, 1.0), 1.0);
}
