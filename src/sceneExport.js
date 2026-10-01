import { levaStore } from 'leva'
import { config, SAVE_KEY, fileConfig, PAGE } from './activeConfig.js'
import { DEFAULTS, settings } from './scene/palette.js'
import { SECTION } from './settingsLayout.js'

// Live parts of the scene that aren't panel settings (registered by the components that own them).
export const live = {
  clouds: () => config.cloudLayout,     // Clouds.jsx: current cloud list (positions drift with the wind)
  cloudTypes: () => config.cloudTypes,  // Clouds.jsx: current cloud types
  birds: () => config.birdLayout,       // Birds.jsx: current flocks (they fly across the sky)
  birdTypes: () => config.birdTypes,    // Birds.jsx: current bird types
}

const r4 = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r4(v)]))
const get = (path, fallback) => {
  try { const v = levaStore.get(`${SECTION.scene}.${path}`); return v === undefined ? fallback : v } catch { return fallback }
}

// Everything in the scene, in the same format as the page's config file (src/*Config.json).
export function exportScene() {
  const out = { about: config.about }
  for (const [group, vals] of Object.entries(DEFAULTS)) {
    out[group] = Object.fromEntries(Object.keys(vals).map((k) => [k, r4(settings[k])]))
  }
  out.camera = {
    fov: r4(get('Camera.fov', config.camera.fov)),
    height: r4(get('Camera.height', config.camera.height)),
    horizon: r4(get('Camera.horizon', config.camera.horizon)),
    tilt: r4(get('Camera.tilt', config.camera.tilt ?? 0)),
    freeLook: get('Camera.freeLook', config.camera.freeLook),
    frameAspect: get('Camera.frameAspect', config.camera.frameAspect),
  }
  out.reference = {
    compareMode: get('Reference.compareMode', config.reference.compareMode),
    compare: r4(get('Reference.compare', config.reference.compare)),
    image: get('Reference.image', config.reference.image),
  }
  out.page = { screens: r4(get('Page.screens', config.page.screens)) }
  out.cloudTypes = Object.fromEntries(Object.entries(live.cloudTypes() || {}).map(([name, t]) => [name, round(t)]))
  // clouds are saved at their home place: flowing toward / away from the camera never changes the layout
  out.cloudLayout = (live.clouds() || []).map((c) => round({
    id: c.id, type: c.type, az: c.homeAz ?? c.az, el: c.homeEl ?? c.el, w: c.w, h: c.h,
    seed: c.seed, dark: c.dark, lit: c.lit, layer: c.layer,
  }))
  out.birdTypes = Object.fromEntries(Object.entries(live.birdTypes() || {}).map(([name, t]) => [name, round(t)]))
  out.birdLayout = (live.birds() || []).map((b) => round({
    id: b.id, count: b.count, formation: b.formation, spread: b.spread, size: b.size, speed: b.speed, dir: b.dir,
    az: b.az, el: b.el, seed: b.seed,
  }))
  return out
}

// ---- save in this browser (the page starts from the saved scene next time)
let lastSaved = null
let ready = false            // don't save before the scene has loaded (would save defaults over your work)
export function markReady() { ready = true }

export function saveScene({ quiet = false } = {}) {
  if (!ready) return false
  try {
    // saved with the defaults it started from, so later default updates still reach untouched settings
    const text = JSON.stringify({ v: 2, base: fileConfig, scene: exportScene() })
    if (text !== lastSaved) { localStorage.setItem(SAVE_KEY, text); lastSaved = text }
    if (!quiet) notice('Saved. The page will open with this scene.')
    return true
  } catch (e) {
    if (!quiet) notice('Could not save in this browser: ' + e.message)
    return false
  }
}

// auto-save every 2 s and when the page is closed or reloaded (a dev-server reload can't lose work).
// Each page saves under its own key (see activeConfig.js), so pages never overwrite each other.
if (typeof window !== 'undefined' && !new URLSearchParams(location.search).has('shot')) {
  setInterval(() => saveScene({ quiet: true }), 2000)
  addEventListener('pagehide', () => saveScene({ quiet: true }))
  addEventListener('beforeunload', () => saveScene({ quiet: true }))
}

// Save button: make the current scene this page's default. In development it writes the page's
// config file (via the dev server, see vite.config.js); the browser copy is then cleared because the
// file now holds everything. Without the dev server it keeps the browser save only.
const PAGE_FILES = { landing: 'src/landingConfig.json', sail: 'src/sceneConfig.json', night: 'src/nightConfig.json' }
export async function saveAsDefault() {
  if (!import.meta.env.DEV) return saveScene()
  try {
    const res = await fetch('/__scene/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: PAGE, scene: exportScene() }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
    ready = false                                      // the file is the truth now; don't re-save the old copy
    try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
    const msg = `Saved as this page's default (${PAGE_FILES[PAGE]}).`
    try { sessionStorage.setItem('hei-portfolio:notice', msg) } catch { /* ignore */ }   // the dev server reloads the page
    notice(msg)
    return true
  } catch (e) {
    saveScene({ quiet: true })
    notice('Could not write the defaults file (' + e.message + '). Kept a browser copy instead.')
    return false
  }
}

// show a message left for us before a reload (e.g. "Saved as this page's default")
if (typeof window !== 'undefined') {
  try {
    const msg = sessionStorage.getItem('hei-portfolio:notice')
    if (msg) { sessionStorage.removeItem('hei-portfolio:notice'); addEventListener('load', () => notice(msg)) }
  } catch { /* ignore */ }
}

export function resetScene() {
  if (!window.confirm('Reset to the defaults in the code? Your saved scene in this browser will be removed (copy it first if you want to keep it).')) return
  ready = false                                      // stop auto-save from writing it back
  try {
    localStorage.removeItem(SAVE_KEY)
    if (SAVE_KEY === 'hei-portfolio:scene') localStorage.removeItem('hei-portfolio:cloud-types')   // old format, don't resurrect it
  } catch { /* ignore */ }
  location.reload()
}

// ---- "copy everything": clipboard, with a fallback box if the browser blocks clipboard access
export function copyScene() {
  const text = JSON.stringify(exportScene(), null, 2)
  console.log('scene:\n' + text)
  saveScene({ quiet: true })
  const done = () => notice('Copied everything: settings, camera, every cloud, bird flock and their types.')
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => showBox(text))
  else showBox(text)
}

function notice(msg) {
  const el = document.createElement('div')
  el.textContent = msg
  Object.assign(el.style, {
    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 100,
    padding: '8px 14px', borderRadius: '8px', background: '#000c', color: '#fff', font: '13px system-ui, sans-serif',
  })
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2500)
}

function showBox(text) {
  const wrap = document.createElement('div')
  Object.assign(wrap.style, { position: 'fixed', inset: '0', zIndex: 100, background: '#0009', display: 'grid', placeItems: 'center' })
  wrap.innerHTML = `<div style="background:#181c20;padding:12px;border-radius:10px;width:min(640px,90vw);font:13px system-ui;color:#fff">
    <div style="margin-bottom:8px">Your browser blocked the clipboard. Select all (⌘A / Ctrl+A) and copy (⌘C / Ctrl+C):</div>
    <textarea readonly style="width:100%;height:50vh;font:12px monospace"></textarea>
    <button style="margin-top:8px;padding:6px 12px">Close</button></div>`
  const ta = wrap.querySelector('textarea')
  ta.value = text
  wrap.querySelector('button').onclick = () => wrap.remove()
  document.body.appendChild(wrap)
  ta.focus(); ta.select()
}
