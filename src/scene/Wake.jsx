import { forwardRef } from 'react'
import * as THREE from 'three'
import { noise, sky } from './shaders/common.glsl.js'
import { uniforms } from './palette.js'
import { oceanHeightGLSL } from './Ocean.jsx'

// A boat wake, modelled on reference/wake_topdown.jpg (and wake_reference.jpg). How a real one works:
//  - the hull shoves water aside: a BOW WAVE that runs along both sides and flares out into two thin
//    V ARMS (Kelvin wake, always inside ~19.5 deg, narrower on fast boats). They are dashed lines of
//    short diagonal crests that break into foam where steep,
//  - the stern and propeller churn the water into a TURBULENT BAND about the boat's width that stays
//    nearly parallel (turbulence spreads slowly): solid white right behind the stern, then a lacy
//    network of foam threads that thins out as the bubbles rise and burst,
//  - the band's water stays a lighter, bubbly turquoise long after the foam is gone.
// The surface is really displaced (it rides the ocean swell too) and is shaded like the sea,
// so the ridges read as water, not paint. Foam flows back from the stern.
//
// The mesh lies on the water in "travel space": +x = the way the raft is sailing, z = sideways.
// Raft.jsx positions it and feeds the per-frame uniforms (raft size, speed factor).

export const WAKE_EXTENT = { ahead: 3, behind: 260, side: 26 } // metres covered by the wake mesh

const wakeGLSL = /* glsl */ `
  #define DEG_W 0.017453292
  uniform float uWakeForce, uWakeSize, uWakeLength, uWakeDepth, uWakeBreakup, uSpeedK;
  uniform float uWakeFlow, uWakeLace, uWakeChannel;
  uniform float uWakeAngle, uArmHeight, uArmFoam, uArmCount;
  uniform float uSternHeight, uSternLength, uSternWidth, uSternRolls, uSternChurn, uSternFoam;
  uniform float uRaftHalf, uRaftHalfW;

  float wakeLen() { return 70.0 * uWakeLength * (0.45 + 0.55 * min(uSpeedK, 2.0)); }
  // turbulent band: about the hull's width, widening only slowly
  float bandHalfW(float s) { return uRaftHalfW * 0.95 * (1.0 + 0.012 * max(s, 0.0)) * uWakeSize; }
  float strength() { return uWakeForce * uSpeedK; }

  // V arms: sum of ridges. out crest = how much of a breaking crest is here (for foam)
  // the arms start at the BOW (sb = metres behind the bow) and hug the hull before flaring out
  float armField(float s, float n, float t, out float crest) {
    crest = 0.0;
    float sb = s + 2.0 * uRaftHalf;
    if (sb < 0.0) return 0.0;
    float tanA = tan(uWakeAngle * DEG_W);
    float age = exp(-sb / (45.0 * uWakeLength)) * smoothstep(0.0, 1.2, sb);
    float h = 0.0;
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      if (fk >= uArmCount) break;
      float centre = uRaftHalfW * 1.02 + sb * tanA - fk * (0.7 + 0.03 * sb) * uWakeSize;
      if (centre < uRaftHalfW * 0.9) continue;
      float w = (0.26 + 0.012 * sb) * uWakeSize * (1.0 + 0.8 * exp(-sb / 6.0));   // broad whitewater at the bow, thinning out
      float r = exp(-pow((n - centre) / w, 2.0));
      // dashed: short diagonal crests along the arm, flowing back
      float feather = 0.45 + 0.55 * sin(sb * 2.1 - n * 1.4 - t * 2.0 + fk * 2.1) * 0.5 + 0.275;   // broken, not dotted
      float amp = pow(0.6, fk);
      h += r * amp * feather;
      crest = max(crest, r * amp * feather * smoothstep(-0.2, 0.3, (n - centre) / w + 0.3));
    }
    crest *= age;
    return h * age;
  }

  // transom wash: churned hump right behind the stern, then a shallow trough
  float washHump(float s, float z, float t, out float churnK) {
    float n = abs(z);
    float W0 = uRaftHalfW * (0.9 + 0.1 * max(s, 0.0) * uSternWidth);
    float across = exp(-pow(n / W0, 2.0));
    float L = 2.2 * uSternLength;
    float hump = exp(-pow((s - 0.5 * L) / L, 2.0)) * smoothstep(-0.2, 0.3, s);
    float churn = fbm(vec2(s * 1.3 - t * uWakeFlow * 2.2, z * 1.7)) - 0.45;
    float lambda = max(4.2 * uSternLength / max(uSternRolls, 0.5), 0.3);
    float roll = pow(0.5 + 0.5 * cos(6.2832 * (s / lambda - t * uWakeFlow * 0.6)), 3.0);
    float decay = exp(-max(s, 0.0) / (10.0 * uSternLength));
    churnK = across * decay * clamp(0.6 + churn * 1.6 * uSternChurn + roll * 0.4, 0.0, 1.0) * step(-0.2, s);
    float trough = -0.35 * across * smoothstep(1.0, 5.0, s) * exp(-s / 25.0);
    return across * (hump * 0.9 + churn * 0.7 * uSternChurn * decay + roll * 0.25 * decay) * step(-0.2, s) + trough;
  }

  // foam hugging the hull
  float hullWash(float s, float n) {
    float band = (1.0 - smoothstep(uRaftHalfW * 1.02, uRaftHalfW * 1.02 + 0.3 * uWakeSize, n))
               * smoothstep(uRaftHalfW * 0.75, uRaftHalfW * 1.0, n);
    return band * step(s, 0.0) * smoothstep(-2.0 * uRaftHalf - 0.35, -2.0 * uRaftHalf + 0.2, s);
  }
`

const vertexShader = /* glsl */ `
  uniform float uTime;
  ${noise}
  ${oceanHeightGLSL}
  ${wakeGLSL}
  varying vec3 vWorld;
  varying vec2 vLocal;
  varying float vLift;     // height above the calm sea (m)
  varying float vCrest;    // breaking crest on the V arms
  varying float vChurn;    // churned water behind the stern
  void main() {
    vec3 p = position;
    float s = -uRaftHalf - p.x, n = abs(p.z);
    float t = uTime;
    float amp = sqrt(clamp(strength(), 0.0, 4.0));
    float crest, churn;
    float arms = armField(s, n, t, crest) * uArmHeight * 0.32;
    float hump = washHump(s, p.z, t, churn) * uSternHeight * 0.45;
    float lift = (arms + hump) * amp;
    vec4 w = modelMatrix * vec4(p, 1.0);
    w.y += oceanH(w.xz) + lift;                 // ride the swell, plus the wake's own waves
    vWorld = w.xyz;
    vLocal = p.xz;
    vLift = lift;
    vCrest = crest * amp;
    vChurn = churn * amp;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`

const SIDE = WAKE_EXTENT.side.toFixed(1)
const fragmentShader = /* glsl */ `
  ${noise}
  ${sky}
  ${wakeGLSL}
  uniform vec3 uFoam, uWakeWater, uBioColor;
  uniform float uBioGlow;
  uniform vec3 uOcean0, uOcean1, uOcean2, uOcean3, uOcean4, uOcean5, uOcean6;
  uniform float uOceanStretch, uReflection;
  varying vec3 vWorld;
  varying vec2 vLocal;
  varying float vLift;
  varying float vCrest;
  varying float vChurn;

  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  // cellular noise: F2 - F1 (small on cell borders -> lacy foam veins)
  float cellEdge(vec2 x, float t) {
    vec2 i = floor(x), f = fract(x);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++)
    for (int xx = -1; xx <= 1; xx++) {
      vec2 g = vec2(float(xx), float(y));
      vec2 o = 0.5 + 0.45 * sin(t + 6.2832 * hash22(i + g));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return d2 - d1;
  }

  void main() {
    float F = strength();
    if (F < 0.002) discard;
    float s = -uRaftHalf - vLocal.x, z = vLocal.y, n = abs(z);
    float t = uTime * uWakeFlow;

    // ---- pattern space: flowing back from the stern, stretched along the travel direction
    float stretch = mix(1.0, 0.35, smoothstep(0.0, 40.0, s));
    vec2 q = vec2((s - t * 1.6) * stretch, z);
    vec2 warp = vec2(fbm(q * 0.35 + 3.1), fbm(q * 0.35 - 7.7)) - 0.5;
    vec2 warp2 = vec2(fbm(q * 0.9 + 21.0), fbm(q * 0.9 - 13.0)) - 0.5;
    vec2 qc = vec2(q.x * 0.6, q.y) + warp * 3.0 + warp2 * 1.4;
    float e1 = cellEdge(qc * 2.0, t * 0.6);
    float e2 = cellEdge(qc * 4.3 + 17.0, t * 0.9);
    float bubbles = 0.5 + 0.5 * (1.0 - smoothstep(0.02, 0.4, e2));          // foam is made of bubbles

    // ---- 1. transom wash: dense churned white water right behind the stern
    float washFoam = smoothstep(0.25, 0.7, vChurn * uSternFoam + (fbm(q * 1.4 + warp * 2.0) - 0.5) * 0.5) * bubbles;

    // ---- 2. turbulent band: solid churn behind the stern, then a lacy network of foam threads
    float W = bandHalfW(s);
    float decay = exp(-max(s, 0.0) / wakeLen()) * smoothstep(-0.3, 0.4, s);
    float edgeN = n + (fbm(vec2(s * 0.25 - t * 0.4, z * 0.7)) - 0.5) * W * 0.35;   // ragged edges
    float inside = 1.0 - smoothstep(W * 0.85, W * 1.08, edgeN);
    float chan = exp(-pow(n / (W * 0.3), 2.0)) * uWakeChannel;                       // optional darker centre
    float fresh = exp(-max(s, 0.0) / (14.0 * uSternLength)) * smoothstep(-0.3, 0.3, s);
    float bill = mix(fbm(q * 0.55 + warp * 1.2), 1.0 - abs(fbm(q * 1.3 + warp * 2.0 + 9.0) * 2.0 - 1.0), 0.45);
    // near the stern the churn is almost solid white; it breaks up quickly into clumps
    float thresh = 1.0 - (fresh * 1.3 + decay * 0.35) * F * 0.8 + uWakeBreakup * 0.2 * (1.0 - fresh);
    float laneFoam = smoothstep(thresh, thresh + 0.25, bill) * inside * bubbles;
    // the lace: thin threads along cell borders, denser near the stern, thinning with age
    float net = max(1.0 - smoothstep(0.02, 0.17, e1), (1.0 - smoothstep(0.015, 0.12, e2)) * 0.8) * 1.25;
    net *= smoothstep(0.2, 0.55, fbm(q * 0.6 + warp * 1.5 + 5.0) + 0.25 + fresh * 0.5);   // patchy
    float veins = net * inside * decay * uWakeLace * min(F, 1.5) * (0.55 + 0.45 * (1.0 - chan));

    // ---- 3. V arms: foam breaking on the crests, trailing off as long streaks
    vec2 qa = vec2(s * 0.3 - t * 0.9, n * 2.6);
    float armFoam = smoothstep(0.22, 0.55, vCrest * uArmFoam + (fbm(qa + warp) - 0.5) * 0.5) * bubbles;
    float streaks = smoothstep(0.62, 0.8, fbm(vec2(s * 0.07 - t * 0.25, n * 1.8) + warp * 0.6))
                  * smoothstep(0.05, 0.3, vCrest) * 0.5;                                  // foam trailing off the arm crests

    float hull = hullWash(s, n) * F * smoothstep(0.3, 0.6, bill + 0.2);
    float foam = clamp(max(max(max(washFoam, laneFoam), max(veins, armFoam)), max(streaks * F, hull)), 0.0, 1.0);

    // ---- the water itself, shaded like the ocean (so raised ridges read as waves)
    vec3 V = normalize(vWorld - cameraPosition);
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (N.y < 0.0) N = -N;
    vec3 R = reflect(V, N); R.y = abs(R.y);
    float depView = asin(clamp(-V.y, 0.0, 1.0)) / DEG;
    float elR = asin(clamp(R.y, 0.0, 1.0)) / DEG;
    float e = mix(depView, elR, 0.3) / (uOceanStretch * uFovScale);
    vec3 body = grad(e, uOcean0, uOcean1, 1.2, uOcean2, 3.0, uOcean3, 4.2, uOcean4, 5.3, uOcean5, 6.4, uOcean6, 8.0);
    float fres = 1.0 - smoothstep(0.0, 4.5 * uFovScale, elR);
    vec3 water = mix(body, skyGradient(R) + sunGlow(R) * 0.6, uReflection * fres);
    water = mix(water, uWakeWater, smoothstep(0.05, 0.35, vLift) * 0.3);          // light through thin crests
    water = mix(water, mix(uOcean5, uOcean4, 0.5), chan * inside * decay * 0.35);  // darker churned channel
    float aerated = inside * exp(-max(s, 0.0) / (wakeLen() * 1.6)) * smoothstep(-0.3, 0.4, s);  // outlasts the foam
    water = mix(water, uWakeWater, aerated * 0.45 * uWakeDepth);                                   // lighter, bubbly turquoise

    // foam: bright on top, blue-grey in its folds; lit by the sun when it's out, else the sky
    float fold = fbm(q * 2.0 + 11.0);
    vec3 skyLight = skyGradient(vec3(0.0, 1.0, 0.0)) * 0.3 + vec3(0.75);
    vec3 lit = mix(skyLight, vec3(0.85) + uSunColor * 0.25, uSunVis);
    vec3 foamC = mix(mix(uWakeWater, water, 0.4) * 0.9, uFoam, smoothstep(0.3, 0.75, fold + foam * 0.35)) * lit;
    foamC *= 0.85 + 0.15 * max(dot(N, normalize(uSunDir + vec3(0.0, 0.8, 0.0))), 0.0);
    vec3 c = mix(water, foamC, foam);
    float raised = smoothstep(0.01, 0.06, abs(vLift));
    c += uSunColor * pow(max(dot(R, uSunDir), 0.0), 80.0) * 0.6 * uSunVis;        // glints on the moving ridges
    // bioluminescence: churned water lights up the plankton, strongest in the fresh churn behind the stern
    float stir = max(max(foam, vChurn * 0.8), max(armFoam, inside * decay * 0.35));
    float bioSpark = step(0.9, vnoise(vec2(s * 3.0 - t * 4.0, z * 3.0))) * 0.6;
    c += uBioColor * uBioGlow * stir * (0.6 + bioSpark) * (0.7 + 0.3 * sin(uTime * 3.0 + s * 0.8));


    // visible where there's foam, raised water, or the lighter wake water
    float a = max(foam, max(raised * 0.95, aerated * 0.5 * uWakeDepth));
    a *= 1.0 - smoothstep(${SIDE} * 0.75, ${SIDE}, n);                            // soft side edges
    a *= smoothstep(0.02, 0.35, depView);                                         // melt into the horizon haze
    if (a < 0.004) discard;
    gl_FragColor = vec4(c, a);
  }`

const material = new THREE.ShaderMaterial({
  uniforms: { ...uniforms, uSpeedK: { value: 1 }, uRaftHalf: { value: 1.6 }, uRaftHalfW: { value: 1.25 } },
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
})
export const wakeMaterial = material

// Grid in travel space, dense right behind the stern (where the ridges are small and sharp) and near
// the centre line, sparser far back and out to the sides.
const geometry = (() => {
  const { ahead, behind, side } = WAKE_EXTENT
  const ROWS = 380, COLS = 170
  const pos = [], idx = []
  for (let r = 0; r < ROWS; r++) {
    const x = ahead - (ahead + behind) * Math.pow(r / (ROWS - 1), 2.1)
    for (let c = 0; c < COLS; c++) {
      const v = (c / (COLS - 1)) * 2 - 1
      pos.push(x, 0, Math.sign(v) * Math.pow(Math.abs(v), 1.4) * side)
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c, b = a + 1, d = a + COLS, e = d + 1
      idx.push(a, d, b, b, d, e)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
})()

const Wake = forwardRef(function Wake(props, ref) {
  return <mesh ref={ref} geometry={geometry} material={material} renderOrder={1} frustumCulled={false} {...props} />
})
export default Wake
