import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Leva, useControls, folder } from 'leva'
import { config, PAGE } from './activeConfig.js'   // this page's defaults + your saved scene
import QuickToggles from './QuickToggles.jsx'
import { SECTION, features } from './settingsLayout.js'
import SettingsWindow from './SettingsWindow.jsx'
import SunsetScene from './scene/SunsetScene.jsx'

const FRAME_ASPECT = 2560 / 1066 // the sunset reference frame
// Reference images to compare the scene with (public/reference). Every page with a Reference panel can
// pick any of them, day or night.
const REFERENCES = {
  'sunset boat (day)': '/reference/sunset_boat.png',
  'Hei on the raft (night)': '/reference/night_hei.png',
  'moon over the sea (night)': '/reference/night_moon_blue.png',
  'golden moon road (night)': '/reference/night_reference.png',
  'painted starry clouds (night)': '/reference/night_ghibli.png',
  'wake from above': '/reference/wake_topdown.png',
  'wake close up': '/reference/wake_reference.jpg',
}
const DEFAULT_REFERENCE = { sail: 'sunset boat (day)', night: 'Hei on the raft (night)' }
const params = new URLSearchParams(location.search)
const SHOT = params.has('shot') // headless screenshot mode: no panel, fixed time

export default function App() {
  const { fov, height, horizon, tilt, freeLook, frameAspect, compareMode = 'off', compare = 0, image, screens } = useControls(SECTION.scene, {
    Camera: folder({
      fov: { value: config.camera.fov, min: 5, max: 90, step: 0.5 },
      height: { value: config.camera.height, min: 0.3, max: 50, step: 0.1, label: 'height above water' },
      // where the horizon sits on screen: lower = more sky, higher = more ocean
      horizon: { value: config.camera.horizon, min: 0, max: 1, step: 0.005, label: 'ocean level ↕' },
      // extra camera tilt in degrees: + looks up (more sky), - looks down (more ocean)
      tilt: { value: config.camera.tilt ?? 0, min: -45, max: 45, step: 0.1, label: 'tilt up/down °' },
      freeLook: { value: SHOT ? false : config.camera.freeLook, label: 'drag to look' },
      frameAspect: { value: config.camera.frameAspect, label: 'frame 2.4:1' },
    }),
    ...(features.reference ? {
    Reference: folder({
        // compare our scene with the reference frame at the same size
        image: { value: REFERENCES[config.reference.image] ? config.reference.image : DEFAULT_REFERENCE[PAGE] ?? Object.keys(REFERENCES)[0], options: Object.keys(REFERENCES), label: 'reference image' },
        compareMode: { value: config.reference.compareMode, options: ['off', 'overlay', 'side by side', 'above / below'], label: 'compare' },
        compare: { value: config.reference.compare, min: 0, max: 1, step: 0.01, label: 'overlay amount', render: (get) => get(`${SECTION.scene}.Reference.compareMode`) === 'overlay' },
      }, { collapsed: true }),
    } : {}),
    // the scene is the first screen; the page continues below it, so the window always scrolls
    Page: folder({ screens: { value: config.page.screens, min: 1, max: 6, step: 0.5, label: 'page length (screens)' } }, { collapsed: true }),
  })

  // keep the page at the top while it loads (the settings panel can scroll itself into view on start)
  useEffect(() => {
    let userScrolled = false
    const mark = () => (userScrolled = true)
    const opts = { passive: true, once: true }
    ;['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((e) => addEventListener(e, mark, opts))
    const until = performance.now() + 2000
    const hold = () => {
      if (userScrolled) return
      if (scrollY !== 0) scrollTo(0, 0)
      if (performance.now() < until) requestAnimationFrame(hold)
    }
    hold()
    return () => ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((e) => removeEventListener(e, mark))
  }, [])

  // the scene fits the window; in a compare mode the scene and the
  // reference share the space at the same size (always the frame's 2.4:1 shape)
  const pair = compareMode === 'side by side' || compareMode === 'above / below'
  const refSrc = REFERENCES[image] ?? REFERENCES[DEFAULT_REFERENCE[PAGE]] ?? Object.values(REFERENCES)[0]
  const A = FRAME_ASPECT, GAP = 12
  const stage = pair
    ? { width: '100%', aspectRatio: `${A}` }
    : frameAspect
      ? { width: `min(100%, calc(100vh * ${A}))`, aspectRatio: `${A}` }
      : { width: '100%', height: '100vh' }
  const pairStyle =
    compareMode === 'side by side' ? { width: `min(100%, calc(200vh * ${A} + ${GAP}px))`, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: GAP }
    : compareMode === 'above / below' ? { width: `min(100%, calc((100vh - ${GAP + 24}px) / 2 * ${A}))`, gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'auto auto', gap: GAP }
    : { width: '100%', justifyItems: 'center' }

  return (
    <div className="root">
      <main className="page" style={{ minHeight: `${screens * 100}vh` }}>
       <section className="scene">
        <div className="pair" style={pairStyle}>
        <div className="stage" style={stage}>
          <Canvas
            flat
            dpr={SHOT ? 1 : [1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: SHOT }}
            camera={{ fov, near: 0.1, far: 100000, position: [0, height, 0] }}
          >
            <SunsetScene camera={{ fov, height, freeLook, horizon, tilt }} />
          </Canvas>
          {compareMode === 'overlay' && <img className="reference" src={refSrc} style={{ opacity: compare, objectFit: 'cover' }} alt="" />}
          {pair && <span className="pane-label">our scene</span>}
        </div>
        {pair && (
          <div className="stage" style={stage}>
            <img className="reference" src={refSrc} style={{ objectFit: 'contain', background: '#05070d' }} alt="reference" />
            <span className="pane-label">reference: {image}</span>
          </div>
        )}
        </div>
       </section>
       {/* the rest of the page: portfolio sections will go here */}
      </main>

      {/* floating, see-through settings window (drag it anywhere) */}
      {SHOT ? <Leva hidden /> : <SettingsWindow />}
      {!SHOT && <QuickToggles />}
    </div>
  )
}
