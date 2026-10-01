import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls, button } from 'leva'
import * as THREE from 'three'
import { noise, sky } from './shaders/common.glsl.js'
import { uniforms, settings } from './palette.js'
import { CLOUDS, PRESETS, BUILTIN_TYPES } from './cloudLayout.js'
import { fileConfig } from '../activeConfig.js'
import { live as liveScene, markReady } from '../sceneExport.js'
import { SECTION } from '../settingsLayout.js'

const DISTANCE = 8000 // metres; far enough to feel like sky, inside the camera's far plane
const DEG = Math.PI / 180
const PAD = 1.3 // the quad is larger than the cloud so soft edges never get clipped
const BAND = 58 // on screen, clouds drift within ±BAND degrees of straight ahead, then wrap (beyond the view's edges)
const TYPES = { cumulus: 0, stratus: 1, wisp: 2, bits: 3, soft: 4 }

export const dragState = { active: false } // read by the camera rig so dragging a cloud doesn't turn the view

export function dirFromAngles(az, el) {
  return new THREE.Vector3(Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG), -Math.cos(el * DEG) * Math.cos(az * DEG))
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    vUv = uv * 2.0 - 1.0;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = normalize(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`

// Ghibli-style clouds: each cloud is an ordered stack of round puffs (a row of big puffs on a
// flat base, a smaller row behind, towers on top). Every puff is shaded like a soft ball, with a
// crease where it overlaps the one behind; tones fall into clean painted bands.
// Shadow side = the sky behind, darkened toward violet; lit side = coral far from the sun, cream near it.
const fragmentShader = /* glsl */ `
  ${noise}
  ${sky}
  uniform vec3 uCloudShadow, uCloudMid, uCloudLit, uCloudRim, uCloudSkyTint;
  uniform float uCloudSoftness, uCloudBrush, uSunThroughClouds;
  uniform vec3 uCenter;
  uniform float uType, uSeed, uAspect, uLit, uDark, uFade;
  varying vec2 vUv;
  varying vec3 vDir;

  #define MAXP 34
  vec4 P[MAXP];           // xy = centre, z = radius, w = depth (bigger = in front)
  int nP;
  float SX;               // horizontal stretch of each puff (1 = round, stratus are flattened)

  float h1(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }

  void addPuff(vec2 c, float r, float z) { if (nP < MAXP) { P[nP] = vec4(c, r, z); nP++; } }

  void buildPuffs() {
    nP = 0;
    float A = uAspect;
    SX = 1.0;
    if (uType < 0.5 || uType > 2.5) {
      bool bits = uType > 2.5;
      float n0 = clamp(floor(A * 2.2 + 1.0), 2.0, 14.0);
      // row 0: big puffs sitting on the flat base, in front
      for (int i = 0; i < 14; i++) {
        float fi = float(i);
        if (fi >= n0) break;
        if (bits && h1(fi * 1.7) > 0.72) continue;                       // gaps: broken-up cloud
        float x = ((fi + 0.5) / n0 * 2.0 - 1.0) * max(A - 0.55, 0.0) + (h1(fi * 3.1) - 0.5) * 0.3;
        float edge = abs(x) / A;
        float r = mix(0.52, 0.72, h1(fi * 9.3)) * (1.0 - edge * 0.35);
        addPuff(vec2(x, -0.6 + r * 0.92), r, 0.3 + h1(fi * 2.3) * 0.12);
      }
      // row 1: middle puffs, a little behind
      float n1 = max(1.0, floor(n0 * 0.6));
      for (int i = 0; i < 10; i++) {
        float fi = float(i) + 20.0;
        if (float(i) >= n1) break;
        if (bits && h1(fi * 1.7) > 0.6) continue;
        float x = ((float(i) + 0.5) / n1 * 2.0 - 1.0) * max(A - 0.9, 0.0) * 0.85 + (h1(fi * 3.1) - 0.5) * 0.4;
        float edge = abs(x) / A;
        float r = mix(0.46, 0.62, h1(fi * 9.3)) * (1.0 - edge * 0.5);
        addPuff(vec2(x, -0.1 + r * 0.4 + h1(fi * 5.7) * 0.15 * (1.0 - edge)), r, 0.12 + h1(fi * 2.3) * 0.1);
      }
      // row 2: towers on top, furthest back
      float n2 = max(1.0, floor(n0 * 0.35));
      for (int i = 0; i < 8; i++) {
        float fi = float(i) + 40.0;
        if (float(i) >= n2) break;
        float x = ((float(i) + 0.5) / n2 * 2.0 - 1.0) * A * 0.5 + (h1(fi * 3.1) - 0.5) * 0.6;
        float edge = abs(x) / A;
        float r = mix(0.36, 0.5, h1(fi * 9.3)) * (1.0 - edge * 0.6);
        addPuff(vec2(x, 0.3 + h1(fi * 5.7) * 0.22 * (1.0 - edge)), r, -0.02 + h1(fi * 2.3) * 0.08);
      }
    } else {
      // stratus / wisp: one row of flattened puffs
      SX = uType < 1.5 ? 2.4 : 3.6;
      float n = clamp(floor(A / SX * 3.0 + 2.0), 3.0, 24.0);
      for (int i = 0; i < 24; i++) {
        float fi = float(i);
        if (fi >= n) break;
        float x = ((fi + 0.5) / n * 2.0 - 1.0) * max(A - SX * 0.5, 0.0) + (h1(fi * 3.1) - 0.5) * 0.4;
        float edge = abs(x) / A;
        float r = mix(0.45, 0.75, h1(fi * 9.3)) * (1.0 - edge * 0.55) * (uType < 1.5 ? 1.0 : 0.75);
        addPuff(vec2(x, (h1(fi * 5.7) - 0.5) * 0.35), r, h1(fi * 2.3) * 0.15);
      }
    }
  }

  // cover > 0 inside; N = ball normal of the front puff(s); crease = 1 on the rim of a puff that overlaps another
  void evalPuffs(vec2 q, out float cover, out vec3 N, out float crease) {
    cover = -1.0;
    float best = -1e3, bestEdge = 1.0, wsum = 0.0;
    bool behind = false;
    vec3 nsum = vec3(0.0);
    for (int i = 0; i < MAXP; i++) {
      if (i >= nP) break;
      vec4 p = P[i];
      vec2 d = (q - p.xy) / vec2(p.z * SX, p.z);
      float dd = dot(d, d);
      cover = max(cover, (1.0 - sqrt(dd)) * p.z);
      if (dd < 1.0) {
        float zz = sqrt(1.0 - dd);
        float z = zz * p.z + p.w;
        float w = exp(clamp(9.0 * z, -40.0, 40.0));                   // blend neighbouring puffs' shading
        nsum += w * vec3(d, zz * 1.2);
        wsum += w;
        if (z > best) { if (best > -1e2) behind = true; best = z; bestEdge = 1.0 - sqrt(dd); }
        else behind = true;
      }
    }
    N = wsum > 0.0 ? normalize(nsum / wsum) : vec3(0.0, 0.0, 1.0);
    crease = behind ? 1.0 - smoothstep(0.0, 0.22, bestEdge) : 0.0;
  }

  // 'soft': an airbrushed anime night cloud. A few big overlapping round lobes with a flat-ish base,
  // edges melted into the sky, lighter on top where the sky light falls, almost no internal shading.
  vec4 softCloud(vec2 q) {
    float d = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 c = vec2((h1(fi * 3.1) * 2.0 - 1.0) * max(uAspect - 0.6, 0.1) * 0.8, (h1(fi * 5.7) - 0.4) * 0.5);
      float r = mix(0.45, 0.8, h1(fi * 9.3)) * (1.0 - 0.35 * abs(c.x) / max(uAspect, 1.0));
      vec2 dq = (q - c) / vec2(r * 1.25, r);
      d += exp(-dot(dq, dq) * 2.2);
    }
    vec2 w = vec2(fbm(q * 1.6 + uSeed), fbm(q * 1.6 - uSeed + 4.0)) - 0.5;
    d += (fbm(q * 2.4 + w * 1.5 + uSeed * 2.0) - 0.5) * 0.8 + (fbm(q * 6.0 + w * 2.0 - uSeed) - 0.5) * 0.25;   // ragged, lumpy edges
    d *= smoothstep(-0.75, -0.35, q.y + (fbm(q * 3.0 + uSeed) - 0.5) * 0.25);   // softly flattened base
    float a = smoothstep(0.35, 0.35 + 0.6 * uCloudSoftness + 0.25, d);
    a *= (1.0 - smoothstep(0.8, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.8, 1.0, abs(vUv.y)));
    float top = smoothstep(-0.3, 0.8, q.y + w.y * 0.6);                       // light from the sky above
    float rimTop = top * (1.0 - smoothstep(0.35, 0.8, d));                     // brightest along the upper edge
    vec3 skyC = skyGradient(vDir);
    vec3 col = mix(mix(skyC, uCloudLit, 0.45), uCloudRim, (top * 0.45 + rimTop * 0.8) * uLit);
    col = mix(skyC, col, 0.3 + 0.7 * smoothstep(0.35, 1.2, d));                // thin parts show the sky
    return vec4(col, a * 0.7);                                                  // see-through, painted wash
  }

  void main() {
    vec2 q = vec2(vUv.x * uAspect, vUv.y) * ${PAD.toFixed(2)};
    if (uType > 3.5) {
      vec4 sc = softCloud(q);
      if (sc.a < 0.004) discard;
      gl_FragColor = vec4(sc.rgb, sc.a * uFade);
      return;
    }
    buildPuffs();

    // wobbly, hand-painted outlines
    float t = uTime * 0.01;
    vec2 wob = vec2(fbm(q * 2.2 + uSeed + t), fbm(q * 2.2 - uSeed + 5.3 - t)) - 0.5;
    vec2 qs = q + wob * (uType > 1.5 && uType < 2.5 ? 0.3 : 0.22);
    if (uType > 0.5 && uType < 2.5) qs.x += (fbm(vec2(q.y * 3.0, q.x * 0.3) + uSeed) - 0.5) * 0.8;   // streaky layers

    float cover; vec3 N; float crease;
    evalPuffs(qs, cover, N, crease);
    cover += (fbm(q * 6.0 + uSeed * 3.0) - 0.5) * 0.07;
    float soft = uCloudSoftness * (uType > 1.5 && uType < 2.5 ? 3.0 : 1.0);
    float alpha = smoothstep(0.0, soft, cover);
    alpha *= (1.0 - smoothstep(0.85, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.85, 1.0, abs(vUv.y)));
    if (alpha < 0.004) discard;

    // light: the low sun is below-right of the clouds, wrapped a little toward the viewer
    vec3 right = normalize(vec3(-uCenter.z, 0.0, uCenter.x));
    vec3 up = cross(right, uCenter);
    vec3 toSun = uSunDir - uCenter;
    vec2 L2 = normalize(vec2(dot(toSun, right), dot(toSun, up)) + 1e-5);
    L2 = normalize(L2 + vec2(0.0, -0.9));
    L2 = normalize(mix(vec2(0.25, 1.0), L2, uSunVis));                   // no sun: soft daylight from above
    vec3 L = normalize(vec3(L2, 0.45));

    float diff = dot(N, L) * 0.5 + 0.5;                                   // each puff shaded like a ball
    vec2 qn = q / vec2(max(uAspect, 1e-3), 1.0);
    float term = dot(qn + wob * vec2(0.5 / max(uAspect, 1e-3), 0.5), L2) + (N.y * -0.25) + (fbm(q * 1.3 - uSeed) - 0.5) * 0.35;
    float mass = smoothstep(-0.55, 0.75, term);                          // whole cloud: sun side brighter, edge follows the lumps
    float light = mix(mass, diff, 0.25);                                  // big form first, each puff a gentle bump
    bool puffy = uType < 0.5 || uType > 2.5;
    light *= 1.0 - crease * (puffy ? 0.22 : 0.05) * uDark;                                  // shaded seam where puffs overlap
    light += (fbm(q * 3.0 + uSeed * 2.0) - 0.5) * 0.08;                   // brush irregularity
    light = mix(0.72 + 0.28 * light, light, uDark);                       // pale clouds stay mostly lit

    vec3 skyC = skyGradient(vDir);
    float sunA = acos(clamp(dot(vDir, uSunDir), -1.0, 1.0)) / DEG;
    float nearSun = exp(-sunA / 12.0) * uSunVis;

    vec3 shadowC = mix(skyC * vec3(0.62, 0.55, 0.74), uCloudShadow, 0.32);
    shadowC = mix(shadowC, uCloudSkyTint * 0.8, max(N.y, 0.0) * 0.35);   // tops facing up catch the blue sky
    shadowC = mix(skyC, shadowC, uDark);
    vec3 midC = mix(shadowC, uCloudMid, 0.55);
    vec3 litC = mix(uCloudLit, uCloudRim, smoothstep(0.12, 0.75, nearSun));
    float litAmt = uLit * mix(0.9, mix(0.35, 1.0, exp(-sunA / 30.0)), uSunVis);

    // clean painted value bands
    vec3 col = mix(shadowC, midC, smoothstep(0.34, 0.44, light) * uDark);
    col = mix(col, litC, smoothstep(0.5, 0.6, light) * litAmt);
    col = mix(col, mix(litC, uCloudRim, 0.6), smoothstep(0.76, 0.86, light) * litAmt);
    col *= 1.0 + (fbm(q * vec2(1.4, 6.0) + uSeed) - 0.5) * uCloudBrush;
    col = mix(col, skyC, (1.0 - alpha) * 0.2);
    float el = asin(clamp(vDir.y, -1.0, 1.0)) / DEG;
    col = mix(col, skyC, 0.18 * exp(-el / 2.0));                          // low clouds sink into the haze
    // the sun: its glow washes over nearby clouds and the disc shines through thin ones
    col += uSunColor * uSunGlowStrength * exp(-sunA / uSunGlowSize) * uSunThroughClouds * uSunVis;
    alpha *= 1.0 - (1.0 - smoothstep(0.0, uSunDiscSize * 1.8, sunA)) * (1.0 - uDark * 0.6) * min(uSunThroughClouds, 1.0) * uSunVis;

    gl_FragColor = vec4(col, alpha * uFade);
  }`

function makeMaterial(c) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,                          // shared: sun, palette, time
      uCenter: { value: dirFromAngles(c.az, c.el) },
      uType: { value: TYPES[c.type] ?? 0 },
      uSeed: { value: c.seed },
      uAspect: { value: c.w / c.h },
      uLit: { value: c.lit },
      uDark: { value: c.dark },
      uFade: { value: 1 },
    },
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false,
  })
}

export function Cloud({ cloud, onGrab = () => {} }) {
  const ref = useRef()
  const material = useMemo(() => makeMaterial(cloud), [cloud])
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ camera }) => {
    ref.current.visible = settings.showClouds !== false          // Clouds > Look > showClouds
    ref.current.renderOrder = cloud.order ?? cloud.layer
    material.uniforms.uFade.value = cloud.fade ?? 1
    const dist = DISTANCE - cloud.layer * 400
    const S = uniforms.uFovScale.value                 // scene size: layout and sizes scale together
    const dir = dirFromAngles(cloud.az * S, cloud.el * settings.cloudSpread * S)
    ref.current.position.copy(camera.position).addScaledVector(dir, dist)
    ref.current.lookAt(camera.position)
    const near = cloud.near ?? 1                          // display-only perspective size (north/south flow)
    const w = cloud.w * settings.cloudWidth * S * near, h = cloud.h * settings.cloudHeight * S * near
    ref.current.scale.set(2 * PAD * dist * Math.tan((w / 2) * DEG), 2 * PAD * dist * Math.tan((h / 2) * DEG), 1)
    const u = material.uniforms
    u.uCenter.value.copy(dir)
    u.uSeed.value = cloud.seed
    u.uAspect.value = w / h
    u.uType.value = TYPES[cloud.type] ?? 0
    u.uLit.value = cloud.lit
    u.uDark.value = cloud.dark
  })
  return (
    <mesh
      ref={ref}
      material={material}
      renderOrder={cloud.layer}
      onPointerDown={(e) => { e.stopPropagation(); onGrab(cloud, e) }}
      onPointerOver={() => (document.body.style.cursor = 'grab')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <planeGeometry />
    </mesh>
  )
}

// ---- Cloud-layer physics (flow toward / away from the camera, or diagonally)
// Every cloud is a real object on a flat layer LAYER_H metres above the sea, with a real size. It
// moves across that layer in a straight line; its direction, height in the sky and apparent size all
// follow from perspective: far away it sits low and small near the horizon, coming closer it rises,
// grows and spreads outward, then passes overhead and behind. Clouds fade in out of the horizon haze
// and fade out overhead, then respawn far upwind. The saved layout (home az/el, w/h) never changes.
const LAYER_H = 1000        // m, height of the cloud layer
const LAYER_FAR = 18000     // m, where clouds appear / disappear (about 3 deg above the horizon)
const LAYER_SPEED = 120     // m/s per unit of cloudSpeed
const MAX_SPAN = 70         // deg, cap on how wide a cloud can look when it's close

function enterLayer(c, S) {
  c.homeAz = c.az; c.homeEl = c.el
  const el = Math.max(c.el * S * settings.cloudSpread, 0.5) * DEG, az = c.az * S * DEG
  const ground = LAYER_H / Math.tan(el), slant = Math.hypot(ground, LAYER_H)
  c.lx = ground * Math.sin(az); c.lz = -ground * Math.cos(az)
  c.rw = 2 * slant * Math.tan((c.w * S / 2) * DEG)          // real width / height in metres
  c.rh = 2 * slant * Math.tan((c.h * S / 2) * DEG)
}
function leaveLayer(c) {
  c.az = c.homeAz; c.el = c.homeEl
  for (const k of ['lx', 'lz', 'rw', 'rh', 'homeAz', 'homeEl', 'life']) c[k] = undefined
  c.near = 1; c.fade = 1; c.order = undefined
}
function flyOnLayer(c, vx, vz, dt, S) {
  if (c.lx === undefined) enterLayer(c, S)
  c.lx += vx * dt; c.lz += vz * dt
  const ground = Math.hypot(c.lx, c.lz)
  // it has left the view -> respawn it upwind, so the sky keeps a steady stream of clouds.
  // Toward you: it's gone once it has passed overhead. Away from you: once it's lost in the haze.
  const sp = Math.hypot(vx, vz) || 1, dx = vx / sp, dz = vz / sp
  const elNow = Math.atan2(LAYER_H, ground) / DEG
  const along = c.lx * dx + c.lz * dz                                   // > 0: already past the camera
  // gone = passed overhead, or slipped behind the camera (it looks north, -z), or lost in the far haze
  if ((along > 0 && (elNow > 66 || c.lz > LAYER_H * 0.2 || ground > LAYER_FAR)) || ground > LAYER_FAR * 1.02) {
    // upwind in view (flow toward you): far out near the horizon.
    // upwind behind you (flow away): just behind and overhead, it then sails out into view.
    const inFront = dz > 0.2
    // clouds also form mid-sky (they fade in as they form), so the sky stays evenly filled
    const R = inFront ? LAYER_FAR * (0.25 + 0.75 * Math.random()) : LAYER_H * (0.3 + 0.9 * Math.random())
    const side = (Math.random() * 2 - 1) * (inFront ? R * 0.9 : LAYER_H * 1.6)
    c.lx = -dx * R - dz * side
    c.lz = -dz * R + dx * side
    // stay inside the cloud area, or it would be respawned again straight away
    const out = Math.hypot(c.lx, c.lz) / (LAYER_FAR * 0.97)
    if (out > 1) { c.lx /= out; c.lz /= out }
    // a fresh cloud of realistic size: cumulus are a few kilometres across (keeps its own proportions)
    const aspect = c.h / Math.max(c.w, 0.01)
    c.rw = 3000 + Math.random() * 3000
    c.rh = c.rw * aspect
    c.seed += 17
    c.life = 0
  }
  c.life = Math.min((c.life ?? 1) + dt / 3, 1)                            // forming: fade in over ~3 s
  const g = Math.hypot(c.lx, c.lz), slant = Math.hypot(g, LAYER_H)
  c.az = Math.atan2(c.lx, -c.lz) / DEG / S
  c.el = Math.atan2(LAYER_H, g) / DEG / S / settings.cloudSpread
  const span = 2 * Math.atan(c.rw / 2 / slant) / DEG                       // apparent width, degrees
  c.near = Math.min(span, MAX_SPAN) / (c.w * S)
  // fade in out of the horizon haze, fade out overhead (billboards can't be seen from below)
  const elDeg = c.el * S * settings.cloudSpread
  c.fade = THREE.MathUtils.smoothstep(elDeg, 2.6, 4.2) * (1 - THREE.MathUtils.smoothstep(elDeg, 48, 66))
         * THREE.MathUtils.smoothstep(c.life, 0, 1)
  c.order = 10 + Math.round(40 * (1 - Math.min(g / LAYER_FAR, 1)))        // nearer clouds draw in front
}

// small on-screen hint while placing a cloud
function showHint(text) {
  let el = document.getElementById('cloud-hint')
  if (!el) {
    el = document.createElement('div')
    el.id = 'cloud-hint'
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', padding: '8px 14px',
      background: '#000b', color: '#fff', font: '13px system-ui, sans-serif', borderRadius: '8px',
      pointerEvents: 'none', zIndex: 10,
    })
    document.body.appendChild(el)
  }
  el.textContent = text || ''
  el.hidden = !text
}

// Cloud types (the "Add clouds" buttons). Start from PRESETS; your edits are kept in this browser.
// Cloud types start from the active config (defaults + your saved scene); the scene auto-save keeps them.
const loadTypes = () => structuredClone(PRESETS)
const saveTypes = () => {}
const round1 = (v) => Math.round(v * 10) / 10
const typeFromCloud = (c) => ({ type: c.type, w: round1(c.w), h: round1(c.h), dark: c.dark, lit: c.lit, layer: c.layer })

export default function Clouds() {
  // live layout: objects are mutated by the drift and by dragging; the list changes when adding/removing
  const [clouds, setClouds] = useState(() => CLOUDS.map((c) => ({ ...c })))
  const cloudsRef = useRef(clouds)
  cloudsRef.current = clouds
  const [types, setTypes] = useState(loadTypes)
  const typesRef = useRef(types)
  typesRef.current = types
  const [editingType, setEditingType] = useState(() => Object.keys(types)[0] ?? null)
  const { camera, gl } = useThree()
  const grab = useRef(null)
  const placing = useRef(null) // type name while waiting for a click in the sky
  const [selected, setSelected] = useState(null)
  const deletedRef = useRef([])     // stack of deletes (each = the clouds it removed), newest last
  const undoRef = useRef(null)
  const frozen = useMemo(() => new URLSearchParams(location.search).has('shot'), [])

  useEffect(() => saveTypes(types), [types])
  // "copy everything" reads the live clouds and types from here
  liveScene.clouds = () => cloudsRef.current
  liveScene.cloudTypes = () => typesRef.current
  useEffect(() => { markReady() }, [])   // the scene is loaded: auto-save may start

  // pointer -> direction -> az/el (el divided by the spread, so clouds land where you click)
  const pointerAngles = (clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, camera)
    const d = ray.ray.direction
    const S = uniforms.uFovScale.value
    return { az: Math.atan2(d.x, -d.z) / DEG / S, el: Math.asin(d.y) / DEG / settings.cloudSpread / S }
  }

  const addCloud = (base, az, el) => {
    const id = Math.max(0, ...cloudsRef.current.map((c) => c.id)) + 1
    const c = { ...base, id, az, el, seed: 1 + Math.floor(Math.random() * 997) }
    setClouds((cs) => [...cs, c])
    setSelected(c)
  }
  const removeCloud = (c) => {
    deletedRef.current.push([c])                                  // for "undo delete"
    setClouds((cs) => cs.filter((x) => x !== c))
    setSelected(null)
  }
  // undo the last delete (one cloud, or everything "clear all clouds" removed); repeat to go further back
  const undoDelete = () => {
    const back = deletedRef.current.pop()
    if (!back) { showHint('Nothing to undo'); setTimeout(() => showHint(null), 1500); return }
    if (back.replaced) { setSelected(null); setClouds(back.replaced); return }   // undo "restore saved clouds"
    setClouds((cs) => [...cs, ...back.filter((b) => !cs.some((c) => c.id === b.id))])
    if (back.length === 1) setSelected(back[0])
  }
  undoRef.current = undoDelete
  const startPlacing = (name) => {
    placing.current = name
    showHint(`Click in the sky to place a ${name}  ·  Esc to cancel`)
    document.body.style.cursor = 'crosshair'
  }
  const stopPlacing = () => {
    placing.current = null
    showHint(null)
    document.body.style.cursor = ''
  }

  // --- cloud types
  const newTypeName = (base) => {
    let i = 1
    while (typesRef.current[`${base} ${i}`]) i++
    return `${base} ${i}`
  }
  const createType = (from) => {
    const name = newTypeName('custom')
    setTypes((t) => ({ ...t, [name]: from }))
    setEditingType(name)
  }
  const deleteType = (name) => {
    if (BUILTIN_TYPES[name]) {                                    // built-ins stay; only custom types go
      showHint(`"${name}" is a built-in cloud type and can't be deleted`)
      setTimeout(() => showHint(null), 2200)
      return
    }
    setTypes((t) => {
      const { [name]: _, ...rest } = t
      setEditingType(Object.keys(rest)[0] ?? null)
      return rest
    })
  }
  const renameType = (from, to) => {
    to = to.trim()
    if (!to || to === from || typesRef.current[to]) return
    setTypes((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k === from ? to : k, v])))
    setEditingType(to)
  }

  useControls(
    `${SECTION.clouds}.Add clouds`,
    {
      ...Object.fromEntries(Object.keys(types).map((n) => [n, button(() => startPlacing(n))])),
      // clean slate: remove every cloud (asks first); "undo delete" brings them back
      'clear all clouds': button(() => {
        if (!cloudsRef.current.length) return
        if (!window.confirm(`Remove all ${cloudsRef.current.length} clouds from this sky? (You can undo it.)`)) return
        deletedRef.current.push(cloudsRef.current)
        setSelected(null)
        setClouds([])
      }),
      // bring back the last deleted cloud (or the whole cleared sky); also Ctrl+Z / Cmd+Z
      'undo delete': button(() => undoRef.current?.()),
      // put the clouds back as they are in this page's defaults file (only the clouds; other settings
      // stay as they are). Undoable with "undo delete".
      'restore saved clouds': button(() => {
        if (!window.confirm("Put the clouds back to this page's saved defaults? (Other settings stay; you can undo it.)")) return
        deletedRef.current.push({ replaced: cloudsRef.current })
        setSelected(null)
        setClouds(structuredClone(fileConfig.cloudLayout || []))
      }),
    },
    { order: 1 },
    [Object.keys(types).join('|')],
  )

  const onGrab = (cloud, e) => {
    if (placing.current) return
    const a = pointerAngles(e.nativeEvent.clientX, e.nativeEvent.clientY)
    grab.current = { cloud, dAz: cloud.az - a.az, dEl: cloud.el - a.el }
    setSelected(cloud)
    dragState.active = true
    document.body.style.cursor = 'grabbing'
  }

  useEffect(() => {
    const move = (e) => {
      if (!grab.current) return
      const a = pointerAngles(e.clientX, e.clientY)
      grab.current.cloud.az = a.az + grab.current.dAz
      grab.current.cloud.el = Math.max(0.3, a.el + grab.current.dEl)
    }
    const up = () => { grab.current = null; dragState.active = false; if (!placing.current) document.body.style.cursor = '' }
    // placing: capture the click before the camera or other clouds see it
    const place = (e) => {
      if (!placing.current || e.target !== gl.domElement) return
      e.stopPropagation()
      const t = typesRef.current[placing.current]
      const a = pointerAngles(e.clientX, e.clientY)
      if (t) addCloud(t, a.az, Math.max(0.3, a.el))
      stopPlacing()
    }
    const key = (e) => {
      if (e.key === 'Escape') stopPlacing()
      // Ctrl+Z / Cmd+Z: undo the last cloud delete (not while typing in a settings field)
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        undoRef.current?.()
      }
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointerdown', place, true)
    addEventListener('keydown', key)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointerdown', place, true)
      removeEventListener('keydown', key)
    }
  })

  // drift with the wind (uWind > 0 = leftward); lower clouds move a little slower (parallax).
  // A cloud that leaves one side re-enters on the other with a new shape.
  useFrame((_, dt) => {
    if (frozen) return
    const speed = uniforms.uWind.value
    const depth = uniforms.uCloudDepth.value
    const S = uniforms.uFovScale.value
    const band = BAND / S                               // layout units: same on-screen wrap for any scene size
    const layerMode = depth !== 0                       // any flow toward / away from the camera
    for (const c of cloudsRef.current) {
      if (grab.current?.cloud === c) { if (c.lx !== undefined) leaveLayer(c); continue }
      const parallax = 0.75 + c.layer * 0.12
      if (layerMode) {
        flyOnLayer(c, -speed * LAYER_SPEED * parallax, depth * LAYER_SPEED * parallax, dt, S)
        continue
      }
      if (c.lx !== undefined) leaveLayer(c)
      // sideways drift across the view
      c.az -= (speed / S) * dt * parallax * (0.6 + Math.min(c.el, 12) / 20)
      if (c.az + c.w / 2 < -band) { c.az += 2 * band + c.w; c.seed += 17 }
      if (c.az - c.w / 2 > band) { c.az -= 2 * band + c.w; c.seed += 17 }
    }
  })

  return (
    <>
      {clouds.map((c) => <Cloud key={c.id} cloud={c} onGrab={onGrab} />)}
      {editingType && types[editingType] && (
        <TypeEditor
          key={editingType}
          name={editingType}
          names={Object.keys(types)}
          type={types[editingType]}
          onSelect={setEditingType}
          onChanged={() => saveTypes(typesRef.current)}
          onPlace={() => startPlacing(editingType)}
          onNew={() => createType({ ...PRESETS['small cumulus'] })}
          onDelete={() => deleteType(editingType)}
          onRename={(to) => renameType(editingType, to)}
          onReset={() => { const t = structuredClone(PRESETS); setTypes(t); setEditingType(Object.keys(t)[0]) }}
        />
      )}
      {selected && (
        <CloudEditor
          key={selected.id}
          cloud={selected}
          onDuplicate={() => addCloud(selected, selected.az + selected.w * 0.6, selected.el)}
          onDelete={() => removeCloud(selected)}
          onSaveAsType={() => createType(typeFromCloud(selected))}
        />
      )}
    </>
  )
}

const SIZE_STEP = 1.25 // "bigger" / "smaller" buttons
// leva calls onChange once on mount; only react to real edits
const live = (fn) => (v, _path, ctx) => { if (!ctx?.initial) fn(v) }
// each object gets its own panel folder, so switching never carries values over from the previous one
const folderName = (s) => String(s).replace(/\./g, '·')

// Create / edit / delete the cloud types used by the "Add clouds" buttons.
function TypeEditor({ name, names, type, onSelect, onChanged, onPlace, onNew, onDelete, onRename, onReset }) {
  const setRef = useRef()
  const edit = (key) => live((v) => { type[key] = v; onChanged() })
  const resize = (k) => {
    type.w = round1(type.w * k)
    type.h = round1(type.h * k)
    setRef.current?.({ width: type.w, height: type.h })
    onChanged()
  }
  const [, set] = useControls(
    `${SECTION.clouds}.Cloud type: ${folderName(name)}`,
    () => ({
      edit: { value: name, options: names, onChange: live((v) => v !== name && onSelect(v)) },
      name: { value: name, onChange: live((v) => v !== name && onRename(v)) },
      shape: { value: type.type, options: Object.keys(TYPES), onChange: edit('type') },
      width: { value: type.w, min: 0.5, max: 60, step: 0.1, onChange: edit('w') },
      height: { value: type.h, min: 0.3, max: 20, step: 0.05, onChange: edit('h') },
      dark: { value: type.dark, min: 0, max: 1, step: 0.01, onChange: edit('dark') },
      lit: { value: type.lit, min: 0, max: 1, step: 0.01, onChange: edit('lit') },
      layer: { value: type.layer, min: 0, max: 3, step: 1, onChange: edit('layer') },
      bigger: button(() => resize(SIZE_STEP)),
      smaller: button(() => resize(1 / SIZE_STEP)),
      'place in sky': button(() => onPlace()),
      'new type': button(() => onNew()),
      'delete type': button(() => onDelete()),
      'reset all types': button(() => onReset()),
    }),
    { order: 2 },
    [names.join('|')],
  )
  setRef.current = set
  return null
}

// Panel for the cloud you last clicked: size, height in the sky, type, darkness, light, shape.
function CloudEditor({ cloud, onDuplicate, onDelete, onSaveAsType }) {
  const setRef = useRef()
  const resize = (k) => {
    cloud.w = round1(cloud.w * k)
    cloud.h = round1(cloud.h * k)
    setRef.current?.({ width: cloud.w, height: cloud.h })
  }
  const [, set] = useControls(
    `${SECTION.clouds}.Selected cloud #${cloud.id}`,
    () => ({
      type: { value: cloud.type, options: Object.keys(TYPES), onChange: live((v) => (cloud.type = v)) },
      width: { value: cloud.w, min: 0.5, max: 60, step: 0.1, onChange: live((v) => (cloud.w = v)) },
      height: { value: cloud.h, min: 0.3, max: 20, step: 0.05, onChange: live((v) => (cloud.h = v)) },
      bigger: button(() => resize(SIZE_STEP)),
      smaller: button(() => resize(1 / SIZE_STEP)),
      elevation: { value: cloud.el, min: 0.3, max: 40, step: 0.1, onChange: live((v) => (cloud.el = v)) },
      dark: { value: cloud.dark, min: 0, max: 1, step: 0.01, onChange: live((v) => (cloud.dark = v)) },
      lit: { value: cloud.lit, min: 0, max: 1, step: 0.01, onChange: live((v) => (cloud.lit = v)) },
      layer: { value: cloud.layer, min: 0, max: 3, step: 1, onChange: live((v) => (cloud.layer = v)) },
      'new shape': button(() => (cloud.seed += 7)),
      duplicate: button(() => onDuplicate()),
      'save as new type': button(() => onSaveAsType()),
      delete: button(() => onDelete()),
    }),
    { order: 3 },
  )
  setRef.current = set
  return null
}
