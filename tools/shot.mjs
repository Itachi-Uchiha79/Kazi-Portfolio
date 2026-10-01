// Headless screenshot of the running dev server (npm run dev) at the reference framing.
// Usage: npm run shot -- out.png [extra query, e.g. "t=12"]
import puppeteer from 'puppeteer-core'
const out = process.argv[2] || 'shot.png'
const query = process.argv[3] || ''
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type() + ':', m.text()) })
await page.setViewport({ width: 2560, height: 1066 })
await page.goto(`http://localhost:5173${process.env.PAGE ?? '/sail/day'}?shot&${query}`)
await new Promise((r) => setTimeout(r, +(process.env.WAIT || 6000)))
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
