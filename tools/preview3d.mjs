import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

mkdirSync('tools/out', { recursive: true })
const server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' })
let browser
const errors = []
try {
  await server.listen()
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300))
  })
  await page.goto(`${server.resolvedUrls.local[0]}tools/preview3d/index.html`)
  await page.waitForFunction(() => window.__done, null, { timeout: 120000 })
  const missing = await page.evaluate(() => window.__done.missing)
  assert.deepEqual(missing, [], 'preview animations must be present in the packed models')
  await page.screenshot({ path: 'tools/out/preview3d.png', fullPage: true, timeout: 120000 })
  await page.screenshot({ path: 'tools/out/elle.png', clip: { x: 0, y: 0, width: 320, height: 400 }, timeout: 120000 })
  console.log('saved tools/out/preview3d.png and tools/out/elle.png')
} catch (error) {
  console.error('FAILED', error)
  process.exitCode = 1
} finally {
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
  await browser?.close()
  await server.close()
}
