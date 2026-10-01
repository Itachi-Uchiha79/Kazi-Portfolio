import sailConfig from './sceneConfig.json'
import landingConfig from './landingConfig.json'
import nightConfig from './nightConfig.json'

// Each page has its own scene: its own defaults file and its own save in the browser.
//   /             landing page    -> src/landingConfig.json + save "hei-portfolio:landing"
//   /sail/day     sunset sailing  -> src/sceneConfig.json   + save "hei-portfolio:scene"
//   /sail/night   night sailing   -> src/nightConfig.json   + save "hei-portfolio:night"
// The scene the page starts from = the defaults file + your saved scene (which wins wherever it has a value).
// New settings added to the code later still get their default from the file.
export const SAIL_PATH = '/sail/day'
export const NIGHT_PATH = '/sail/night'
const PAGES = {
  sail: { file: sailConfig, key: 'hei-portfolio:scene' },
  night: { file: nightConfig, key: 'hei-portfolio:night' },
  landing: { file: landingConfig, key: 'hei-portfolio:landing' },
}
const path = typeof location !== 'undefined' ? location.pathname : '/'
export const PAGE = path.startsWith(NIGHT_PATH) ? 'night' : path.startsWith(SAIL_PATH) ? 'sail' : 'landing'
const fileConfig = PAGES[PAGE].file
export const SAVE_KEY = PAGES[PAGE].key
const OLD_TYPES_KEY = 'hei-portfolio:cloud-types' // cloud types saved by earlier versions (sailing scene)

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}

function merge(base, over) {
  if (over === undefined || over === null) return base
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || typeof over !== 'object') return over
  const out = { ...base }
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k])
  return out
}

// A save is { v: 2, base, scene }: `base` is the defaults file it started from. Only what you changed
// (scene vs base) is applied on top of the current defaults, so when the defaults in the code are
// updated, every setting you never touched follows the update. Older saves (a bare scene) have no base
// and are applied whole, as before.
const stored = read(SAVE_KEY)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function changes(scene, base) {
  if (base === undefined) return scene
  if (Array.isArray(scene) || typeof scene !== 'object' || scene === null) return same(scene, base) ? undefined : scene
  const out = {}
  for (const k of Object.keys(scene)) {
    const d = changes(scene[k], base?.[k])
    if (d !== undefined) out[k] = d
  }
  return Object.keys(out).length ? out : undefined
}
// old-format saves (no base) can't tell what you changed; the night page was rebuilt, so ignore them there
const saved = stored?.v === 2 ? changes(stored.scene, stored.base) : PAGE === 'night' ? undefined : stored
let cfg = merge(fileConfig, saved)

// recover cloud types saved by earlier versions (plain object, or { base, types })
if (!stored && PAGE === 'sail') {
  const old = read(OLD_TYPES_KEY)
  const types = old && (old.types || (!old.base && old))
  if (types && typeof types === 'object' && Object.keys(types).length) cfg = { ...cfg, cloudTypes: types }
}

// named lists are taken whole from the save when you changed them (deleted entries stay deleted)
if (saved?.cloudTypes) cfg.cloudTypes = (stored?.v === 2 ? stored.scene : stored).cloudTypes
if (saved?.birdTypes) cfg.birdTypes = (stored?.v === 2 ? stored.scene : stored).birdTypes

export const hasSavedScene = !!stored
export const config = cfg
export { fileConfig }
