precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;

varying vec4 normal;
varying vec4 wsPos;
varying vec3 color;
varying vec4 faceAo;
varying vec2 faceUv;

void main() {
  vec3 kd = color;

  /* Diffuse term */
  vec4 lightDirection = uLightPos - wsPos;
  float dot_nl = dot(normalize(lightDirection), normalize(normal));
  dot_nl = clamp(dot_nl, 0.0, 1.0);

  /* Ambient uses surface color tinted by ambient sky color.
     Diffuse uses surface color modulated by sun/moon color. */
  float a00 = faceAo.x;
  float a01 = faceAo.y;
  float a11 = faceAo.z;
  float a10 = faceAo.w;
  float ao0 = mix(a00, a01, faceUv.y);
  float ao1 = mix(a10, a11, faceUv.y);
  float aoShade = clamp(mix(ao0, ao1, faceUv.x), 0.0, 1.0);
  float aoShadeCurved = pow(aoShade, 1.45);

  vec3 ambient = uAmbient * kd * aoShadeCurved;
  vec3 diffuse = dot_nl * kd * uSunColor * mix(0.8, 1.0, aoShadeCurved);

  gl_FragColor = vec4(clamp(ambient + diffuse, 0.0, 1.0), 1.0);
}
