import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { noise, sky } from './shaders/common.glsl.js'
import { uniforms } from './palette.js'

// Waves: direction offset from the flow direction (deg), wavelength (m), steepness. Summed as sine slopes.
// The flow direction itself is the "waveDirection" setting (180 = right -> left, like the clouds; 0 = left -> right).
// All trains run roughly with the flow; the oblique ones give diagonal crests so the colour moves too.
const WAVES = [
  [-28, 23, 0.050], [22, 13, 0.055], [-35, 7.5, 0.060], [30, 4.2, 0.065],
  [-18, 2.6, 0.070], [38, 1.6, 0.070], [-40, 1.1, 0.060], [12, 0.7, 0.050],
]

const waveGLSL = WAVES.map(([dir, len, steep], i) => {
  const a = THREE.MathUtils.degToRad(dir)
  const k = (2 * Math.PI) / len
  const c = Math.sqrt(9.81 / k) // deep-water phase speed
  return `  addWave(${a.toFixed(4)}, ${k.toFixed(4)}, ${c.toFixed(4)}, ${steep.toFixed(4)}, ${i}.0, p, px, slope, lostVar);`
}).join('\n')

// Height of the moving water surface at a world point (same maths as the vertex shader), so things
// can float on the swell. Ignores the far-distance fade (only used near the camera).
export function oceanHeightAt(x, z) {
  const u = uniforms
  const t = u.uTime.value, dirA = (u.uWaveDirection.value || 0) * Math.PI / 180
  const S = u.uWaveStrength.value, sc = u.uWaveScale.value, sp = u.uWaveSpeed.value, H = u.uWaveHeight?.value ?? 0
  if (!H) return 0
  let h = 0
  WAVES.forEach(([dir, len, steep], i) => {
    const a = dirA + THREE.MathUtils.degToRad(dir)
    let k = (2 * Math.PI) / len
    const c = Math.sqrt(9.81 / k)
    k /= sc
    const phase = k * (Math.cos(a) * x + Math.sin(a) * z) - k * c * t * sp * 0.35 + i * 1.7
    h += (steep * S / k) * Math.sin(phase)
  })
  return h * H
}

// the same waves as heights, for moving the water surface itself (waveHeight)
const heightGLSL = WAVES.map(([dir, len, steep], i) => {
  const a = THREE.MathUtils.degToRad(dir)
  const k = (2 * Math.PI) / len
  const c = Math.sqrt(9.81 / k)
  return `  h += waveH(${a.toFixed(4)}, ${k.toFixed(4)}, ${c.toFixed(4)}, ${steep.toFixed(4)}, ${i}.0, p);`
}).join('\n')

// oceanH(p): height of the swell at world point p (needs "uniform float uTime;" declared first).
// Shared with anything that lies on the water (the wake), so it rides the same waves.
export const oceanHeightGLSL = /* glsl */ `
    uniform float uWaveStrength, uWaveSpeed, uWaveScale, uWaveDirection, uWaveHeight;
    float waveH(float offset, float k, float c, float steep, float seed, vec2 p) {
      float a = uWaveDirection * 0.017453292 + offset;
      vec2 d = vec2(cos(a), sin(a));
      k /= uWaveScale;
      float phase = k * dot(d, p) - k * c * uTime * uWaveSpeed * 0.35 + seed * 1.7;
      return steep * uWaveStrength / k * sin(phase);        // height of a wave whose slope the shading uses
    }
    float oceanH(vec2 p) {
      float h = 0.0;
${heightGLSL}
      // real swell near the camera, fading to a flat sea toward the horizon
      float dist = length(p - cameraPosition.xz);
      return h * uWaveHeight * (1.0 - smoothstep(40.0, 260.0, dist));
    }
`

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */ `
    uniform float uTime;
    ${oceanHeightGLSL}
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      w.y += oceanH(w.xz);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    ${noise}
    ${sky}
    uniform vec3 uOcean0; uniform vec3 uOcean1; uniform vec3 uOcean2; uniform vec3 uOcean3;
    uniform vec3 uOcean4; uniform vec3 uOcean5; uniform vec3 uOcean6;
    uniform float uOceanStretch, uReflection, uWaveStrength, uWaveSpeed, uWaveScale;
    uniform float uGlint, uGlintSharpness, uSparkle, uSparkleSize, uSparkleSpread, uWaveDirection, uWaveShade;
    uniform float uBioGlow, uBioSize, uBioSpeed, uBioDensity;
    uniform vec3 uBioColor;
    // bioluminescence: plankton that light up where the water is disturbed. Blue-green glow drifting
    // with the flow, brightest on the moving wave faces, with tiny flickering sparks in it; seen just
    // under the surface, so it fades with distance and sits under the reflections.
    float bioField(vec2 p, vec2 flow, float t, float moving) {
      vec2 q = p / uBioSize - flow * t * 0.35 * uBioSpeed;
      float patches = smoothstep(1.0 - uBioDensity * 0.55, 1.05 - uBioDensity * 0.4, fbm(q * 0.35 + 7.0));   // where the plankton are
      float swirl = fbm(q * 1.3 + vec2(fbm(q * 0.7 + t * 0.05), fbm(q * 0.7 - 3.0)) * 1.5);
      float glow = patches * smoothstep(0.35, 0.8, swirl) * (0.35 + 0.65 * moving);
      float spark = step(0.93, vnoise(q * 6.0 + t * 1.7)) * patches * (0.5 + 0.5 * sin(t * 9.0 + q.x * 3.0));
      return glow + spark * 1.5;
    }

    varying vec3 vWorld;

    // flow direction on the water plane (x = right, z = toward the camera); 180 deg = right -> left
    vec2 flowDir() { float a = uWaveDirection * DEG; return vec2(cos(a), sin(a)); }

    // one wave: accumulate its slope, fade it out when it is smaller than a pixel
    void addWave(float offset, float k, float c, float steep, float seed, vec2 p, float px,
                 inout vec2 slope, inout float lostVar) {
      float a = uWaveDirection * DEG + offset;
      vec2 d = vec2(cos(a), sin(a));
      k /= uWaveScale;
      float s = steep * uWaveStrength;
      float keep = 1.0 - smoothstep(0.35, 1.2, k * px);          // pixels per wavelength
      float phase = k * dot(d, p) - k * c * uTime * uWaveSpeed * 0.35 + seed * 1.7;
      slope += d * s * cos(phase) * keep;
      lostVar += 0.5 * s * s * (1.0 - keep);
    }

    void main() {
      vec3 V = normalize(vWorld - cameraPosition);
      vec2 p = vWorld.xz;
      float px = length(fwidth(p));                                  // metres per pixel here

      vec2 slope = vec2(0.0);
      float lostVar = 0.0;
${waveGLSL}
      // small drifting ripples on top
      vec2 flow = flowDir();
      vec2 q = p * 0.9 / uWaveScale - flow * uTime * 0.3 * uWaveSpeed;   // ripples travel with the flow
      float e = 0.05;
      float r0 = vnoise(q), rx = vnoise(q + vec2(e, 0.0)), rz = vnoise(q + vec2(0.0, e));
      float rippleKeep = 1.0 - smoothstep(0.2, 0.9, 0.9 / uWaveScale * px);
      slope += vec2(rx - r0, rz - r0) / e * 0.03 * uWaveStrength * rippleKeep;
      lostVar += 0.0004 * uWaveStrength * (1.0 - rippleKeep);

      vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
      // wave faces tilted toward the sun catch light, the others fall into shade (makes the flow readable)
      float face = dot(N.xz, normalize(uSunDir.xz + vec2(1e-4))) / max(uWaveStrength * 0.15, 1e-3);
      vec3 R = reflect(V, N);
      R.y = abs(R.y);                                                // no reflections from below the horizon

      float depView = asin(clamp(-V.y, 0.0, 1.0)) / DEG;             // how far below the horizon we look
      float elR = asin(R.y) / DEG;                                   // where the reflected ray hits the sky

      // body color: the painted gradient by view angle; waves nudge it so the color flows
      float e2 = mix(depView, elR, 0.3) / (uOceanStretch * uFovScale);
      vec3 c = grad(e2, uOcean0, uOcean1, 1.2, uOcean2, 3.0, uOcean3, 4.2, uOcean4, 5.3, uOcean5, 6.4, uOcean6, 8.0);

      // mirror of the actual sky: brings the magenta-left / warm-right tint and the glow
      float fres = 1.0 - smoothstep(0.0, 4.5 * uFovScale, elR);
      // water reflectance (Schlick Fresnel, n = 1.33): ~2% looking down, rising toward the horizon
      float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);
      c = mix(c, skyGradient(R), uReflection * fres);
      c += sunGlow(R) * F * uReflection;                          // the sun / moon's halo, reflected (never brighter than it)

      c *= 1.0 + clamp(face, -1.0, 1.0) * uWaveShade * 0.12 * smoothstep(0.02, 0.6, depView);

      // sun glint: sharp where the waves are resolved, widened by the waves we filtered out
      float sharp = uGlintSharpness / (1.0 + uGlintSharpness * lostVar * 6.0);
      float rs = max(dot(R, uSunDir), 0.0);
      float glint = min(pow(rs, sharp) * uGlint, 0.85);
      // sun sparkle: twinkling points on the wave facets inside the sun's path, drifting with the flow
      float lobe = pow(rs, max(sharp * 0.25 / uSparkleSpread, 3.0));
      vec2 sp = p * vec2(1.0, 3.0) / uSparkleSize - flow * uTime * 0.45 * uWaveSpeed;
      float tw = vnoise(sp) * vnoise(sp * 1.7 + 9.3 + uTime * 1.8);          // second layer = twinkle
      float spark = smoothstep(0.55, 0.7, tw) * lobe * uSparkle;
      // a mirror can't give back more than the light that hits it: cap at the sun / moon's own
      // brightness, then scale by how much water reflects at this angle. So the reflection always
      // follows the sun / moon: dim it or change its colour and the water follows.
      float spec = min(glint + spark, 1.0);
      c += uSunColor * spec * mix(F, 1.0, 0.35) * uSunVis;

      if (uBioGlow > 0.001) {
        float moving = clamp(length(slope) / max(uWaveStrength * 0.25, 0.02), 0.0, 1.0);   // wave faces glow more
        float near = 1.0 - smoothstep(20.0, 160.0, length(vWorld.xz - cameraPosition.xz));
        c += uBioColor * bioField(vWorld.xz, flow, uTime, moving) * near * uBioGlow * (1.0 - fres * 0.5);
      }

      // melt into the sky exactly at the horizon
      vec3 hz = skyColor(normalize(vec3(V.x, 0.0005, V.z)));
      c = mix(hz, c, smoothstep(0.0, 0.12, depView));

      gl_FragColor = vec4(c, 1.0);
    }`,
})

// Ocean surface: a flat polar grid on the water (y = 0), dense near the camera so the swell has
// enough detail, rings spaced wider and wider out to the horizon.
const oceanGeometry = (() => {
  const RINGS = 360, SEGS = 320, R0 = 0.3, R1 = 40000
  const pos = [0, 0, 0], idx = []
  for (let r = 0; r < RINGS; r++) {
    const rad = R0 * Math.pow(R1 / R0, r / (RINGS - 1))
    for (let s = 0; s < SEGS; s++) {
      const a = (s / SEGS) * Math.PI * 2
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad)
    }
  }
  for (let s = 0; s < SEGS; s++) idx.push(0, 1 + ((s + 1) % SEGS), 1 + s)
  for (let r = 0; r < RINGS - 1; r++) {
    for (let s = 0; s < SEGS; s++) {
      const a = 1 + r * SEGS + s, b = 1 + r * SEGS + ((s + 1) % SEGS)
      const c = a + SEGS, d = b + SEGS
      idx.push(a, b, c, b, d, c)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
})()

// Endless ocean that follows the camera; the waves live in world space.
export default function Ocean() {
  const ref = useRef()
  useFrame(({ camera }) => ref.current.position.set(camera.position.x, 0, camera.position.z))
  return (
    <mesh ref={ref} geometry={oceanGeometry} material={material} frustumCulled={false} />
  )
}
