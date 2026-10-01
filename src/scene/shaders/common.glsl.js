// GLSL shared by the sky, ocean and clouds.
// All colors are handled in display (sRGB) space, like a painting: the shaders
// output them as-is, so the hex values in the palette are exactly what you see.

export const noise = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03; a *= 0.5; }
  return s;
}
`

// Sky color for any view direction. Uniforms come from src/scene/palette.js.
export const sky = /* glsl */ `
#define DEG 0.017453292

uniform vec3 uSunDir;
uniform float uSunVis;
uniform float uMoonLook;     // 0 = sun, 1 = moon: the disc gets a crisp edge and craters (night scene)
uniform float uMoonFlare;    // strength of the moon's horizontal flare       // 0 = no sun (showSun off) .. 1 = full sun: everything sun-lit scales with it
uniform vec3 uSunColor;
uniform float uSunGlowSize;
uniform float uSunGlowStrength;
uniform float uSunDiscSize;

// vertical gradient (elevation in degrees) - the sky straight ahead of the camera
uniform vec3 uSky0;  // horizon
uniform vec3 uSky1;  // low glow band
uniform vec3 uSky2;  // pink-mauve
uniform vec3 uSky3;  // mauve
uniform vec3 uSky4;  // lavender
uniform vec3 uSky5;  // blue
uniform vec3 uSky6;  // zenith
uniform float uSkyStretch;   // scales all elevations: >1 pushes the gradient higher
uniform float uFovScale;     // camera fov / 20: wider views stretch the gradient to fill the frame

// horizon tint toward / away from the sun
uniform vec3 uHorizonSun;
uniform vec3 uLowSun;
uniform vec3 uHorizonAway;
uniform vec3 uLowAway;

// thin horizontal streak clouds near the horizon
uniform vec3 uStreakLit;
uniform vec3 uStreakShade;
uniform float uStreakAmount;
uniform float uTime;
uniform float uWind;

vec3 grad(float e, vec3 c0, vec3 c1, float e1, vec3 c2, float e2, vec3 c3, float e3,
          vec3 c4, float e4, vec3 c5, float e5, vec3 c6, float e6) {
  vec3 c = mix(c0, c1, smoothstep(0.0, e1, e));
  c = mix(c, c2, smoothstep(e1, e2, e));
  c = mix(c, c3, smoothstep(e2, e3, e));
  c = mix(c, c4, smoothstep(e3, e4, e));
  c = mix(c, c5, smoothstep(e4, e5, e));
  return mix(c, c6, smoothstep(e5, e6, e));
}

// angle (degrees) between the view direction and the sun, measured around the horizon
float sunAzimuthDelta(vec3 dir) {
  vec2 a = normalize(dir.xz + 1e-5), b = normalize(uSunDir.xz + 1e-5);
  return acos(clamp(dot(a, b), -1.0, 1.0)) / DEG;
}

vec3 skyGradient(vec3 dir) {
  float el = max(asin(clamp(dir.y, -1.0, 1.0)) / DEG, 0.0) / (uSkyStretch * uFovScale);
  vec3 c = grad(el, uSky0, uSky1, 1.5, uSky2, 4.0, uSky3, 5.8, uSky4, 7.8, uSky5, 11.5, uSky6, 40.0);

  // warm toward the sun, magenta away from it; strongest near the horizon
  float d = sunAzimuthDelta(dir);
  float low = 1.0 - smoothstep(0.0, 6.0, el);
  vec3 sunSide = mix(uHorizonSun, uLowSun, smoothstep(0.0, 2.2, el));
  vec3 awaySide = mix(uHorizonAway, uLowAway, smoothstep(0.0, 3.0, el));
  c = mix(c, sunSide, (1.0 - smoothstep(2.0, 16.0, d)) * low * uSunVis);
  c = mix(c, awaySide, smoothstep(24.0, 50.0, d) * low);
  return c;
}

vec3 sunGlow(vec3 dir) {
  float a = acos(clamp(dot(dir, uSunDir), -1.0, 1.0)) / DEG;
  vec3 glow = uSunColor * uSunGlowStrength * exp(-a / uSunGlowSize);
  glow += uSunColor * 0.15 * uSunGlowStrength * exp(-a / (uSunGlowSize * 3.0));
  float disc = 1.0 - smoothstep(uSunDiscSize * mix(0.8, 0.94, uMoonLook), uSunDiscSize, a);
  // the moon: maria and craters on the disc, a little darker toward the limb
  vec3 t1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 t2 = cross(t1, uSunDir);
  vec2 m = vec2(dot(dir, t1), dot(dir, t2)) / (uSunDiscSize * DEG);
  float maria = smoothstep(0.45, 0.7, fbm(m * 1.6 + 3.7));
  float craters = smoothstep(0.62, 0.8, fbm(m * 5.0 + 11.0));
  float limb = 1.0 - 0.25 * dot(m, m);
  vec3 face = uSunColor * mix(1.0, (1.0 - 0.2 * maria - 0.07 * craters) * mix(1.0, limb, 0.5), uMoonLook);   // soft painted face
  glow *= 1.0 - disc * 0.85 * uMoonLook;                              // keep the moon's face readable
  // a soft horizontal flare through the moon, as the eye / a camera sees a bright moon at night
  glow += uSunColor * exp(-abs(m.y) / 0.14) * exp(-abs(m.x) / 7.0) * 0.28 * uMoonLook * uSunGlowStrength * uMoonFlare;
  // a soft painted halo ring around the moon (Ghibli-style night)
  glow += uSunColor * exp(-pow((a - uSunDiscSize * 2.6) / (uSunDiscSize * 0.9), 2.0)) * 0.07 * uMoonLook * uSunGlowStrength;
  return (glow + face * disc) * uSunVis;
}

vec3 horizonStreaks(vec3 dir, vec3 base) {
  float el = asin(clamp(dir.y, -1.0, 1.0)) / DEG / uFovScale;
  float az = atan(dir.x, -dir.z) / DEG;
  // band between ~0.5 and ~3.5 degrees above the horizon
  float band = smoothstep(0.3, 0.9, el) * (1.0 - smoothstep(2.4, 3.8, el));
  vec2 p = vec2((az + uTime * uWind * 0.5) * 0.09, el * 2.6);
  float n = fbm(p + vec2(0.0, fbm(p * vec2(0.6, 1.5)) * 1.2));
  float streak = smoothstep(0.52, 0.72, n) * band * uStreakAmount;
  float towardSun = 1.0 - smoothstep(0.0, 45.0, sunAzimuthDelta(dir));
  vec3 col = mix(uStreakShade, uStreakLit, towardSun * 0.8 + 0.2 * n);
  return mix(base, col, streak);
}

vec3 skyColor(vec3 dir) {
  vec3 c = skyGradient(dir);
  c = horizonStreaks(dir, c);
  return c + sunGlow(dir);
}
`
