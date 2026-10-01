import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { noise, sky } from './shaders/common.glsl.js'
import { uniforms, settings, windHeading, headingVector } from './palette.js'
import Wake, { wakeMaterial } from './Wake.jsx'
import { oceanHeightAt } from './Ocean.jsx'

// A log raft built in code: logs with bark and cut ends, a mast on the downwind (leading) side
// with rope lashings, and a canvas sail. Everything is lit by the same
// sunset sun and sky as the rest of the scene. Units are metres.
//
// Local frame: +x = the direction the raft sails (bow), +y = up, +z = toward the camera side.
// Swap this for a GLB later by rendering the model inside <group ref={hull}> instead of <RaftModel/>;
// the motion, bobbing and the mast anchor (MAST_TOP) stay the same.

// Base sizes (metres). The "Raft shape" settings scale each part separately.
const LOG_COUNT = 9
const LOG_LENGTH = 3.2
const RAFT_WIDTH = 2.5
const LOG_RADIUS = 0.13
const MAST_HEIGHT = 3.3
const MAST_RADIUS = 0.07
const SAIL_W = 1.9, SAIL_H = 1.75
const MAST_BASE = 0.12 // the mast stands on the logs
// top of the mast in raft space: attach things here (kept up to date when the shape changes)
export const MAST_TOP = new THREE.Vector3(0.85, MAST_BASE + MAST_HEIGHT, 0)

// current raft shape from the settings (all 1 = the original raft)
const readShape = () => ({
  length: settings.raftLength, width: settings.raftWidth, thick: settings.logThickness,
  mastH: settings.mastHeight, mastT: settings.mastThickness, mastX: settings.mastPosition,
  sailW: settings.sailWidth, sailH: settings.sailHeight,
  ends: settings.logEnds, pointLen: settings.pointLength, bowV: settings.bowShape,
})

const KIND = { bark: 0, endgrain: 1, rope: 2, sail: 3, chopped: 4 }

const vertexShader = /* glsl */ `
  uniform float uTime, uSailBillow, uWindSign;
  uniform vec2 uSailSize;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    vec3 n = normal;
    #if KIND == 3
      // sail: billow downwind (+z of the sail plane) and flutter at the free edge
      float u = uv.x, v = uv.y, PI = 3.14159;
      float B = uSailBillow;
      float ph1 = uTime * 3.1 + u * 7.0 + v * 2.0, ph2 = uTime * 5.3 + v * 9.0;
      float fl = sin(ph1) * 0.025 + sin(ph2) * 0.012;
      p.z += (sin(PI * u) * sin(PI * v) * 0.32 + fl * (0.4 + u)) * B;
      // exact normal of the displaced cloth (smooth shading, no facets)
      float dzdu = (PI * cos(PI * u) * sin(PI * v) * 0.32 + cos(ph1) * 7.0 * 0.025 * (0.4 + u) + fl) * B;
      float dzdv = (PI * sin(PI * u) * cos(PI * v) * 0.32 + (cos(ph1) * 2.0 * 0.025 + cos(ph2) * 9.0 * 0.012) * (0.4 + u)) * B;
      n = normalize(vec3(-dzdu / uSailSize.x, -dzdv / uSailSize.y, 1.0));
    #endif
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`

const fragmentShader = /* glsl */ `
  ${noise}
  ${sky}
  uniform vec3 uBark, uBarkDark, uBarkLight, uEndGrain, uRope, uSail, uCloudShadow;
  uniform float uSeed, uLength, uRadius, uLightWrap;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;

  float h1(float n) { return fract(sin(n * 91.7 + uSeed * 57.3) * 43758.5453); }

  vec3 albedo() {
  #if KIND == 0
    // bark: long fibres along the log, dark cracks, per-log tint
    vec2 bp = vec2(vUv.x * 6.2832 * uRadius, vUv.y * uLength);          // metres around / along
    float fib = fbm(vec2(bp.x * 11.0, bp.y * 0.9) + uSeed * 3.1);
    float crack = smoothstep(0.55, 0.72, fbm(vec2(bp.x * 26.0, bp.y * 1.6) - uSeed));
    vec3 c = mix(uBarkLight, uBark, smoothstep(0.25, 0.75, fib));
    c = mix(c, uBarkDark, crack * 0.9);
    c *= 0.88 + 0.24 * h1(1.0);
    float ends = smoothstep(0.1, 0.0, min(vUv.y, 1.0 - vUv.y));         // weathered, paler ends
    return mix(c, uBarkLight, ends * 0.35);
  #elif KIND == 1
    // cut end: growth rings, a few radial cracks, bark rim
    vec2 q = (vUv - 0.5) * 2.0;
    float d = length(q);
    float rings = 0.5 + 0.5 * sin(d * 38.0 + fbm(q * 5.0 + uSeed) * 5.0);
    vec3 c = mix(uEndGrain, uEndGrain * 0.72, rings * 0.45);
    float ang = atan(q.y, q.x);
    float crack = smoothstep(0.93, 1.0, fbm(vec2(ang * 3.0, d * 2.0) + uSeed)) * smoothstep(0.1, 0.5, d);
    c = mix(c, uBarkDark, crack * 0.7);
    return mix(c, uBarkDark, smoothstep(0.86, 0.95, d));                 // bark ring
  #elif KIND == 4
    // axe-trimmed point: fresh pale wood with fibres running to the tip, axe chatter, bark left at the base
    float fib = fbm(vec2(vUv.x * 40.0, vUv.y * 3.0) + uSeed);
    vec3 c = mix(uEndGrain * 1.05, uEndGrain * 0.78, smoothstep(0.35, 0.75, fib));
    float chatter = smoothstep(0.6, 0.9, sin(vUv.y * 55.0 + fbm(vUv * 8.0 + uSeed) * 6.0) * 0.5 + 0.5) * 0.12;
    c *= 1.0 - chatter;
    float barkLeft = smoothstep(0.22, 0.02, vUv.y + (fbm(vec2(vUv.x * 12.0, uSeed)) - 0.5) * 0.25);
    c = mix(c, mix(uBark, uBarkDark, 0.4), barkLeft);
    return c * (0.92 + 0.12 * fract(sin(floor(vUv.x * 7.0) * 12.9 + uSeed) * 43758.5)); // each axe facet a bit different
  #elif KIND == 2
    // twisted rope
    float twist = 0.5 + 0.5 * sin(vUv.x * 90.0 + vUv.y * 6.2832 * 2.0);
    return mix(uRope * 0.72, uRope, twist);
  #else
    // canvas: weave + soft stains
    float stain = fbm(vUv * 4.0 + uSeed);
    float seams = smoothstep(0.96, 1.0, abs(sin(vUv.x * 3.14159 * 4.0))) * 0.08;   // stitched panels
    return uSail * mix(0.9, 1.03, stain) * (1.0 - seams);
  #endif
  }

  void main() {
    vec3 V = normalize(vWorld - cameraPosition);
    vec3 N = normalize(vNormal);
  #if KIND == 4
    N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));                   // flat axe-cut facets
  #endif
    if (dot(N, V) > 0.0) N = -N;                                        // two-sided (sail, open ends)

    // sunset light, painting-style: the real sun is low and behind the raft, so "wrap" swings the
    // key light to the sun's side, raised and turned toward the viewer, so the wood reads.
    vec3 sunSide = normalize(vec3(sign(uSunDir.x) * 0.75, 0.55, 0.55));
    vec3 L = normalize(mix(uSunDir, sunSide, uLightWrap));
    float ndl = dot(N, L);
    float sunL = smoothstep(-0.15, 0.5, ndl);
    vec3 skyL = skyGradient(normalize(vec3(N.x, abs(N.y) + 0.25, N.z)));
    vec3 amb = mix(skyL, vec3(0.62, 0.45, 0.55), 0.55);                  // warm mauve fill
    vec3 a = albedo();
    float skyDiffuse = N.y * 0.35 + 0.65;                                // no sun: soft light from the whole sky
    vec3 c = a * (amb * 0.95 + uSunColor * sunL * 0.9 * uSunVis + vec3(0.95, 0.97, 1.0) * skyDiffuse * 0.75 * (1.0 - uSunVis));
  #if KIND == 3
    c *= 0.78;                                                           // canvas in the evening light, not paper-white
  #endif

    // rim light only on the silhouette, where the low sun grazes the edges
    float rim = pow(1.0 - abs(dot(N, V)), 5.0) * pow(max(dot(V, uSunDir), 0.0), 2.0);
    c += uSunColor * rim * 0.3 * uSunVis;
  #if KIND == 3
    // sunlight glowing through the canvas
    c += uSail * uSunColor * pow(max(dot(V, uSunDir), 0.0), 3.0) * 0.18 * uSunVis;
  #else
    // wet, darker wood just above the waterline
    c *= mix(1.0, 0.62, 1.0 - smoothstep(0.02, 0.18, vWorld.y));
  #endif
    // a touch of the sky haze so it sits in the scene
    c = mix(c, skyGradient(normalize(vec3(V.x, 0.02, V.z))), 0.08);
    gl_FragColor = vec4(c, 1.0);
  }`

function makeMaterial(kind, extra = {}) {
  return new THREE.ShaderMaterial({
    defines: { KIND: KIND[kind] },
    uniforms: {
      ...uniforms,
      uWindSign: { value: 1 },
      uSeed: { value: extra.seed ?? 1 },
      uLength: { value: extra.length ?? 1 },
      uRadius: { value: extra.radius ?? 0.1 },
      uSailSize: { value: new THREE.Vector2(...(extra.sailSize ?? [1, 1])) },
    },
    vertexShader, fragmentShader,
    side: THREE.DoubleSide,
  })
}

const rand = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

// A log along an axis: bark on the side, cut ends on the caps.
// x-axis logs can have axe-trimmed points: pointFront (+x end) / pointBack (-x end) = point length (m).
function Log({ position, length, radius, seed, axis = 'x', pointFront = 0, pointBack = 0 }) {
  const mats = useMemo(() => {
    const bark = makeMaterial('bark', { seed, length, radius })
    const end = makeMaterial('endgrain', { seed })
    const chop = makeMaterial('chopped', { seed })
    return { body: [bark, end, end], point: [chop, end, end] }
  }, [seed, length, radius])
  const rotation = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]
  const pf = axis === 'x' ? Math.min(pointFront, length * 0.45) : 0
  const pb = axis === 'x' ? Math.min(pointBack, length * 0.45) : 0
  if (!pf && !pb) {
    return (
      <mesh position={position} rotation={rotation} material={mats.body}>
        <cylinderGeometry args={[radius * (0.94 + rand(seed) * 0.08), radius, length, 20, 1]} />
      </mesh>
    )
  }
  const body = length - pf - pb
  const tipR = radius * (0.1 + rand(seed + 5) * 0.08)       // slightly blunt, like a real chopped stake
  const facets = 6 + Math.floor(rand(seed + 9) * 3)          // 6-8 axe cuts
  const [x, y, z] = position
  return (
    <group position={[x + (pb - pf) / 2, y, z]}>
      <mesh rotation={rotation} material={mats.body}>
        <cylinderGeometry args={[radius, radius, body, 20, 1]} />
      </mesh>
      {pf > 0 && (
        <mesh position={[body / 2 + pf / 2, 0, 0]} rotation={[rand(seed + 2) * 6.28, 0, -Math.PI / 2]} material={mats.point}>
          <cylinderGeometry args={[tipR, radius, pf, facets, 1]} />
        </mesh>
      )}
      {pb > 0 && (
        <mesh position={[-body / 2 - pb / 2, 0, 0]} rotation={[rand(seed + 4) * 6.28, 0, Math.PI / 2]} material={mats.point}>
          <cylinderGeometry args={[tipR, radius, pb, facets, 1]} />
        </mesh>
      )}
    </group>
  )
}

// Rope lashing: a few turns of rope around a pole.
function Lashing({ position, radius, axis = 'z', turns = 3 }) {
  const mat = useMemo(() => makeMaterial('rope'), [])
  const rotation = axis === 'z' ? [0, 0, 0] : axis === 'x' ? [0, Math.PI / 2, 0] : [Math.PI / 2, 0, 0]
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: turns }, (_, i) => (
        <mesh key={i} position={[0, 0, (i - (turns - 1) / 2) * 0.045]} material={mat}>
          <torusGeometry args={[radius + 0.012, 0.018, 8, 24]} />
        </mesh>
      ))}
    </group>
  )
}

// log layout for a shape: logs stay packed side by side (wider raft = more logs, thicker = fewer)
function logLayout(shape) {
  const logLen = LOG_LENGTH * shape.length
  const pitch = (RAFT_WIDTH / LOG_COUNT) * shape.thick          // centre-to-centre spacing
  const count = Math.max(2, Math.round((RAFT_WIDTH * shape.width) / pitch))
  return { logLen, pitch, count, halfLen: logLen / 2, halfWidth: (count * pitch) / 2 }
}

function RaftModel({ sailRef, shape }) {
  const sailMat = useMemo(() => makeMaterial('sail', { seed: 5 }), [])

  const { logLen, pitch, count } = logLayout(shape)
  const logR = LOG_RADIUS * shape.thick
  const logs = useMemo(() => Array.from({ length: count }, (_, i) => {
    const z = (i - (count - 1) / 2) * pitch
    const side = count > 1 ? Math.abs(z) / (((count - 1) / 2) * pitch) : 0   // 0 middle .. 1 outer log
    // V bow: the middle logs reach further forward than the outer ones
    const front = logLen / 2 + (rand(i + 3) - 0.5) * 0.12 * shape.length - shape.bowV * side * logLen * 0.25
    const back = -logLen / 2 + (rand(i + 7) - 0.5) * 0.14 * shape.length
    const point = shape.pointLen * (0.8 + rand(i + 11) * 0.4)
    return {
      r: logR * (1 + rand(i + 1) * 0.27), z, len: front - back, dx: (front + back) / 2, seed: i + 1,
      pf: shape.ends !== 'flat' ? point : 0,
      pb: shape.ends === 'pointed both ends' ? point * (0.8 + rand(i + 13) * 0.3) : 0,
    }
  }), [count, logR, pitch, logLen, shape.length, shape.bowV, shape.pointLen, shape.ends])
  const deck = 0.02 * shape.thick   // log centres sit just above the water: half-submerged
  const base = MAST_BASE * shape.thick

  // mast and sail
  const mastH = MAST_HEIGHT * shape.mastH
  const mastR = MAST_RADIUS * shape.mastT
  const mastX = shape.mastX * (logLen / 2)
  const sailW = SAIL_W * shape.sailW, sailH = SAIL_H * shape.sailH
  const top = base + mastH
  const yardY = top - 0.15                                         // yard just below the mast top
  const boomY = Math.max(base + 0.2, yardY - sailH - 0.1)          // boom below the sail
  const sailHFit = yardY - boomY - 0.1                             // the sail always fits between them
  const poleR = 0.045 * Math.max(shape.mastT, 0.6)
  sailMat.uniforms.uSailSize.value.set(sailW, sailHFit)
  MAST_TOP.set(mastX, top, 0)

  return (
    <>
      {logs.map((l) => (
        <Log key={l.seed} position={[l.dx, deck, l.z]} length={l.len} radius={l.r} seed={l.seed} axis="x" pointFront={l.pf} pointBack={l.pb} />
      ))}
      {/* mast on the leading (downwind) side */}
      <group position={[mastX, 0, 0]}>
        <Log position={[0, base + mastH / 2, 0]} length={mastH} radius={mastR} seed={41} axis="y" />
        <Lashing position={[0, base + 0.1, 0]} radius={mastR} axis="y" turns={3} />
        {/* yard (top), boom (bottom) and sail turn together with the sail trim */}
        <group ref={sailRef}>
          <Log position={[0, yardY, 0]} length={sailW + 0.4} radius={poleR} seed={42} axis="x" />
          <Log position={[0, boomY, 0]} length={sailW + 0.3} radius={poleR} seed={43} axis="x" />
          <Lashing position={[0, yardY, 0]} radius={mastR + 0.005} axis="y" turns={2} />
          <Lashing position={[0, boomY, 0]} radius={mastR + 0.005} axis="y" turns={2} />
          <mesh position={[0, boomY + sailHFit / 2 + 0.05, mastR + 0.02]} material={sailMat}>
            <planeGeometry args={[sailW, sailHFit, 28, 20]} />
          </mesh>
        </group>
      </group>
    </>
  )
}

// Compass heading (degrees) the raft's bow points: along the wind, turned by raftYaw. raftYaw is
// mirrored when the wind blows westward, so a saved three-quarter view looks the same either way.
export function raftHeadingDeg(wind) {
  const westward = Math.sin((wind * Math.PI) / 180) < -1e-9
  return wind - settings.raftYaw * (westward ? -1 : 1)
}

// anchor (optional): pin the raft at { x, z } (metres) with heading yaw (radians) instead of the
// screen-position settings; anchor.wake = wake strength (0 = none). Used by the landing page.
export default function Raft({ anchor } = {}) {
  const root = useRef()   // position on the water + heading
  const hull = useRef()   // bobbing
  const sail = useRef()   // sail trim
  const wake = useRef()   // foam trail on the water (follows the course, not the raft's yaw)
  const u = useRef(settings.leftRight)   // position across the screen: -1 left edge .. 1 right edge
  const lastLR = useRef(settings.leftRight)
  const zOff = useRef(0)                 // metres sailed toward the camera (negative = away)
  const { camera } = useThree()
  // rebuild the raft when a "Raft shape" setting changes (checked every frame, cheap)
  const [shape, setShape] = useState(readShape)
  const shapeKey = useRef(JSON.stringify(shape))
  const frozen = useMemo(() => new URLSearchParams(location.search).has('shot'), [])

  useFrame((_, dt) => {
    const next = readShape(), key = JSON.stringify(next)
    if (key !== shapeKey.current) { shapeKey.current = key; setShape(next) }
    root.current.visible = settings.showRaft
    // the raft sails with the wind: its bow points along the wind (plus raftYaw), and when sailing it
    // moves that way across the water, sideways and / or toward / away from the camera
    const wind = windHeading()
    const heading = raftHeadingDeg(wind)
    const vel = headingVector(wind)                                  // x = east (right), z = south (toward you)
    if (settings.motion !== 'sailing') zOff.current = 0              // anchored: back at its set distance

    // --- place the raft by screen position
    // up/down: pick a height on screen between the bottom edge and the horizon, then find how far
    // away on the water that is (farther = higher on screen = smaller)
    // measured in the designed 16:9 framing (see CameraRig), so the raft sits at the same spot on the
    // water on every screen: phones just see more sky and sea around it
    const design = camera.userData.design ?? { fov: camera.fov, aspect: camera.aspect, pitch: camera.rotation.x }
    const tanV = Math.tan((design.fov * Math.PI) / 360)
    const pitch = design.pitch
    const horizonY = Math.tan(-pitch) / tanV                          // horizon on screen (-1..1)
    const k = (settings.upDown + 1) / 2
    const screenY = -1 + k * (horizonY - 0.02 + 1)
    const below = -(Math.atan(screenY * tanV) + pitch)                // ray angle under the horizon
    const d0 = camera.position.y / Math.tan(Math.max(below, 0.0015))   // distance set by upDown
    const step = Math.min(dt, 0.1) * settings.raftSpeed
    const sailingNow = !frozen && settings.motion === 'sailing'

    // toward / away from the camera: drift in distance, wrapping between near and far
    if (sailingNow) zOff.current += vel.z * step
    const near = Math.max(4, d0 * 0.35), far = d0 * 2.5
    if (d0 - zOff.current < near) zOff.current = d0 - far             // came too close: start again far out
    if (d0 - zOff.current > far) zOff.current = d0 - near             // sailed out of sight: start again close
    const d = d0 - zOff.current
    const halfX = d * tanV * design.aspect                            // metres from centre to screen edge there

    // left/right: moving the slider jumps the raft there; sailing carries it on with the wind
    if (settings.leftRight !== lastLR.current) { u.current = settings.leftRight; lastLR.current = settings.leftRight }
    if (sailingNow) u.current += (vel.x * step) / halfX
    const margin = (2.2 * settings.raftScale * Math.max(settings.raftLength, settings.sailWidth)) / halfX
    if (u.current > 1 + margin) u.current = -1 - margin              // sailed off one side: come back on the other
    if (u.current < -1 - margin) u.current = 1 + margin

    root.current.position.set(camera.position.x + u.current * halfX, 0, camera.position.z - d)
    // bow points the way it sails (forward = +x of the raft); raftYaw turns it a little to show it three-quarter on
    root.current.rotation.y = THREE.MathUtils.degToRad(90 - heading)
    root.current.scale.setScalar(settings.raftScale)

    // bob, pitch and roll on the swell
    const t = uniforms.uTime.value * settings.bobSpeed
    const b = settings.bobbing
    // bow / stern lift: raise or push under each end separately; the raft tilts between them
    const len = logLayout(shape).logLen
    const bowUp = settings.bowLift, sternUp = settings.sternLift
    hull.current.position.y = (Math.sin(t * 1.3) * 0.035 + Math.sin(t * 2.1 + 1.3) * 0.015) * b - settings.sink + (bowUp + sternUp) / 2
    hull.current.rotation.z = Math.atan2(bowUp - sternUp, len) + (Math.sin(t * 1.1 + 0.4) * 0.025 + Math.sin(t * 1.9) * 0.01) * b + (root.current.userData.swellPitch || 0)
    hull.current.rotation.x = (Math.sin(t * 0.9 + 2.0) * 0.02 + Math.sin(t * 1.7 + 0.7) * 0.008) * b + (root.current.userData.swellRoll || 0)

    // wake: attached to the raft (a child of its group), so it always trails from the stern and turns
    // with it; stronger when it sails faster
    const lay = logLayout(shape)
    const wu = wakeMaterial.uniforms
    wu.uRaftHalf.value = lay.halfLen * settings.raftScale
    wu.uRaftHalfW.value = lay.halfWidth * settings.raftScale
    const sailing = settings.motion === 'sailing' ? settings.raftSpeed / 0.5 : 0   // 0.5 m/s = the reference look
    wu.uSpeedK.value = (settings.followSpeed ? Math.min(sailing, 4) : 1) * (1 - THREE.MathUtils.smoothstep(settings.sink, 0.15, 0.6))
    wake.current.visible = settings.showRaft

    // float on the swell: ride up and down with the water and tilt along its slope
    {
      const p = root.current.position, yaw = root.current.rotation.y
      const fx = Math.cos(yaw), fz = -Math.sin(yaw)                 // raft forward (+x) in world
      const L = logLayout(shape).halfLen * settings.raftScale, W = logLayout(shape).halfWidth * settings.raftScale
      const h0 = oceanHeightAt(p.x, p.z)
      const hf = oceanHeightAt(p.x + fx * L, p.z + fz * L), hb = oceanHeightAt(p.x - fx * L, p.z - fz * L)
      const hl = oceanHeightAt(p.x - fz * W, p.z + fx * W), hr = oceanHeightAt(p.x + fz * W, p.z - fx * W)
      p.y = (h0 * 2 + hf + hb + hl + hr) / 6
      // a heavy raft doesn't follow every slope: soften and limit the tilt
      const lim = THREE.MathUtils.clamp
      root.current.userData.swellPitch = lim(Math.atan2(hf - hb, 2 * L) * 0.6, -0.18, 0.18)
      root.current.userData.swellRoll = lim(Math.atan2(hl - hr, 2 * W) * 0.6, -0.14, 0.14)
    }

    if (anchor) {
      root.current.position.set(anchor.x, 0, anchor.z)
      root.current.rotation.y = anchor.yaw
      wu.uSpeedK.value = anchor.wake ?? 0
    }

    // keep the wake flat on the sea in metres: undo the raft group's float height and scale
    // (the wake shader rides the swell itself); it follows the raft's position and heading
    const invScale = 1 / settings.raftScale
    wake.current.scale.setScalar(invScale)
    wake.current.position.set(0, (0.03 - root.current.position.y) * invScale, 0)

    // square sail turned to catch the following wind while still facing the viewer
    sail.current.rotation.y = THREE.MathUtils.degToRad(settings.sailTrim)   // + : sail faces downwind (+x)
  })

  return (
    <>
      <group ref={root}>
        <group ref={hull}>
          <RaftModel sailRef={sail} shape={shape} />
        </group>
        {/* the wake trails from the stern and turns with the raft, but stays flat on the water */}
        <Wake ref={wake} />
      </group>
    </>
  )
}
