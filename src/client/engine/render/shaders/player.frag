precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;

void main() {
  vec3 skin = vec3(0.49, 0.73, 0.54);
  vec3 dark = vec3(0.15, 0.1, 0.05);

  float face = 0.0;

  if (gl_FrontFacing) {
    // Eyes: two circles at (0.3, 0.72) and (0.7, 0.72), radius 0.08
    float eyeR = 0.08;
    float leftEye = length(uv - vec2(0.3, 0.72));
    float rightEye = length(uv - vec2(0.7, 0.72));
    face += step(leftEye, eyeR) + step(rightEye, eyeR);

    // Pupils: smaller circles inside eyes, radius 0.04
    float pupilR = 0.04;
    face += step(length(uv - vec2(0.3, 0.72)), pupilR) + step(length(uv - vec2(0.7, 0.72)), pupilR);

    // Smile: arc from x=0.3 to x=0.7, centered at y=0.45
    float smileCenterY = 0.52;
    float smileDx = uv.x - 0.5;
    float smileArc = smileCenterY - 0.12 * (1.0 - 4.0 * smileDx * smileDx);
    float smileDist = abs(uv.y - smileArc);
    float inSmileX = step(0.3, uv.x) * step(uv.x, 0.7);
    float belowArc = step(smileArc, uv.y);
    face += step(smileDist, 0.02) * inSmileX * belowArc;
  }

  face = clamp(face, 0.0, 1.0);
  vec3 kd = mix(skin, dark, face);

  vec4 n = gl_FrontFacing ? normal : -normal;
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(n));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  vec3 ambient = uAmbient * kd;
  vec3 diffuse = dot_nl * kd * uSunColor;

  gl_FragColor = vec4(clamp(ambient + diffuse, 0.0, 1.0), 1.0);
}
