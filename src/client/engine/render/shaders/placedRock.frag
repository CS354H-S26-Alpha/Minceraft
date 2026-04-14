precision mediump float;

varying float lightMix;
varying float heightMix;
varying vec3 localPos;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

void main() {
  float mineral = hash21(localPos.xz * 1.7 + vec2(localPos.y, localPos.x));
  vec3 darkStone = vec3(0.27, 0.28, 0.31);
  vec3 midStone = vec3(0.43, 0.45, 0.49);
  vec3 lightStone = vec3(0.63, 0.64, 0.68);
  vec3 color = mix(darkStone, midStone, heightMix);
  color = mix(color, lightStone, smoothstep(0.72, 1.0, mineral) * 0.45);
  color *= lightMix;
  gl_FragColor = vec4(color, 1.0);
}
