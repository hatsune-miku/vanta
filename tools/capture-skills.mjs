import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Captures the production render loop at deterministic 60 Hz, exporting a 30 fps H.264 clip per skill.
// GPU acceleration makes this practical on macOS; VANTA_CAPTURE_ANGLE=swiftshader is the portable fallback.
const ids = process.argv.slice(2)
const server = await createServer({ server: { port: 5211, strictPort: false }, logLevel: 'error' })
const output = 'public/media/skills'
await mkdir(output, { recursive: true })
await mkdir('tools/out/skill-demos', { recursive: true })
let browser
try {
  await server.listen()
  const angle = process.env.VANTA_CAPTURE_ANGLE || (process.platform === 'darwin' ? 'metal' : 'swiftshader')
  browser = await chromium.launch({
    args: [`--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const all = ['light', 'heavy', 'exec', 'dash', 'extreme', 'curtain', 'overload', 'verdict', 'plunge', 'lunge']
  const reports = []
  for (const id of ids.length ? ids : all) {
    assert.ok(all.includes(id), `unknown skill ${id}`)
    await page.goto(server.resolvedUrls.local[0] + '?capture')
    await page.waitForFunction(() => window.__game?.scene.isActive('Title'), null, { timeout: 120000 })
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__game.scene.isActive('Battle'))
    const seconds = await page.evaluate(async (id) => {
      window.__game.loop.sleep()
      const { installDemo } = await import('/tools/skill-demos.ts')
      window.__demo = installDemo(id)
      window.__captureTime = performance.now()
      window.__captureCanvas = document.createElement('canvas')
      window.__captureCanvas.width = 1024
      window.__captureCanvas.height = 576
      return window.__demo.seconds
    }, id)
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'image2pipe',
        '-framerate',
        '30',
        '-vcodec',
        'mjpeg',
        '-i',
        '-',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        `${output}/${id}.mp4`,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] }
    )
    let encoderErrors = ''
    ffmpeg.stderr.on('data', (chunk) => {
      encoderErrors += chunk
    })
    const encoded = once(ffmpeg, 'close')
    const started = Date.now()
    for (let frame = 0; frame < seconds * 30; frame++) {
      const data = await page.evaluate(() => {
        const game = window.__game
        for (let i = 0; i < 2; i++) {
          window.__demo.next()
          game.loop.rawDelta = 1000 / 60
          game.step((window.__captureTime += 1000 / 60), 1000 / 60)
          window.__demo.observe()
        }
        const canvas = window.__captureCanvas
        canvas.getContext('2d').drawImage(game.canvas, 0, 0, 1024, 576)
        return canvas.toDataURL('image/jpeg', 0.93).split(',')[1]
      })
      const bytes = Buffer.from(data, 'base64')
      if (!ffmpeg.stdin.write(bytes)) await once(ffmpeg.stdin, 'drain')
      if (frame === 18) await writeFile(`${output}/${id}.jpg`, bytes)
      if (frame % 30 === 0) await writeFile(`tools/out/skill-demos/${id}-${frame / 30}.jpg`, bytes)
    }
    ffmpeg.stdin.end()
    const [code] = await encoded
    assert.equal(code, 0, encoderErrors)
    const report = await page.evaluate(() => window.__demo.report())
    const required = {
      light: ['l1', 'l2', 'l3', 'l4', 'l5', 'al1', 'al2', 'al3'],
      heavy: ['h1', 'h2', 'h3', 'gearLand'],
      lunge: ['h1', 'h2'],
    }[id]
    for (const move of required ?? []) assert.ok(report.moves.includes(move), `${id}: ${move} was not demonstrated`)
    if (id === 'exec') assert.ok(report.execs > 0, 'the execution must complete')
    if (id === 'dash') assert.ok(report.dashes >= 4, 'show ground and repeated aerial dodges')
    if (id === 'extreme') assert.ok(report.counter, 'the timed dodge must trigger its counter')
    if (id === 'curtain') assert.ok(report.surge, 'the normal light curtain must fire')
    if (id === 'overload') assert.ok(report.overload && report.anchor, 'show overload and an enemy anchor strike')
    if (id === 'verdict') assert.ok(report.verdict, 'show the overload curtain')
    if (id === 'plunge') assert.equal(report.dives.length, 2, 'show both plunge variants')
    if (id === 'lunge') assert.ok(report.states.includes('lunge'), 'the held heavy input must lunge')
    reports.push(report)
    await writeFile(`tools/out/skill-demos/${id}.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ...report, recordingSeconds: (Date.now() - started) / 1000 }))
    assert.equal(errors.length, 0, errors.join('\n'))
  }
  const complete = await Promise.all(
    all.map(async (id) => {
      try {
        return JSON.parse(await readFile(`tools/out/skill-demos/${id}.json`, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    })
  )
  if (complete.every(Boolean))
    await writeFile(
      `${output}/manifest.json`,
      JSON.stringify({ fps: 30, width: 1024, height: 576, audio: false, skills: complete }, null, 2)
    )
} finally {
  await browser?.close()
  await server.close()
}
