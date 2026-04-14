precision mediump float;

uniform vec4 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uSunColor;

varying vec4 normal;
varying vec4 wsPos;
varying vec3 color;

void main() {
  vec3 kd = color;

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
