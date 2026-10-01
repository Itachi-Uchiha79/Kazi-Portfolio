import { useEffect, useRef, useState } from 'react'
import { Leva } from 'leva'
import { saveAsDefault, copyScene, resetScene } from './sceneExport.js'

// Floating, see-through settings window: drag it by its title bar, resize it from the corner,
// minimise it to the title bar. It sits on top of the scene without changing the page layout,
// and remembers where you left it.
const KEY = 'hei-portfolio:settings-window'
const DEFAULT = { x: 16, y: 16, w: 340, h: 560, min: false }

function load() {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return DEFAULT }
}

// leva's own backgrounds go transparent so the window's glass shows through
const levaTheme = {
  colors: {
    elevation1: 'transparent',
    elevation2: 'rgba(20, 23, 28, 0.35)',
    elevation3: 'rgba(60, 66, 78, 0.55)',
  },
}

export default function SettingsWindow() {
  const [win, setWin] = useState(load)
  const body = useRef()
  const drag = useRef(null)

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(win)) } catch { /* storage unavailable */ } }, [win])

  // keep the title bar reachable when the browser window shrinks
  useEffect(() => {
    const clamp = () => setWin((w) => ({
      ...w,
      x: Math.min(Math.max(w.x, 0), Math.max(innerWidth - 120, 0)),
      y: Math.min(Math.max(w.y, 0), Math.max(innerHeight - 36, 0)),
    }))
    clamp()
    addEventListener('resize', clamp)
    return () => removeEventListener('resize', clamp)
  }, [])

  // remember the size after resizing from the corner
  useEffect(() => {
    if (!body.current || win.min) return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.borderBoxSize?.[0]?.inlineSize ?? e.contentRect.width)
      const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height)
      setWin((s) => (s.w === w && s.h === h ? s : { ...s, w, h }))
    })
    ro.observe(body.current)
    return () => ro.disconnect()
  }, [win.min])

  const onDown = (e) => {
    if (e.target.closest('button')) return
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    if (!drag.current) return
    // compute now: the updater may run after the drag has ended
    const x = Math.min(Math.max(e.clientX - drag.current.dx, 0), innerWidth - 120)
    const y = Math.min(Math.max(e.clientY - drag.current.dy, 0), innerHeight - 36)
    setWin((w) => ({ ...w, x, y }))
  }
  const onUp = () => (drag.current = null)

  return (
    <div className="settings-window" style={{ left: win.x, top: win.y, width: win.w }}>
      <div className="settings-bar" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span>⠿ Settings</span>
        <span className="settings-actions">
          <button className="wide" onClick={() => saveAsDefault()} title="Make this the page's default (writes its config file); changes are also kept in this browser every 2 s">Save</button>
          <button className="wide" onClick={() => copyScene()} title="Copy every setting, the camera, every cloud and cloud type">Copy everything</button>
          <button className="wide" onClick={() => resetScene()} title="Go back to the defaults in the code">Reset</button>
          <button onClick={() => setWin((w) => ({ ...w, min: !w.min }))} title={win.min ? 'Show' : 'Minimise'}>
            {win.min ? '▢' : '–'}
          </button>
        </span>
      </div>
      <div ref={body} className="settings-body" hidden={win.min} style={{ height: win.h }}>
        <Leva fill flat titleBar={false} theme={levaTheme} />
      </div>
    </div>
  )
}
