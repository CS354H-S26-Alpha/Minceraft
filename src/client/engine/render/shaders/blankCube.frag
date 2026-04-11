precision mediump float;

uniform vec4 uLightPos;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;

void main() {
  vec3 kd = vec3(1.0, 1.0, 1.0);
  vec3 ka = vec3(0.1, 0.1, 0.1);

  /* Compute light fall off */
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(normal));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  gl_FragColor = vec4(clamp(ka + dot_nl * kd, 0.0, 1.0), 1.0);
}
