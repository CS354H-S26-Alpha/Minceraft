precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;

void main() {
  vec3 armor = vec3(0.72, 0.18, 0.16);
  vec3 accent = vec3(0.18, 0.04, 0.03);
  vec3 eye = vec3(1.0, 0.9, 0.55);

  float eyes = 0.0;
  if (gl_FrontFacing) {
    float eyeR = 0.06;
    eyes += step(length(uv - vec2(0.34, 0.72)), eyeR);
    eyes += step(length(uv - vec2(0.66, 0.72)), eyeR);
  }

  float stripe = step(0.42, uv.y) * step(uv.y, 0.58);
  vec3 kd = mix(armor, accent, stripe * 0.8);
  kd = mix(kd, eye, clamp(eyes, 0.0, 1.0));

  vec4 n = gl_FrontFacing ? normal : -normal;
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(n));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  vec3 ambient = uAmbient * kd;
  vec3 diffuse = dot_nl * kd * uSunColor;

  gl_FragColor = vec4(clamp(ambient + diffuse, 0.0, 1.0), 1.0);
}
