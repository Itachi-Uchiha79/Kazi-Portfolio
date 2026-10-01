import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls, button } from 'leva'
import * as THREE from 'three'
import { noise, sky } from './shaders/common.glsl.js'
import { uniforms, settings } from './palette.js'
import { config } from '../activeConfig.js'
import { live as liveScene } from '../sceneExport.js'
import { dirFromAngles, dragState } from './Clouds.jsx'
import { SECTION } from '../settingsLayout.js'

// Flocks of birds drawn by a shader: each bird is a gull "M" silhouette whose wings flap in the
// vertex shader (own phase, occasional glides). A flock flies across the sky and loops around.
// Flock: { id, count, formation 'V' | 'loose', spread, size, speed, dir 'left' | 'right', az, el, seed }
//   az / el = where in the sky (degrees, like the clouds), size = wingspan (about 1 = 0.9°).

const MAX = 60           // birds per flock
const SEG = 6            // segments per wing
const DIST = 3000        // metres: far away, so the camera moving doesn't shift them
const BAND = 78          // they fly within ±BAND degrees, then loop to the other side
const DEG = Math.PI / 180
const FORMATIONS = ['V', 'loose']

// one geometry holds MAX birds; the shader places and animates them
const birdGeometry = (() => {
  const aBird = [], aSide = [], aT = [], aEdge = [], pos = [], index = []
  let v = 0
  for (let b = 0; b < MAX; b++) {
    for (const side of [-1, 1]) {
      const start = v
      for (let j = 0; j <= SEG; j++) {
        for (const edge of [-1, 1]) {
          aBird.push(b); aSide.push(side); aT.push(j / SEG); aEdge.push(edge)
          pos.push(side * (j / SEG) * 0.5, edge * 0.03, 0)   // rest shape, only for bounds
          v++
        }
      }
      for (let j = 0; j < SEG; j++) {
        const a = start + j * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aBird', new THREE.Float32BufferAttribute(aBird, 1))
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(aSide, 1))
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1))
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(aEdge, 1))
  g.setIndex(index)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40)
  return g
})()

const vertexShader = /* glsl */ `
  uniform float uTime, uFlapSpeed, uCount, uSpread, uSeed, uFormation, uDirSign;
  attribute float aBird, aSide, aT, aEdge;
  varying vec3 vDir;
  float hash(float n) { return fract(sin(n * 91.3 + uSeed * 17.1) * 43758.5453); }
  void main() {
    float i = aBird;
    if (i >= uCount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // where this bird sits in the flock (in wingspans)
    vec2 off;
    if (uFormation < 0.5) {                                  // V: leader in front, the rest trail back in two lines
      float k = ceil(i / 2.0);
      float s = i < 0.5 ? 0.0 : (mod(i, 2.0) * 2.0 - 1.0);
      off = vec2(-uDirSign * k * 0.9, s * k * 0.5) * uSpread;
    } else {                                                 // loose: scattered, drifting a little
      off = (vec2(hash(i), hash(i + 7.3)) - 0.5) * vec2(5.0, 2.6) * uSpread * (0.4 + 0.6 * sqrt(uCount / 10.0));
    }
    off += vec2(sin(uTime * 0.37 + i * 1.7), cos(uTime * 0.29 + i * 2.3)) * 0.12 * uSpread;
    float size = 0.85 + 0.3 * hash(i + 3.1);

    // flapping with glides
    float phase = uTime * uFlapSpeed * 7.0 * (0.9 + 0.2 * hash(i + 5.0)) + hash(i + 1.0) * 6.2832;
    float amp = mix(0.2, 1.0, smoothstep(-0.3, 0.4, sin(uTime * 0.35 + hash(i + 9.0) * 12.0)));
    float s = sin(phase) * amp;
    float a1 = 0.55 * s + 0.15;                              // inner wing
    float a2 = 0.9 * sin(phase - 0.7) * amp - 0.35;          // outer wing lags behind: gull "M"
    float t = aT;
    float y = t < 0.4 ? t * a1 : 0.4 * a1 + (t - 0.4) * a2;
    float w = mix(0.08, 0.018, t);                           // wings taper to the tip
    vec2 p = vec2(aSide * t * 0.5, y + aEdge * w * 0.5 - 0.06 * s);
    vec4 wp = modelMatrix * vec4(vec3(off + p * size, 0.0), 1.0);
    vDir = normalize(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`

const fragmentShader = /* glsl */ `
  ${noise}
  ${sky}
  uniform vec3 uBirdColor;
  varying vec3 vDir;
  void main() {
    vec3 c = mix(uBirdColor, skyGradient(vDir), 0.18);       // a little sky haze: they're far away
    gl_FragColor = vec4(c, 1.0);
  }`

function makeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uCount: { value: 7 }, uSpread: { value: 1 }, uSeed: { value: 1 }, uFormation: { value: 0 }, uDirSign: { value: -1 },
    },
    vertexShader, fragmentShader, side: THREE.DoubleSide,
  })
}

const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })

function Flock({ flock, onGrab }) {
  const group = useRef()
  const material = useMemo(makeMaterial, [])
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ camera }) => {
    const t = uniforms.uTime.value
    const el = flock.el + Math.sin(t * 0.3 + flock.seed) * 0.35
    group.current.position.copy(camera.position).addScaledVector(dirFromAngles(flock.az, el), DIST)
    group.current.lookAt(camera.position)
    const span = 0.9 * flock.size * settings.birdSize                // wingspan in degrees
    group.current.scale.setScalar(2 * DIST * Math.tan((span / 2) * DEG))
    group.current.visible = settings.birdsVisible
    const u = material.uniforms
    u.uCount.value = Math.min(Math.round(flock.count), MAX)
    u.uSpread.value = flock.spread
    u.uSeed.value = flock.seed
    u.uFormation.value = flock.formation === 'V' ? 0 : 1
    u.uDirSign.value = flock.dir === 'right' ? 1 : -1
  })
  const hitW = 6 * Math.max(flock.spread, 0.5) * (flock.formation === 'V' ? Math.max(1, flock.count / 4) : 1.2)
  return (
    <group ref={group}>
      <mesh geometry={birdGeometry} material={material} frustumCulled={false} renderOrder={5} />
      {/* invisible hit area to click / drag the flock */}
      <mesh
        material={hitMaterial}
        onPointerDown={(e) => { e.stopPropagation(); onGrab(flock, e) }}
        onPointerOver={() => (document.body.style.cursor = 'grab')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <planeGeometry args={[hitW, 3.5 * Math.max(flock.spread, 0.5)]} />
      </mesh>
    </group>
  )
}

function showHint(text) {
  let el = document.getElementById('bird-hint')
  if (!el) {
    el = document.createElement('div')
    el.id = 'bird-hint'
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', padding: '8px 14px',
      background: '#000b', color: '#fff', font: '13px system-ui, sans-serif', borderRadius: '8px', pointerEvents: 'none', zIndex: 10,
    })
    document.body.appendChild(el)
  }
  el.textContent = text || ''
  el.hidden = !text
}

const live = (fn) => (v, _p, ctx) => { if (!ctx?.initial) fn(v) }
const r1 = (v) => Math.round(v * 100) / 100

export default function Birds() {
  const [flocks, setFlocks] = useState(() => (config.birdLayout || []).map((f) => ({ ...f })))
  const flocksRef = useRef(flocks)
  flocksRef.current = flocks
  const [types, setTypes] = useState(() => structuredClone(config.birdTypes || {}))
  const typesRef = useRef(types)
  typesRef.current = types
  const [selected, setSelected] = useState(null)
  const { camera, gl } = useThree()
  const grab = useRef(null)
  const placing = useRef(null)
  const frozen = useMemo(() => new URLSearchParams(location.search).has('shot'), [])

  liveScene.birds = () => flocksRef.current
  liveScene.birdTypes = () => typesRef.current

  const pointerAngles = (x, y) => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera)
    const d = ray.ray.direction
    return { az: Math.atan2(d.x, -d.z) / DEG, el: Math.asin(d.y) / DEG }
  }
  const addFlock = (base, az, el) => {
    const id = Math.max(0, ...flocksRef.current.map((f) => f.id)) + 1
    const f = { ...base, id, az, el: Math.max(1, el), seed: 1 + Math.floor(Math.random() * 997) }
    setFlocks((fs) => [...fs, f]); setSelected(f)
  }
  const removeFlock = (f) => { setFlocks((fs) => fs.filter((x) => x !== f)); setSelected(null) }
  const startPlacing = (name) => {
    placing.current = name
    showHint(`Click in the sky to place: ${name}  ·  Esc to cancel`)
    document.body.style.cursor = 'crosshair'
  }
  const stopPlacing = () => { placing.current = null; showHint(null); document.body.style.cursor = '' }

  useControls(`${SECTION.birds}.Add birds`, Object.fromEntries(Object.keys(types).map((n) => [n, button(() => startPlacing(n))])),
    { collapsed: true }, [Object.keys(types).join('|')])

  const onGrab = (flock, e) => {
    if (placing.current) return
    const a = pointerAngles(e.nativeEvent.clientX, e.nativeEvent.clientY)
    grab.current = { flock, dAz: flock.az - a.az, dEl: flock.el - a.el }
    setSelected(flock)
    dragState.active = true
    document.body.style.cursor = 'grabbing'
  }

  useEffect(() => {
    const move = (e) => {
      if (!grab.current) return
      const a = pointerAngles(e.clientX, e.clientY)
      grab.current.flock.az = a.az + grab.current.dAz
      grab.current.flock.el = Math.max(1, a.el + grab.current.dEl)
    }
    const up = () => { if (grab.current) { grab.current = null; dragState.active = false; document.body.style.cursor = '' } }
    const place = (e) => {
      if (!placing.current || e.target !== gl.domElement) return
      e.stopPropagation()
      const t = typesRef.current[placing.current]
      const a = pointerAngles(e.clientX, e.clientY)
      if (t) addFlock(t, a.az, a.el)
      stopPlacing()
    }
    const key = (e) => e.key === 'Escape' && stopPlacing()
    addEventListener('pointermove', move); addEventListener('pointerup', up)
    addEventListener('pointerdown', place, true); addEventListener('keydown', key)
    return () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      removeEventListener('pointerdown', place, true); removeEventListener('keydown', key)
    }
  })

  // fly across the sky and loop around
  useFrame((_, dt) => {
    if (frozen) return
    for (const f of flocksRef.current) {
      if (grab.current?.flock === f) continue
      const sgn = f.dir === 'right' ? 1 : -1
      f.az += sgn * f.speed * settings.birdSpeed * 1.2 * Math.min(dt, 0.1)
      if (f.az * sgn > BAND) { f.az = -sgn * BAND; f.seed += 13 }
    }
  })

  return (
    <>
      {flocks.map((f) => <Flock key={f.id} flock={f} onGrab={onGrab} />)}
      {selected && (
        <FlockEditor
          key={selected.id}
          flock={selected}
          onDuplicate={() => addFlock(selected, selected.az - 8, selected.el + 3)}
          onDelete={() => removeFlock(selected)}
          onSaveAsType={() => {
            let i = 1; while (typesRef.current[`my birds ${i}`]) i++
            const { count, formation, spread, size, speed, dir } = selected
            setTypes((t) => ({ ...t, [`my birds ${i}`]: { count, formation, spread, size, speed, dir } }))
          }}
          typeNames={Object.keys(types)}
          onDeleteType={(name) => setTypes((t) => { const { [name]: _, ...rest } = t; return rest })}
        />
      )}
    </>
  )
}

// Panel for the flock you last clicked (or just placed)
function FlockEditor({ flock, onDuplicate, onDelete, onSaveAsType, typeNames, onDeleteType }) {
  const setRef = useRef()
  const [, set] = useControls(`${SECTION.birds}.Selected flock #${flock.id}`, () => ({
    count: { value: flock.count, min: 1, max: MAX, step: 1, onChange: live((v) => (flock.count = v)) },
    formation: { value: flock.formation, options: FORMATIONS, onChange: live((v) => (flock.formation = v)) },
    spread: { value: flock.spread, min: 0.2, max: 4, step: 0.01, onChange: live((v) => (flock.spread = v)) },
    size: { value: flock.size, min: 0.2, max: 5, step: 0.01, onChange: live((v) => (flock.size = v)) },
    speed: { value: flock.speed, min: 0, max: 5, step: 0.01, onChange: live((v) => (flock.speed = v)) },
    dir: { value: flock.dir, options: ['left', 'right'], label: 'flies to', onChange: live((v) => (flock.dir = v)) },
    elevation: { value: flock.el, min: 1, max: 60, step: 0.1, onChange: live((v) => (flock.el = v)) },
    'new shuffle': button(() => (flock.seed += 7)),
    duplicate: button(() => onDuplicate()),
    'save as bird type': button(() => onSaveAsType()),
    delete: button(() => onDelete()),
    'delete a type': { value: '—', options: ['—', ...typeNames], onChange: live((v) => v !== '—' && onDeleteType(v)) },
  }))
  setRef.current = set
  return null
}

