// The cloud "batch", traced from reference/sunset_boat.png (numbers match reference/cloud_analysis.png).
// Angles in degrees as seen from the camera: az = left/right (+ right), el = above the horizon,
// w/h = angular size. type: cumulus | stratus | wisp | bits.
// dark = how much the cloud darkens the sky behind it (0 = pale wisp, 1 = heavy shadow side).
// lit  = how strongly the sun can light it (colour itself comes from the distance to the sun).
// All clouds drift right -> left; one that leaves on the left re-enters on the right with a new shape.
// The data lives in src/sceneConfig.json (cloudLayout / cloudTypes): "copy everything" in the app
// includes every cloud as it is right now, so pasting that file keeps your sky exactly.
import { config } from '../activeConfig.js'   // sceneConfig.json + your saved scene

export const CLOUDS = config.cloudLayout

// Cloud types by altitude, highest first. `layer` is the draw order: 0 = back (high / far),
// 3 = front (low / near), because low clouds pass in front of high ones as you look up.
//   lit wisp          cirrus, thin ice-crystal clouds that catch sunlight        6-12 km
//   towering cumulus  cumulus congestus: low base, tops building to 6 km+      (layered by its top)
//   big cumulus       a large cumulus mass, same tier as the towering ones
//   broken cloud      altocumulus, the patchy mid-level layer                    2-6 km
//   small cumulus     fair-weather cumulus, the little puffy ones                0.5-2 km
//   dark streak       low stratus / scud, ragged dark fragments under the deck   below 1 km
//   horizon band      a layer far away on the horizon: behind everything
export const ALTITUDE = [
  ['lit wisp', 0],
  ['towering cumulus', 1],
  ['big cumulus', 1],
  ['broken cloud', 2],
  ['small cumulus', 2],
  ['dark streak', 3],
  ['horizon band', 0],
]

// The built-in cloud types. They are always available (a page's saved version of one wins), so
// deleting one by mistake can't lose it; only your own custom types can be deleted.
export const BUILTIN_TYPES = {
  'lit wisp': { type: 'wisp', w: 6, h: 0.7, dark: 0, lit: 1 },
  'towering cumulus': { type: 'cumulus', w: 9, h: 7, dark: 0.85, lit: 0.9 },
  'big cumulus': { type: 'cumulus', w: 18, h: 6.5, dark: 0.9, lit: 0.95 },
  'broken cloud': { type: 'bits', w: 8, h: 3, dark: 0.7, lit: 0.9 },
  'small cumulus': { type: 'cumulus', w: 5, h: 2, dark: 0.75, lit: 0.9 },
  'dark streak': { type: 'stratus', w: 14, h: 3, dark: 1, lit: 0.2 },
  'horizon band': { type: 'stratus', w: 20, h: 1.6, dark: 0.3, lit: 1 },
}

// the page's types in altitude order (your own types keep their layer and come after)
export function byAltitude(types) {
  const out = {}
  for (const [name, layer] of ALTITUDE) out[name] = { ...BUILTIN_TYPES[name], ...types[name], layer }
  for (const [name, t] of Object.entries(types)) if (!out[name]) out[name] = t
  return out
}

// Cloud types for the "Add clouds" panel: press one, then click in the sky to place it.
export const PRESETS = byAltitude(config.cloudTypes || {})
