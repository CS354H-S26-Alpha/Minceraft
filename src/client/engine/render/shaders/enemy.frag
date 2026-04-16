precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform float uFlash;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;

void main() {
  vec3 kd = vec3(0.72, 0.74, 0.80);

  vec4 n = gl_FrontFacing ? normal : -normal;
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = clamp(dot(normalize(lightDirection), normalize(n)), 0.0, 1.0);

  vec3 ambient = uAmbient * kd;
  vec3 diffuse = dot_nl * kd * uSunColor;
  vec3 color = clamp(ambient + diffuse, 0.0, 1.0);

  // Flash white on hit (same visual as the cube enemy had).
  color = mix(color, vec3(1.0), clamp(uFlash, 0.0, 1.0) * 0.9);

  gl_FragColor = vec4(color, 1.0);
}