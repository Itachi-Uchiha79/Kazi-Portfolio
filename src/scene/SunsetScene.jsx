import { useFrame } from '@react-three/fiber'
import { uniforms, settings, usePaletteControls, windHeading, headingVector } from './palette.js'
import { raftHeadingDeg } from './Raft.jsx'
import Sky from './Sky.jsx'
import Ocean from './Ocean.jsx'
import Clouds from './Clouds.jsx'
import CameraRig from './CameraRig.jsx'
import Raft from './Raft.jsx'
import Birds from './Birds.jsx'
import { features } from '../settingsLayout.js'

// ?t=12.5 freezes the animation clock at that time (for comparing screenshots); ?waveDir=0 overrides the wave flow
const params = new URLSearchParams(location.search)
const FIXED_TIME = params.get('t')
const WAVE_DIR = params.get('waveDir')

export default function SunsetScene({ camera }) {
  usePaletteControls()
  useFrame((_, dt) => {
    uniforms.uTime.value = FIXED_TIME !== null ? +FIXED_TIME : uniforms.uTime.value + Math.min(dt, 0.1)
    // wind: one compass heading for the whole scene (see windHeading in palette.js). Clouds and waves
    // follow it (or go against it / take their own direction); the raft sails with it (Raft.jsx).
    const wind = windHeading()
    const LEGACY = { 'left → right': 'west → east', 'right → left': 'east → west', 'top → bottom': 'north → south', 'bottom → top': 'south → north' }
    const flow = LEGACY[settings.clouds] ?? settings.clouds
    const CLOUD_FIXED = { 'west → east': 90, 'east → west': 270, 'north → south': 180, 'south → north': 0 }
    const cloudHeading = flow === 'with wind' ? wind
      : flow === 'against wind' ? wind + 180
      : flow === 'custom heading' ? settings.cloudHeading ?? 180
      : CLOUD_FIXED[flow] ?? wind
    const cv = headingVector(cloudHeading)
    uniforms.uWind.value = -settings.cloudSpeed * cv.x          // > 0 moves clouds left (west)
    uniforms.uCloudDepth.value = settings.cloudSpeed * cv.z     // > 0 moves clouds toward you (south)

    // waves: an angle on the water, 0 = toward +x (east), 90 = toward +z (south)
    const toAngle = (heading) => { const v = headingVector(heading); return (Math.atan2(v.z, v.x) * 180) / Math.PI }
    const raftHeading = raftHeadingDeg(wind)
    const base = settings.waveFlow === 'raft forward' ? toAngle(raftHeading)
      : settings.waveFlow === 'raft backward' ? toAngle(raftHeading + 180)
      : toAngle(settings.waves === 'against wind' ? wind + 180 : wind)
    uniforms.uWaveDirection.value = (WAVE_DIR !== null ? +WAVE_DIR : base) + settings.waveAngle
  })
  return (
    <>
      <CameraRig {...camera} />
      <Sky />
      <Ocean />
      <Clouds />
      <Raft />
      {features.birds && <Birds />}
    </>
  )
}
