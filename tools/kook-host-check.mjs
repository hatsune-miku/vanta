// The production build inside a stand-in KOOK host that speaks the real bridge protocol to the real SDK: the
// handshake, the load report and the sign-in as they happen in KOOK — and what happens when the page framing the
// game is not a host the build was told to trust. No network: every request is answered from local files.
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { build } from 'vite'

const HOST = 'https://kook-host.test',
  STRANGER = 'https://kook-stranger.test',
  GAME = 'https://vanta-game.test'
const out = resolve('tools/out/kook-game')
// the game, built to trust the stand-in host beside the real one
process.env.VITE_KOOK_HOST_ORIGINS = HOST
await build({ logLevel: 'error', build: { outDir: out, emptyOutDir: true, copyPublicDir: false } })
const bundled = await build({
  configFile: false,
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    minify: false,
    lib: { entry: resolve('tools/kook-host/host.ts'), formats: ['es'], fileName: 'host' },
  },
})
const hostJs = (Array.isArray(bundled) ? bundled[0] : bundled).output[0].code
const hostHtml = `<!doctype html><meta charset="utf-8"><title>stand-in KOOK host</title>
<body style="margin:0;background:#101a19"><iframe id="game" allow="autoplay; fullscreen" style="border:0;width:1280px;height:720px"></iframe>
<script>window.__GAME_ORIGIN__ = ${JSON.stringify(GAME)}</script><script type="module" src="/host.js"></script></body>`

const errors = []
let browser
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === HOST || url.origin === STRANGER) {
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: hostHtml })
      if (url.pathname === '/host.js') return route.fulfill({ contentType: 'text/javascript', body: hostJs })
    } else if (url.origin === GAME) {
      const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
      for (const root of [out, resolve('public')]) {
        const file = join(root, path)
        if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) return route.fulfill({ path: file })
      }
    } else return route.abort()
    return route.fulfill({ status: 404, body: '' })
  })
  async function open(host) {
    const page = await context.newPage()
    page.setDefaultTimeout(180000)
    page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 300))
    })
    await page.goto(host + '/')
    await page.waitForFunction(() => window.sdkFixture)
    let game
    for (let i = 0; i < 300 && !game; i++) {
      game = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(GAME))
      if (!game) await page.waitForTimeout(100)
    }
    assert.ok(game, 'the game is running in a frame of the host page')
    return { page, game }
  }
  const fixture = (page) =>
    page.evaluate(() => ({
      calls: [...window.sdkFixture.calls],
      asked: window.sdkFixture.sessionInputs,
      prompting: window.sdkFixture.prompting(),
    }))
  const session = (game) =>
    game.evaluate(() => ({
      state: window.__kook.state,
      reason: window.__kook.reason,
      auth: window.__kook.auth,
      line: window.__kook.statusLine,
      title: window.__game.scene.isActive('Title'),
    }))

  // ---- a host the build trusts: connect, report the load, then ask for the player's authorisation
  {
    const { page, game } = await open(HOST)
    await page.waitForFunction(() => window.sdkFixture.prompting())
    const host = await fixture(page),
      inside = await session(game)
    assert.deepEqual(
      host.calls,
      ['ready', 'lifecycle.reportLoadResult', 'session.get'],
      'ready(), then the load result, then the authorisation request'
    )
    assert.equal(host.asked.length, 1)
    assert.deepEqual(host.asked[0].scopes, ['get_user_info'])
    assert.match(host.asked[0].state, /^[0-9a-f]{32}$/)
    assert.ok(!('redirectUri' in host.asked[0]), 'the host default callback is used')
    assert.deepEqual(
      inside,
      { state: 'ready', reason: '', auth: 'asking', line: 'KOOK · 已连接 · 等待授权', title: true },
      'the consent prompt is up over the title screen'
    )
    await page.evaluate(() => window.sdkFixture.answer('authorized'))
    await game.waitForFunction(() => window.__kook.auth === 'authorized')
    await game.locator('canvas').click({ position: { x: 640, y: 360 } })
    await game.waitForFunction(() => window.__game.scene.getScene('Battle')?.frame > 3)
    await page.keyboard.press('Escape')
    await game.waitForFunction(() => window.__game.scene.getScene('Battle').menu?.tab === 'stage')
    assert.deepEqual(
      await game.evaluate(() => window.__game.scene.getScene('Battle').menu.extras),
      ['skills', 'sound', 'fullscreen', 'credits', 'leave'],
      'the terminal offers what this host can do, and no sign-in row once the authorisation is held'
    )
    assert.equal((await session(game)).line, 'KOOK · 已连接 · 已授权')
    assert.equal(
      (await fixture(page)).calls.filter((method) => method === 'session.get').length,
      1,
      'the authorisation is asked for once'
    )
    console.log('trusted KOOK host: ready, load reported, authorisation asked once and granted; the game plays')
    await page.close()
  }

  // ---- framed by a page the build was not told to trust: the SDK never answers it, and the game says why
  {
    const { page, game } = await open(STRANGER)
    await game.waitForFunction(() => window.__kook.state === 'unavailable')
    const host = await fixture(page),
      inside = await session(game)
    assert.deepEqual(host.calls, [], 'a host that is not trusted is never answered')
    assert.equal(inside.reason, 'BOOTSTRAP_TIMEOUT')
    assert.equal(inside.line, 'KOOK · 未连接（宿主 kook-stranger.test 未受信任）')
    await game.waitForFunction(() => window.__game.scene.isActive('Title'))
    await game.locator('canvas').click({ position: { x: 640, y: 360 } })
    await game.waitForFunction(() => window.__game.scene.getScene('Battle')?.frame > 3)
    assert.equal((await fixture(page)).calls.length, 0)
    console.log(`untrusted host: ${inside.line}; nothing is reported or asked, and the game still plays`)
    await page.close()
  }
} catch (error) {
  console.error('FAILED', error)
  process.exitCode = 1
} finally {
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
  await browser?.close()
}
