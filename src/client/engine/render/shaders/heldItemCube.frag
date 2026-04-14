precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform sampler2D uBlockAtlas;
uniform float uBlockAtlasTileCount;
uniform float uCubeLighting;
uniform float uCubeTextureFlipU;
uniform float uCubeTextureFlipV;
uniform float uCubeTextureAlpha;
uniform float uCubeTransparentMissingFaces;

varying vec4 normal;
varying vec4 wsPos;
varying vec2 uv;
varying vec3 color;
varying float faceTile;

vec4 resolveAlbedo() {
  if (faceTile < 0.0) {
    return vec4(color, 1.0 - clamp(uCubeTransparentMissingFaces, 0.0, 1.0));
  }

  float sideFace = 1.0 - step(0.5, abs(normal.y));
  float atlasU = mix(uv.x, 1.0 - uv.x, clamp(uCubeTextureFlipU, 0.0, 1.0));
  float atlasV = mix(uv.y, 1.0 - uv.y, sideFace);
  atlasV = mix(atlasV, 1.0 - atlasV, clamp(uCubeTextureFlipV, 0.0, 1.0));
  vec2 atlasUV = vec2((atlasU + faceTile) / uBlockAtlasTileCount, atlasV);
  vec4 sampled = texture2D(uBlockAtlas, atlasUV);
  sampled.a = mix(1.0, sampled.a, clamp(uCubeTextureAlpha, 0.0, 1.0));
  return sampled;
}

void main() {
  vec4 albedo = resolveAlbedo();
  if (albedo.a <= 0.001) {
    discard;
  }

  vec3 kd = albedo.rgb;

  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(normal));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  vec3 ambient = uAmbient * kd;
  vec3 diffuse = dot_nl * kd * uSunColor;
  vec3 litColor = clamp(ambient + diffuse, 0.0, 1.0);

  gl_FragColor = vec4(mix(kd, litColor, clamp(uCubeLighting, 0.0, 1.0)), albedo.a);
}
