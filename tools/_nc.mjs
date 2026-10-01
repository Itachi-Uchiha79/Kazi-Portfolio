import puppeteer from 'puppeteer-core'
const S = process.argv[2], tag = process.argv[3]
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage(); await p.setViewport({ width: +(process.env.W || 1273), height: +(process.env.H || 535) })
p.on('pageerror', (e) => console.log('pageerror', e.message))
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('err', m.text().split('\n').filter(l=>/ERROR/.test(l)).slice(0,3).join('|')) })
await p.goto('http://localhost:5173/sail/night?shot&t=10'); await new Promise((r) => setTimeout(r, 8000))
await p.screenshot({ path: `${S}/nc_${tag}.png` }); await b.close()
