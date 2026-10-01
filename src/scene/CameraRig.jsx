import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { dragState } from './Clouds.jsx'
import { uniforms, settings } from './palette.js'

// Camera ~1 m above the water. fov 37.5 (vertical), tilted up so the horizon sits at 60% of the
// image height, as in the reference frame (which was shot at ~20 degrees).
export const REFERENCE_CAMERA = { height: 1, fov: 37.5, pitchDeg: 3.83, yawDeg: 0 }
const DESIGN_ASPECT = 16 / 9 // the framing is designed for this screen shape
const DESIGN_FOV = 20 // the reference frame (and the sky/cloud composition) was painted for this fov

// horizon: where the horizon sits on screen, 0 = bottom edge (all sky) .. 1 = top edge (all ocean).
// The camera tilts to put it there; dragging to look around adds on top (R resets).
export function pitchForHorizon(horizon, fovDeg) {
  const tanV = Math.tan((fovDeg * Math.PI) / 360)
  return THREE.MathUtils.radToDeg(Math.atan((1 - 2 * horizon) * tanV))
}

export default function CameraRig({ fov, height, freeLook, horizon = 0.4015, tilt = 0 }) {
  const { camera, gl } = useThree()
  const look = useRef({ yaw: 0, pitch: 0 })   // drag offsets from the base view

  useEffect(() => {
    const reset = () => (look.current = { yaw: REFERENCE_CAMERA.yawDeg, pitch: 0 })
    let last = null
    const down = (e) => { if (freeLook && !dragState.active) last = [e.clientX, e.clientY] }
    const move = (e) => {
      if (!last || dragState.active) return
      const k = camera.fov / gl.domElement.clientHeight
      look.current.yaw -= (e.clientX - last[0]) * k
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch + (e.clientY - last[1]) * k, -60, 80)
      last = [e.clientX, e.clientY]
    }
    const up = () => (last = null)
    const key = (e) => e.key.toLowerCase() === 'r' && reset()
    gl.domElement.addEventListener('pointerdown', down)
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('keydown', key)
    if (!freeLook) reset()
    return () => {
      gl.domElement.removeEventListener('pointerdown', down)
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('keydown', key)
    }
  }, [camera, gl, freeLook])

  useFrame(() => {
    camera.position.set(0, height, 0)
    camera.rotation.order = 'YXZ'
    const pitch = pitchForHorizon(horizon, camera.fov) + tilt + look.current.pitch   // actual view, so the horizon stays put on any screen
    // the framing as designed (16:9 at this fov): things placed "by screen position" use this, so they
    // keep the same place in the world on every device instead of following the screen shape
    camera.userData.design = { fov, aspect: DESIGN_ASPECT, pitch: THREE.MathUtils.degToRad(pitchForHorizon(horizon, fov) + tilt) }
    camera.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(look.current.yaw), 0)
    // any screen: fov is the vertical view on a 16:9 screen; narrower (phones, portrait) screens widen
    // the vertical view so you still see the same width of the scene, wider screens just see more sides
    const tanH = Math.tan((fov * Math.PI) / 360) * DESIGN_ASPECT
    const vfov = Math.min(Math.max(fov, (2 * Math.atan(tanH / camera.aspect) * 180) / Math.PI), 110)
    if (Math.abs(camera.fov - vfov) > 1e-3) { camera.fov = vfov; camera.updateProjectionMatrix() }
    // scene size: scales clouds + sky/ocean gradients together (see "Scene size" in the panel)
    uniforms.uFovScale.value = settings.sceneScale * (settings.matchFov ? fov / DESIGN_FOV : 1)   // the sky keeps its size on any screen
  })
  return null
}
