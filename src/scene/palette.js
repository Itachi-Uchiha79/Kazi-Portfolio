import * as THREE from 'three'
import { useControls, folder } from 'leva'

// Default look: every value comes from src/sceneConfig.json (the single file that holds the whole scene).
// Groups: scene (scene size: sceneScale 1 = like the reference, matchFov keeps the framing at any fov),
// wind, raftShape (each raft part, 1 = original size), raftPosition (leftRight -1..1 across the screen,
// upDown -1 bottom .. 1 horizon, sink / bowLift / sternLift in metres), wake, raft, sun, sky, ocean, waves, clouds.
// Colors are display (sRGB) hex values. Tweak them live in the panel, press "copy everything",
// and paste the result over src/sceneConfig.json to make it the default.
import { config, PAGE } from '../activeConfig.js'   // this page's defaults + your saved scene
import { SECTION, SECTION_ORDER, features } from '../settingsLayout.js'

const PALETTE_GROUPS = ['scene', 'wind', 'raftShape', 'raftPosition', 'wake', 'raft', 'sun', 'night', 'sky', 'ocean', 'waves', 'clouds', 'birds']
export const DEFAULTS = Object.fromEntries(PALETTE_GROUPS.map((g) => [g, config[g]]))

const hex = (h) => new THREE.Vector3(...new THREE.Color(h).convertLinearToSRGB().toArray())

export function sunDirection(azDeg, elDeg) {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg)
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az))
}

// One shared uniform set: sky, ocean and clouds all read the same objects,
// so the ocean reflects exactly the sky you see and the clouds share the sun.
export const uniforms = {
  uTime: { value: 0 }, uSunDir: { value: sunDirection(24, 0.4) }, uFovScale: { value: 1 },
  uWind: { value: 0 },
  uCloudDepth: { value: 0 },     // cloud flow toward (+) / away from (-) the camera
  uSunVis: { value: 1 },         // showSun * sunStrength           // cloud drift, deg/s, > 0 = moving left (set from the Wind settings)
  uWaveDirection: { value: 0 },  // wave flow, deg, 0 = moving right (set from the Wind settings)
}

const NAME = {
  sunColor: 'uSunColor', glowSize: 'uSunGlowSize', glowStrength: 'uSunGlowStrength', discSize: 'uSunDiscSize', moonLook: 'uMoonLook', moonFlare: 'uMoonFlare',
  stars: 'uStars', starSize: 'uStarSize', sparkleStars: 'uSparkleStars', twinkle: 'uTwinkle', milkyWay: 'uMilkyWay', starColor: 'uStarColor', sunThroughClouds: 'uSunThroughClouds',
  sky0: 'uSky0', sky1: 'uSky1', sky2: 'uSky2', sky3: 'uSky3', sky4: 'uSky4', sky5: 'uSky5', sky6: 'uSky6',
  skyStretch: 'uSkyStretch', horizonSun: 'uHorizonSun', lowSun: 'uLowSun', horizonAway: 'uHorizonAway',
  lowAway: 'uLowAway', streakLit: 'uStreakLit', streakShade: 'uStreakShade', streakAmount: 'uStreakAmount',
  ocean0: 'uOcean0', ocean1: 'uOcean1', ocean2: 'uOcean2', ocean3: 'uOcean3', ocean4: 'uOcean4',
  ocean5: 'uOcean5', ocean6: 'uOcean6', oceanStretch: 'uOceanStretch', reflection: 'uReflection',
  waveStrength: 'uWaveStrength', waveSpeed: 'uWaveSpeed', waveScale: 'uWaveScale', glint: 'uGlint',
  glintSharpness: 'uGlintSharpness', sparkle: 'uSparkle', sparkleSize: 'uSparkleSize',
  sparkleSpread: 'uSparkleSpread', waveShade: 'uWaveShade',
  bioGlow: 'uBioGlow', bioColor: 'uBioColor', bioSize: 'uBioSize', bioSpeed: 'uBioSpeed', bioDensity: 'uBioDensity', waveHeight: 'uWaveHeight',
  bark: 'uBark', barkDark: 'uBarkDark', barkLight: 'uBarkLight', endGrain: 'uEndGrain', rope: 'uRope', sail: 'uSail',
  sailBillow: 'uSailBillow', lightWrap: 'uLightWrap',
  wakeForce: 'uWakeForce', wakeSize: 'uWakeSize', wakeLength: 'uWakeLength', wakeDepth: 'uWakeDepth',
  wakeBreakup: 'uWakeBreakup', foam: 'uFoam', wakeFlow: 'uWakeFlow', wakeLace: 'uWakeLace', wakeChannel: 'uWakeChannel',
  wakeAngle: 'uWakeAngle', armHeight: 'uArmHeight', armFoam: 'uArmFoam', armCount: 'uArmCount',
  wakeWater: 'uWakeWater',
  sternHeight: 'uSternHeight', sternLength: 'uSternLength', sternWidth: 'uSternWidth', sternRolls: 'uSternRolls',
  sternChurn: 'uSternChurn', sternFoam: 'uSternFoam', birdColor: 'uBirdColor', flapSpeed: 'uFlapSpeed',
  cloudShadow: 'uCloudShadow', cloudMid: 'uCloudMid', cloudLit: 'uCloudLit', cloudRim: 'uCloudRim',
  cloudSkyTint: 'uCloudSkyTint', cloudSoftness: 'uCloudSoftness', cloudBrush: 'uCloudBrush',
}

// set one setting (and its shader uniform), like moving its slider
export function applySetting(key, value) { apply(key, value) }

function apply(key, value) {
  if (key === 'showSun' || key === 'sunStrength') {
    current[key] = value
    uniforms.uSunVis.value = (current.showSun ?? true) ? (current.sunStrength ?? 1) : 0
    return
  }
  if (key === 'sunAzimuth' || key === 'sunElevation') {
    current[key] = value
    uniforms.uSunDir.value.copy(sunDirection(current.sunAzimuth, current.sunElevation))
    return
  }
  current[key] = value                 // plain settings (e.g. cloud size) are read from here
  const name = NAME[key]
  if (!name) return
  const v = typeof value === 'string' ? hex(value) : typeof value === 'boolean' ? +value : value
  if (uniforms[name]) uniforms[name].value = v
  else uniforms[name] = { value: v }
  current[key] = value
}

// current values of every setting (the uniforms hold the shader-side copies)
export const settings = {}
const current = settings
for (const group of Object.values(DEFAULTS)) for (const [k, v] of Object.entries(group)) apply(k, v)

// Wind: the compass heading (degrees) the wind blows toward. 0 = north (away from the camera),
// 90 = east (right), 180 = south (toward the camera), 270 = west (left). Older saves used
// 'left → right' / 'right → left'; those still work.
const WIND_HEADINGS = {
  'north → south': 180, 'south → north': 0, 'west → east': 90, 'east → west': 270,
  'left → right': 90, 'right → left': 270,
}
export function windHeading() {
  const h = WIND_HEADINGS[settings.windDirection]
  return h ?? settings.windHeading ?? 90
}
// heading -> direction on the water: x = east (right), z = south (toward the camera)
export const headingVector = (deg) => {
  const r = (deg * Math.PI) / 180
  const snap = (v) => (Math.abs(v) < 1e-9 ? 0 : v)
  return { x: snap(Math.sin(r)), z: snap(-Math.cos(r)) }
}

// Leva schema that writes straight into the uniforms (no React re-render per change).
const RANGES = {
  sunAzimuth: [-180, 180, 0.5], sunElevation: [-3, 70, 0.05], moonLook: [0, 1, 0.01], moonFlare: [0, 3, 0.01], stars: [0, 3, 0.01], starSize: [0.2, 4, 0.01], sparkleStars: [0, 3, 0.01], twinkle: [0, 1, 0.01], milkyWay: [0, 2, 0.01], sunStrength: [0, 1, 0.01], glowSize: [0.5, 40, 0.1],
  glowStrength: [0, 2, 0.01], discSize: [0, 5, 0.05], sunThroughClouds: [0, 1.5, 0.01], skyStretch: [0.3, 4, 0.01], streakAmount: [0, 1, 0.01],
  oceanStretch: [0.3, 4, 0.01], reflection: [0, 1, 0.01], waveStrength: [0, 4, 0.005], waveHeight: [0, 6, 0.01],
  waveSpeed: [0, 6, 0.01], waveScale: [0.1, 8, 0.01], glint: [0, 4, 0.01], glintSharpness: [50, 4000, 10],
  sparkle: [0, 3, 0.01], bioGlow: [0, 3, 0.01], bioSize: [0.2, 5, 0.01], bioSpeed: [0, 4, 0.01], bioDensity: [0, 1.5, 0.01], sparkleSize: [0.2, 4, 0.01], sparkleSpread: [0.2, 5, 0.01], waveAngle: [-90, 90, 1], bobSpeed: [0, 4, 0.01],
  sternHeight: [0, 3, 0.01], sternLength: [0.2, 3, 0.01], sternWidth: [0.3, 3, 0.01], sternRolls: [0.5, 8, 0.1], sternChurn: [0, 3, 0.01], sternFoam: [0, 3, 0.01],
  birdSize: [0.2, 4, 0.01], birdSpeed: [0, 4, 0.01], flapSpeed: [0, 4, 0.01], wakeForce: [0, 3, 0.01], wakeSize: [0.2, 3, 0.01], wakeLength: [0.1, 3, 0.01],
  wakeDepth: [0, 3, 0.01], wakeBreakup: [0, 1.5, 0.01], wakeFlow: [0, 6, 0.01], wakeLace: [0, 3, 0.01], wakeChannel: [0, 1.5, 0.01], wakeAngle: [4, 35, 0.5], armHeight: [0, 4, 0.01], armFoam: [0, 3, 0.01], armCount: [1, 5, 1], raftLength: [0.3, 3, 0.01], raftWidth: [0.3, 3, 0.01], logThickness: [0.4, 2.5, 0.01],
  mastHeight: [0.3, 3, 0.01], mastThickness: [0.4, 3, 0.01], mastPosition: [-0.9, 0.9, 0.01], sailWidth: [0.3, 2.5, 0.01], sailHeight: [0.3, 2.5, 0.01], pointLength: [0.05, 1.5, 0.01], bowShape: [0, 1.5, 0.01], sceneScale: [0.3, 3, 0.01], cloudSpeed: [0, 3, 0.01], cloudHeading: [0, 360, 1], windHeading: [0, 360, 1],
  raftSpeed: [0, 4, 0.01], leftRight: [-1.3, 1.3, 0.01], upDown: [-1, 1, 0.01], sink: [0, 6, 0.01], bowLift: [-3, 3, 0.01], sternLift: [-3, 3, 0.01], raftScale: [0.3, 3, 0.01], raftYaw: [-90, 90, 1],
  bobbing: [0, 3, 0.01], sailBillow: [0, 3, 0.01], sailTrim: [0, 90, 1], lightWrap: [0, 1, 0.01], waveShade: [0, 3, 0.01], cloudWidth: [0.3, 3, 0.01], cloudSpread: [0.5, 3, 0.01], cloudHeight: [0.3, 3, 0.01], cloudSoftness: [0.01, 0.6, 0.005], cloudBrush: [0, 0.4, 0.01],
}

const OPTIONS = {
  // which way the ocean waves travel: with the wind, or along the raft (from behind it toward its front / back)
  waveFlow: ['wind', 'raft forward', 'raft backward'],
  logEnds: ['pointed front', 'pointed both ends', 'flat'],
  motion: ['sailing', 'anchored'],
  // where the wind blows TO (the camera looks north: east is right, south is toward you).
  // Clouds, waves, the raft and its wake all follow it. 'custom' = any direction via windHeading.
  windDirection: ['west → east', 'east → west', 'north → south', 'south → north', 'custom'],
  // cloud flow over the sky: follow the wind, or a compass direction (the camera looks north,
  // so east is to the right; north → south = clouds come toward you from the horizon)
  // 'custom heading' = any direction: cloudHeading is the compass direction they move toward
  // (0 north = away from you, 90 east = right, 180 south = toward you, 270 west = left)
  clouds: ['with wind', 'against wind', 'west → east', 'east → west', 'north → south', 'south → north', 'custom heading'],
  waves: ['with wind', 'against wind'],
}

// Sky gradient, bottom to top: where each colour shows (sky6 is straight overhead, so it is only
// seen when looking up; the horizon* colours tint the band just above the horizon toward / away from the sun)
const SKY_LABELS = {
  sky0: 'sky0 horizon line', sky1: 'sky1 low', sky2: 'sky2 lower-mid', sky3: 'sky3 middle',
  sky4: 'sky4 upper-mid', sky5: 'sky5 high', sky6: 'sky6 overhead',
}

// On the night page the "sun" is the moon: same settings, moon-named labels.
const MOON_LABELS = {
  showSun: 'showMoon', sunStrength: 'moonStrength', sunAzimuth: 'moonAzimuth', sunElevation: 'moonElevation',
  sunColor: 'moonColor', glowSize: 'haloSize', glowStrength: 'haloStrength', discSize: 'moonSize',
  sunThroughClouds: 'moonThroughClouds', moonLook: 'craters (moon look)', moonFlare: 'moonFlare',
}

function schema(group, labels = {}, hide = []) {
  return Object.fromEntries(Object.entries(group).filter(([k]) => !hide.includes(k)).map(([k, v]) => {
    const r = RANGES[k]
    const entry = { value: v, onChange: (val) => apply(k, val) }
    if (labels[k]) entry.label = labels[k]
    if (r) Object.assign(entry, { min: r[0], max: r[1], step: r[2] })
    if (OPTIONS[k]) entry.options = OPTIONS[k]
    return [k, entry]
  }))
}

export function usePaletteControls() {
  const section = (key, panels, opts = {}) =>
    folder(panels, { order: SECTION_ORDER.indexOf(key), collapsed: true, ...opts })
  const f = features
  useControls({
    [SECTION.scene]: section('scene', {
      'Scene size': folder(schema(DEFAULTS.scene), { collapsed: true }),
      'Wind & motion': folder(schema(DEFAULTS.wind)),
    }),
    [SECTION.sky]: section('sky', {
      ...(f.sun ? { Sun: folder(schema(DEFAULTS.sun, {}, ['moonLook', 'moonFlare'])) } : {}),
      ...(f.moon ? { Moon: folder(schema(DEFAULTS.sun, MOON_LABELS)) } : {}),
      ...(f.nightSky ? { 'Night sky': folder(schema(DEFAULTS.night)) } : {}),
      'Sky colours': folder(schema(DEFAULTS.sky, SKY_LABELS), { collapsed: true }),
    }, { collapsed: !f.moon }),
    [SECTION.clouds]: section('clouds', {
      Look: folder(schema(DEFAULTS.clouds)),
    }),
    [SECTION.ocean]: section('ocean', {
      'Waves & sparkle': folder(schema(DEFAULTS.waves)),
      'Ocean colours': folder(schema(DEFAULTS.ocean), { collapsed: true }),
    }),
    [SECTION.raft]: section('raft', {
      Position: folder(schema(DEFAULTS.raftPosition)),
      'Look & motion': folder(schema(DEFAULTS.raft), { collapsed: true }),
      Shape: folder(schema(DEFAULTS.raftShape), { collapsed: true }),
      Wake: folder(schema(DEFAULTS.wake), { collapsed: true }),
    }),
    ...(f.birds ? { [SECTION.birds]: section('birds', { Look: folder(schema(DEFAULTS.birds)) }) } : {}),
  })
}
