precision mediump float;

uniform vec4 uLightPos;
uniform sampler2D uBlockAtlas;
uniform float uBlockAtlasTileCount;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 color;
varying float faceTile;

vec3 resolveAlbedo() {
  if (faceTile < 0.0) {
    return color;
  }

  float sideFace = 1.0 - step(0.5, abs(normal.y));
  float atlasV = mix(uv.y, 1.0 - uv.y, sideFace);
  vec2 atlasUV = vec2((uv.x + faceTile) / uBlockAtlasTileCount, atlasV);
  return texture2D(uBlockAtlas, atlasUV).rgb;
}

void main() {
  vec3 kd = resolveAlbedo();
  vec3 ka = vec3(0.1, 0.1, 0.1);

  /* Compute light fall off */
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(normal));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  float minDiffuse = 0.1;
  dot_nl = minDiffuse + (1.0 - minDiffuse) * dot_nl;
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  gl_FragColor = vec4(clamp(ka + dot_nl * kd, 0.0, 1.0), 1.0);
}
