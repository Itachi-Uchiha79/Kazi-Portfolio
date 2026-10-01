import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { levaStore } from 'leva'
import * as sceneIO from './sceneExport.js'
import './styles.css'

// always open at the top of the page (don't restore the old scroll position on reload)
history.scrollRestoration = 'manual'
scrollTo(0, 0)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// dev only: lets scripts/tests change settings like the panel does, e.g.
// __leva.setValueAtPath('Raft shape.mastHeight', 1.5, true)
import { uniforms as sceneUniforms } from './scene/palette.js'
if (import.meta.env.DEV) { window.__leva = levaStore; window.__scene = sceneIO; window.__uniforms = sceneUniforms }
