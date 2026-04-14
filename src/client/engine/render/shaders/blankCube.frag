precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
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

  /* Diffuse term */
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(normal));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  /* Ambient uses surface color tinted by ambient sky color.
     Diffuse uses surface color modulated by sun/moon color. */
  vec3 ambient = uAmbient * kd;
  vec3 diffuse = dot_nl * kd * uSunColor;

  gl_FragColor = vec4(clamp(ambient + diffuse, 0.0, 1.0), 1.0);
}
