#version 300 es
precision mediump float;

uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform vec4 uLightPos;

in vec3 vDir;
out vec4 fragColor;

vec3 saturateColor(vec3 c, float amt) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(lum), c, amt);
}

vec3 celestialColor(vec3 dir, vec3 cDir, float halfSize, float borderWidth, vec3 fillCol, vec3 borderCol, vec3 sky) {
  float d = dot(dir, cDir);
  vec3 ref = abs(cDir.y) > 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(cDir, ref));
  vec3 up = cross(right, cDir);
  vec2 uv = vec2(dot(dir, right), dot(dir, up)) / max(d, 1e-4);
  vec2 au = abs(uv);
  float maxAu = max(au.x, au.y);
  if (d <= 0.0 || maxAu >= halfSize) return sky;
  return (halfSize - maxAu) < borderWidth ? mix(borderCol, sky, 0.2) : fillCol;
}

void main() {
  vec3 dir = normalize(vDir);

  float dayFactor = clamp((uSunColor.r - 0.3) / 0.7, 0.0, 1.0);
  // Warmth: high during golden hour (sun red-shifted), near zero at noon/night.
  float warmth = clamp((uSunColor.r - uSunColor.b - 0.15) / 0.7, 0.0, 1.0);
  // Overall sun intensity — drives sky brightness so dusk/dawn feel dimmer.
  float sunBrightness = max(max(uSunColor.r, uSunColor.g), uSunColor.b);

  float horizon = smoothstep(-0.2, 0.5, dir.y);
  vec3 skyNightBottom = vec3(0.01, 0.02, 0.06);
  vec3 skyNightTop = vec3(0.02, 0.05, 0.12);
  vec3 skyDayBottom = vec3(0.55, 0.72, 0.95);
  vec3 skyDayTop = vec3(0.18, 0.44, 0.9);

  vec3 nightSky = mix(skyNightBottom, skyNightTop, horizon);
  vec3 daySky = mix(skyDayBottom, skyDayTop, horizon);
  vec3 sky = mix(nightSky, daySky, dayFactor);

  vec3 sunDir = normalize(uLightPos.xyz);
  vec3 moonDir = -sunDir;

  // Horizon glow: warm band concentrated near the horizon on the sun-facing
  // side. Fades to normal sky as you look up or away from the sun. Disabled
  // when there's no warmth (full day or full night).
  vec2 dirAz = length(dir.xz) > 1e-4 ? normalize(dir.xz) : vec2(0.0, 1.0);
  vec2 sunAz = length(sunDir.xz) > 1e-4 ? normalize(sunDir.xz) : vec2(1.0, 0.0);
  float towardSun = max(0.0, dot(dirAz, sunAz));
  float horizonProx = 1.0 - smoothstep(0.0, 0.45, abs(dir.y));
  float glow = warmth * pow(towardSun, 1.6) * horizonProx;
  vec3 glowCol = vec3(1.4, 0.55, 0.18);
  sky = mix(sky, glowCol, clamp(glow * 0.85, 0.0, 1.0));

  // Secondary opposite-horizon wash (anti-solar glow) — subtle pink/purple
  // visible away from the sun at golden hour.
  float awayFromSun = max(0.0, -dot(dirAz, sunAz));
  float antiGlow = warmth * pow(awayFromSun, 2.0) * horizonProx * 0.35;
  vec3 antiGlowCol = vec3(0.85, 0.55, 0.85);
  sky = mix(sky, antiGlowCol, clamp(antiGlow, 0.0, 1.0));

  // Intensity scale: dim the whole hemisphere when the sun is weak. Keeps
  // the bright-blue noon sky at full strength, dims sunset slightly, and
  // pulls deep night further toward black.
  float intensity = mix(0.55, 1.0, smoothstep(0.25, 0.75, sunBrightness));
  sky *= intensity;

  // Sun/moon disc — tint the sun by warmth so the disc matches the horizon
  // glow during sunrise/sunset. Border is a chunky ring just darker than the
  // fill, sitting inside the disc's outer edge.
  vec3 sunFill = mix(uSunColor, vec3(1.4, 0.55, 0.18), warmth * 0.55);
  vec3 sunBorder = saturateColor(sunFill, mix(12.0, 1., horizonProx)) * 1.;
  sky = celestialColor(dir, sunDir, 0.06, 0.013, sunFill, sunBorder, sky);

  vec3 moonFill = vec3(0.92, 0.94, 1.0);
  vec3 moonBorder = saturateColor(moonFill, 1.8) * 0.82;
  sky = celestialColor(dir, moonDir, 0.05, 0.011, moonFill, moonBorder, sky);

  fragColor = vec4(clamp(sky, 0.0, 1.0), 1.0);
}
