#version 300 es
precision highp float;

uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uBlockPos;
uniform vec2 uViewport;
uniform float uLineWidth;

in vec3 aPosA;
in vec3 aPosB;
in float aEndParam;
in float aSide;

void main() {
  mat4 mvp = uProj * uView;
  vec4 clipA = mvp * vec4(aPosA + uBlockPos, 1.0);
  vec4 clipB = mvp * vec4(aPosB + uBlockPos, 1.0);

  // Screen-space endpoints for perpendicular-direction computation
  vec2 screenA = (clipA.xy / clipA.w) * uViewport * 0.5;
  vec2 screenB = (clipB.xy / clipB.w) * uViewport * 0.5;
  vec2 dir = screenB - screenA;
  float len = length(dir);
  vec2 dirN = len > 0.0001 ? dir / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dirN.y, dirN.x);

  vec4 clip = mix(clipA, clipB, aEndParam);
  // Expand the quad sideways by uLineWidth pixels, undoing the perspective divide
  vec2 offsetPx = perp * aSide * (uLineWidth * 0.5);
  vec2 offsetNdc = offsetPx / (uViewport * 0.5);
  clip.xy += offsetNdc * clip.w;

  gl_Position = clip;
}
