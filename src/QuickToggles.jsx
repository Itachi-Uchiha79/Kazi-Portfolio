import { useEffect, useState } from 'react'
import { levaStore } from 'leva'
import { PAGE, SAIL_PATH, NIGHT_PATH } from './activeConfig.js'
import { features } from './settingsLayout.js'

// On-screen toolbar: one click to show / hide the main parts of the scene, and links between the pages.
// The buttons drive the same settings as the settings window (so they stay in sync and are saved).
const TOGGLES = [
  { label: 'Clouds', path: 'Clouds.Look.showClouds' },
  { label: 'Raft', path: 'Raft.Look & motion.showRaft' },
  { label: 'Sun', path: 'Sky.Sun.showSun', when: () => features.sun },
  { label: 'Moon', path: 'Sky.Moon.showSun', when: () => features.moon },
  { label: 'Birds', path: 'Birds.Look.birdsVisible', when: () => features.birds },
]
const PAGES = [
  { key: 'landing', label: '⌂ Front', href: '/' },
  { key: 'sail', label: '☀ Sail in day', href: SAIL_PATH },
  { key: 'night', label: '☾ Sail in night', href: NIGHT_PATH },
]

const PAGES_KEY = 'hei-portfolio:page-buttons'

const read = (path) => { try { return levaStore.get(path) } catch { return undefined } }

export default function QuickToggles() {
  const toggles = TOGGLES.filter((t) => !t.when || t.when())
  const [state, setState] = useState({})

  // follow the settings (the settings window can change them too)
  useEffect(() => {
    const sync = () => setState(Object.fromEntries(toggles.map((t) => [t.path, read(t.path)])))
    sync()
    return levaStore.useStore.subscribe(sync)
  }, [])

  const flip = (path) => levaStore.setValueAtPath(path, !read(path), true)

  const [showPages, setShowPages] = useState(() => {
    try { return localStorage.getItem(PAGES_KEY) !== 'hidden' } catch { return true }
  })
  const togglePages = () => setShowPages((v) => {
    try { localStorage.setItem(PAGES_KEY, v ? 'hidden' : 'shown') } catch { /* ignore */ }
    return !v
  })

  return (
    <>
      {/* page switcher: big, top right; the ☰ button shows / hides it (remembered in this browser) */}
      <nav className="page-switch" aria-label="Pages">
        {showPages && PAGES.map((p) => (
          <a key={p.key} href={p.href} className={`ps-${p.key}${p.key === PAGE ? ' current' : ''}`} aria-current={p.key === PAGE ? 'page' : undefined}>
            {p.label}
          </a>
        ))}
        <button className="ps-toggle" onClick={togglePages} aria-expanded={showPages} title={showPages ? 'Hide the page buttons' : 'Show the page buttons'}>
          {showPages ? '✕' : '☰ Pages'}
        </button>
      </nav>
      {/* show / hide scene parts, bottom centre */}
      <nav className="quick-toggles" aria-label="Scene controls">
        <div className="qt-group">
          {toggles.map((t) => (
            <button key={t.path} className={state[t.path] === false ? 'off' : 'on'} aria-pressed={state[t.path] !== false} onClick={() => flip(t.path)}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  )
}
