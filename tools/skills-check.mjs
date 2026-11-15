import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ids = ['light', 'heavy', 'exec', 'dash', 'extreme', 'curtain', 'overload', 'verdict', 'plunge', 'lunge']
const server = process.env.VANTA_URL
  ? null
  : await createServer({ server: { port: 5212, strictPort: false }, logLevel: 'error' })
let browser
await mkdir('tools/out', { recursive: true })
try {
  await server?.listen()
  browser = await chromium.launch({
    args: [
      `--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`,
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.setDefaultTimeout(30000)
  const errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('request', (request) => {
    if (request.url().includes('/media/skills/')) requests.push(request.url())
  })
  await page.goto(process.env.VANTA_URL || server.resolvedUrls.local[0])
  await page.waitForFunction(() => window.__game?.scene.isActive('Title'), null, { timeout: 120000 })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game.scene.isActive('Battle'))
  const start = await page.evaluate(() => window.__game.scene.getScene('Battle').player.x)
  await page.keyboard.down('KeyD')
  await page.waitForFunction((x) => window.__game.scene.getScene('Battle').player.x > x + 80, start)
  await page.keyboard.up('KeyD')
  await page.keyboard.press('KeyJ')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.state === 'attack')
  assert.equal(requests.length, 0, 'clips are not loaded during ordinary play')
  await page.keyboard.press('KeyK')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').menu?.tab === 'skills')
  const frozenFrame = await page.evaluate(() => window.__game.scene.getScene('Battle').frame)
  for (const [i, id] of ids.entries()) {
    if (i) await page.keyboard.press('KeyS')
    await page.waitForFunction(
      ({ i, id }) => {
        const g = window.__game,
          b = g.scene.getScene('Battle'),
          preview = g.scene.getScene('Hud').skillPreview
        return b.menu?.skill === i && preview.id === id && preview.ready && preview.video?.video?.currentTime > 0.08
      },
      { i, id },
      { timeout: 30000 }
    )
    const state = await page.evaluate(() => {
      const g = window.__game,
        hud = g.scene.getScene('Hud'),
        preview = hud.skillPreview,
        video = preview.video.video
      return {
        src: video.currentSrc,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        loop: video.loop,
        muted: video.muted,
        count: hud.children.list.filter((o) => o.type === 'Video').length,
        frame: g.scene.getScene('Battle').frame,
        overflow: hud.menuTexts
          .filter((t) => t.visible && t.x >= 850 && t.y > 230 && t.y < 930)
          .filter((t) => {
            const r = t.getBounds()
            return r.right > 1773 || r.bottom > 932
          })
          .map((t) => t.text),
      }
    })
    assert.ok(state.src.endsWith(`/media/skills/${id}.mp4`), id)
    assert.equal(state.width, 1024)
    assert.equal(state.height, 576)
    assert.ok(state.duration >= 3 && state.loop && state.muted, id)
    assert.equal(state.count, 1, 'only the selected skill keeps a decoder')
    assert.equal(state.frame, frozenFrame, 'video playback does not advance the paused fight')
    assert.deepEqual(state.overflow, [], 'skill details fit below the recording')
    // a software-rendered machine can take minutes over one capture
    if (['heavy', 'verdict', 'plunge'].includes(id))
      await page.screenshot({ path: `tools/out/skills-${id}.png`, timeout: 300000 })
    console.log('decoded and displayed', id, state.duration)
  }
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game.scene.getScene('Hud').skillPreview.video.video.paused)
  const stoppedAt = await page.evaluate(() => window.__game.scene.getScene('Hud').skillPreview.video.video.currentTime)
  await page.waitForTimeout(250)
  assert.ok(
    Math.abs(
      (await page.evaluate(() => window.__game.scene.getScene('Hud').skillPreview.video.video.currentTime)) - stoppedAt
    ) < 0.05
  )
  await page.keyboard.press('Space')
  await page.waitForFunction(
    (t) => window.__game.scene.getScene('Hud').skillPreview.video.video.currentTime > t + 0.08,
    stoppedAt
  )
  console.log('keyboard pause/resume passed')
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('KeyS')
    await page.waitForFunction((selected) => window.__game.scene.getScene('Battle').menu.skill === selected, i)
  }
  await page.waitForFunction(
    () =>
      window.__game.scene.getScene('Hud').skillPreview.id === 'curtain' &&
      window.__game.scene.getScene('Hud').skillPreview.ready
  )
  console.log('quick selection passed')
  await page.evaluate(() => {
    window.__oldSkillVideo = window.__game.scene.getScene('Hud').skillPreview.video.video
  })
  await page.keyboard.press('KeyK')
  await page.waitForFunction(
    () => !window.__game.scene.getScene('Battle').menu && !window.__game.scene.getScene('Hud').skillPreview.video
  )
  assert.deepEqual(
    await page.evaluate(() => ({
      paused: window.__oldSkillVideo.paused,
      src: window.__oldSkillVideo.getAttribute('src'),
    })),
    { paused: true, src: null }
  )
  await page.waitForFunction((frame) => window.__game.scene.getScene('Battle').frame > frame, frozenFrame)
  console.log('closing releases media and resumes combat')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').menu?.tab === 'stage')
  await page.keyboard.press('KeyK')
  await page.waitForFunction(() => window.__game.scene.getScene('Hud').skillPreview.ready)
  await page.keyboard.press('Escape')
  await page.waitForFunction(
    () =>
      window.__game.scene.getScene('Battle').menu?.tab === 'stage' &&
      window.__game.scene.getScene('Hud').skillPreview.video === null
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !window.__game.scene.getScene('Battle').paused)
  console.log('stage navigation passed')
  await page.route('**/media/skills/light.mp4', (route) => route.fulfill({ status: 404, body: '' }))
  await page.keyboard.press('KeyK')
  await page.waitForFunction(() => window.__game.scene.getScene('Hud').skillPreview.failed)
  await page.waitForFunction(() => window.__game.scene.getScene('Hud').skillPreview.poster.visible)
  await page.keyboard.press('KeyK')
  await page.waitForFunction(() => !window.__game.scene.getScene('Battle').paused)
  await page.unroute('**/media/skills/light.mp4')
  console.log('failed-video fallback passed')
  await page.evaluate(() => {
    const pad = {
      id: 'Preview test controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    }
    window.__previewPad = pad
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    pad.buttons[8].pressed = true
  })
  await page.waitForFunction(
    () =>
      window.__game.scene.getScene('Battle').menu?.tab === 'skills' &&
      window.__game.scene.getScene('Hud').skillPreview.ready
  )
  await page.evaluate(() => {
    window.__previewPad.buttons[8].pressed = false
    window.__previewPad.buttons[0].pressed = true
  })
  await page.waitForFunction(
    () =>
      window.__game.scene.getScene('Battle').menu.previewPaused &&
      window.__game.scene.getScene('Hud').skillPreview.video.video.paused
  )
  await page.evaluate(() => {
    window.__previewPad.buttons[0].pressed = false
  })
  await page.waitForFunction(() => !window.__game.scene.getScene('Battle').ctl.down.jump)
  await page.evaluate(() => {
    window.__previewPad.buttons[0].pressed = true
  })
  await page.waitForFunction(
    () =>
      !window.__game.scene.getScene('Battle').menu.previewPaused &&
      !window.__game.scene.getScene('Hud').skillPreview.video.video.paused
  )
  await page.evaluate(() => {
    window.__previewPad.buttons[0].pressed = false
    window.__previewPad.buttons[8].pressed = true
  })
  await page.waitForFunction(() => !window.__game.scene.getScene('Battle').paused)
  assert.deepEqual(errors, [])
  console.log('pause/resume, quick selection, close/reopen, stage navigation, failed-video fallback and gamepad passed')
} finally {
  await browser?.close()
  await server?.close()
}
