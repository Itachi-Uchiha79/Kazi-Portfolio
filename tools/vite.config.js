import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'

// Dev-only endpoint behind the settings window's Save button: writes the current scene of a page into
// that page's defaults file, so what you save is what every visitor gets. Only these three files can
// be written, and only while running `npm run dev`; the production build has no such endpoint.
const SCENE_FILES = {
  landing: 'src/landingConfig.json',
  sail: 'src/sceneConfig.json',
  night: 'src/nightConfig.json',
}

function sceneSaver() {
  return {
    name: 'scene-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__scene/save', async (req, res) => {
        const reply = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
        if (req.method !== 'POST') return reply(405, { error: 'POST only' })
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 2_000_000) return reply(413, { error: 'too large' })
        }
        try {
          const { page, scene } = JSON.parse(body)
          const file = SCENE_FILES[page]
          if (!file) return reply(400, { error: `unknown page "${page}"` })
          if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return reply(400, { error: 'scene must be an object' })
          await fs.writeFile(path.resolve(server.config.root, file), JSON.stringify(scene, null, 2) + '\n')
          reply(200, { file })
        } catch (e) {
          reply(500, { error: e.message })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), sceneSaver()],
  server: { port: 5173 },
})
