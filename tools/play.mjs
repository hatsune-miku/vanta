// Scripted playtest in headless Chromium; logic is stepped independently of render speed.
// Usage: node tools/play.mjs <query> <scenario.mjs>
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const [query = 'test', scenario = 'tools/bot.mjs'] = process.argv.slice(2)
mkdirSync('tools/out', { recursive: true })
const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' })
let browser
const errors = []
try {
  await server.listen()
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300))
  })
  await page.goto(`${server.resolvedUrls.local[0]}?${query}`)
  await page.waitForFunction(() => window.__vanta, null, { timeout: 120000 })
  const api = {
    page,
    step: (n = 1) => page.evaluate((n) => window.__vanta.step(n), n),
    hold: (a, v = true) => page.evaluate(([a, v]) => window.__vanta.hold(a, v), [a, v]),
    tap: (a, f = 2) => page.evaluate(([a, f]) => window.__vanta.tap(a, f), [a, f]),
    state: () => page.evaluate(() => window.__vanta.state()),
    eval: (fn, arg) => page.evaluate(fn, arg),
    shot: async (name) => {
      await page.waitForTimeout(250)
      await page.screenshot({ path: `tools/out/${name}.png`, timeout: 120000 })
      console.log('shot', name)
    },
  }
  const mod = await import(pathToFileURL(resolve(scenario)).href)
  await mod.default(api)
} catch (error) {
  console.error('FAILED', error)
  process.exitCode = 1
} finally {
  if (errors.length) {
    console.error('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n'))
    process.exitCode = 1
  }
  await browser?.close()
  await server.close()
}
