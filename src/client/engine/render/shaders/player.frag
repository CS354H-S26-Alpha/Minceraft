precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 baseColor;
varying float headFrontFace;

void main() {
  vec3 kd = baseColor;

  if (headFrontFace > 0.5) {
    vec2 pixelUv = floor(vec2(clamp(uv.x, 0.0, 0.999), clamp(1.0 - uv.y, 0.0, 0.999)) * 8.0);
    vec3 hair = vec3(0.34, 0.2, 0.08);
    vec3 eye = vec3(0.1, 0.08, 0.07);
    vec3 highlight = vec3(0.93, 0.96, 1.0);

    if (pixelUv.y <= 1.0 || (pixelUv.y == 2.0 && pixelUv.x <= 1.0) || (pixelUv.y == 2.0 && pixelUv.x >= 6.0)) {
      kd = hair;
    }

    if (pixelUv.y == 3.0 && (pixelUv.x == 2.0 || pixelUv.x == 5.0)) {
      kd = highlight;
    }
    if (pixelUv.y == 3.0 && (pixelUv.x == 3.0 || pixelUv.x == 6.0)) {
      kd = eye;
    }
    if (pixelUv.y == 5.0 && pixelUv.x >= 2.0 && pixelUv.x <= 5.0) {
      kd = mix(kd, eye, 0.75);
    }
  }

  vec4 n = gl_FrontFacing ? normal : -normal;
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(n));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  vec3 ambient = uAmbient * kd;
  vec3 diffuse = dot_nl * kd * uSunColor;

  vec3 lit = clamp(ambient + diffuse, 0.0, 1.0);

  vec3 d = wsPos.xyz - uCameraPos;
  float cylDist = max(length(d.xz), abs(d.y));
  float fog = clamp((cylDist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, uFogColor, fog), 1.0);
}
