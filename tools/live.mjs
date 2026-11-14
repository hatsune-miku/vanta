// Real keyboard events against the production build, including the debug arena entry.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { preview } from 'vite'

mkdirSync('tools/out', { recursive: true })
const server = process.env.VANTA_URL
  ? null
  : await preview({ preview: { port: 4199, strictPort: false }, logLevel: 'error' })
const baseUrl = process.env.VANTA_URL || server.resolvedUrls.local[0]
let browser
const errors = []
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.setDefaultTimeout(60000)
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300))
  })
  await page.goto(new URL('?arena=3', baseUrl).href)
  await page.waitForFunction(() => window.__game?.scene.isActive('Title'), null, { timeout: 120000 })
  await page.screenshot({ path: 'tools/out/title.png', timeout: 120000 })
  const creditPosition = await page.evaluate(() => {
    const game = window.__game
    const label = game.scene.getScene('Title').children.list.find((o) => o.text?.includes('资源署名'))
    const rect = game.canvas.getBoundingClientRect()
    return {
      x: rect.x + ((label.x + label.width / 2) * rect.width) / 1920,
      y: rect.y + ((label.y + label.height / 2) * rect.height) / 1080,
    }
  })
  const creditPageOpened = page.context().waitForEvent('page')
  await page.mouse.click(creditPosition.x, creditPosition.y)
  const credits = await creditPageOpened
  await credits.waitForLoadState('domcontentloaded')
  assert.ok((await credits.locator('main').textContent()).includes('Kai Sama'))
  assert.equal(await credits.locator('a[href="https://creativecommons.org/licenses/by/4.0/"]').count(), 1)
  assert.equal(
    await page.evaluate(() => window.__game.scene.getScene('Title').gone),
    false,
    'opening credits must consume the global pointer press instead of starting a battle'
  )
  await credits.screenshot({ path: 'tools/out/credits.png', timeout: 120000 })
  await credits.close()
  await page.bringToFront()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game.scene.isActive('Battle'))
  const arena = await page.evaluate(() => window.__game.scene.getScene('Battle').arenaIdx)
  assert.equal(arena, 3, 'the title must preserve ?arena=3')
  const startX = await page.evaluate(() => window.__game.scene.getScene('Battle').player.x)
  await page.keyboard.down('KeyD')
  await page.waitForFunction((x) => window.__game.scene.getScene('Battle').player.x > x + 250, startX)
  await page.keyboard.up('KeyD')
  await page.keyboard.press('KeyU')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.overloaded)
  const overloadBefore = await page.evaluate(() => ({
    remaining: window.__game.scene.getScene('Battle').player.overloadT,
    time: window.__game.loop.time,
  }))
  await page.keyboard.press('KeyU')
  await page.waitForFunction((time) => window.__game.loop.time > time, overloadBefore.time)
  const overloadAfter = await page.evaluate(() => ({
    remaining: window.__game.scene.getScene('Battle').player.overloadT,
    time: window.__game.loop.time,
    multiplier: window.__game.scene.getScene('Battle').player.damageMultiplier,
  }))
  assert.equal(overloadAfter.multiplier, 1.2)
  assert.ok(overloadAfter.remaining < overloadBefore.remaining, 'an active overload cannot be refreshed')
  assert.ok(
    Math.abs(overloadBefore.remaining - overloadAfter.remaining - (overloadAfter.time - overloadBefore.time) / 1000) <
      1e-6,
    `overload follows elapsed play time at low frame rates: ${JSON.stringify({ overloadBefore, overloadAfter })}`
  )
  await page.keyboard.down('KeyJ')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.state === 'attack')
  await page.keyboard.up('KeyJ')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').paused)
  const frame = await page.evaluate(() => window.__game.scene.getScene('Battle').frame)
  const frozen = await page.evaluate(() => {
    const b = window.__game.scene.getScene('Battle')
    b.slowmo(0.5, 90)
    return JSON.stringify({
      cam: b.cam,
      tail: b.player.tail.pts,
      slowT: b.slowT,
      time: b.visualTime,
      overload: b.player.overloadT,
    })
  })
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('Battle').frame), frame, 'pause must stop logic')
  assert.equal(
    await page.evaluate(() => {
      const b = window.__game.scene.getScene('Battle')
      return JSON.stringify({
        cam: b.cam,
        tail: b.player.tail.pts,
        slowT: b.slowT,
        time: b.visualTime,
        overload: b.player.overloadT,
      })
    }),
    frozen,
    'pause must freeze presentation and slow-motion time'
  )
  await page.screenshot({ path: 'tools/out/pause.png', timeout: 120000 })
  await page.keyboard.press('Escape')
  await page.waitForFunction((f) => {
    const b = window.__game.scene.getScene('Battle')
    return !b.paused && b.frame > f
  }, frame)
  console.log('production: credits, arena=3, movement, attack, overload, pause and resume passed')
  await page.evaluate(() => {
    const b = window.__game.scene.getScene('Battle'),
      p = b.player
    b.direct = () => {}
    for (const e of b.enemies) e.update = () => {}
    b.stop = b.slowT = 0
    p.invuln = 10000
    p.state = 'free'
    p.overloadT = 15
    const spawn = b.spawnProj.bind(b)
    b.spawnProj = (options) => {
      const projectile = spawn(options)
      if (options.kind === 'surge') window.__surge = projectile
      return projectile
    }
  })
  await page.keyboard.down('KeyJ')
  await page.keyboard.down('KeyI')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.charging || window.__surge)
  // A software-rendered frame can pass the full-charge deadline before this poll observes the midpoint.
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.chargeT >= 0.75 || window.__surge)
  const automaticRelease = await page.evaluate(() => !!window.__surge)
  await page.keyboard.up('KeyI')
  await page.waitForFunction(() => window.__surge && !window.__game.scene.getScene('Battle').player.charging)
  await page.keyboard.up('KeyJ')
  const surge = await page.evaluate(() => ({
    damage: window.__surge.hit.dmg * window.__surge.hit.multiplier,
    multiplier: window.__surge.hit.multiplier,
    active: window.__game.scene.getScene('Battle').player.overloaded,
  }))
  assert.ok(surge.damage >= 648 && surge.damage <= 864)
  assert.equal(surge.multiplier, 1.2)
  assert.equal(surge.active, false)
  console.log('production keyboard: J + I charges and fires the boosted surge', { ...surge, automaticRelease })
  await page.close()

  const padPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  padPage.setDefaultTimeout(60000)
  padPage.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)))
  padPage.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300))
  })
  await padPage.addInitScript(() => {
    const pad = {
      id: 'VANTA regression controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 1,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    }
    window.__pad = pad
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] })
  })
  await padPage.goto(baseUrl)
  await padPage.waitForFunction(() => window.__game?.scene.isActive('Title'), null, { timeout: 120000 })
  await padPage.evaluate(() => {
    window.__pad.buttons[9].pressed = true
  })
  await padPage.waitForFunction(() => window.__game.scene.isActive('Battle'))
  await padPage.waitForFunction(() => window.__game.scene.getScene('Battle').frame > 3)
  await padPage.evaluate(() => {
    window.__pad.buttons[10].pressed = true
  })
  await padPage.waitForFunction(() => window.__game.scene.getScene('Battle').player.overloaded)
  await padPage.evaluate(() => {
    window.__pad.buttons[10].pressed = false
  })
  assert.equal(
    await padPage.evaluate(() => window.__game.scene.getScene('Battle').paused),
    false,
    'Start must not also pause on scene entry'
  )
  await padPage.evaluate(() => {
    window.__pad.buttons[9].pressed = false
    window.__pad.axes[0] = 1
  })
  await padPage.waitForFunction(() => window.__game.scene.getScene('Battle').player.x > 400)
  await padPage.evaluate(() => {
    window.__pad.axes[0] = 0
    window.__pad.buttons[0].pressed = true
  })
  await padPage.waitForFunction(() => window.__game.scene.getScene('Battle').player.y < 850)
  await padPage.evaluate(() => {
    window.__pad.buttons[0].pressed = false
    window.__pad.buttons[9].pressed = true
  })
  await padPage.waitForFunction(() => window.__game.scene.getScene('Battle').paused)
  await padPage.evaluate(() => {
    window.__pad.buttons[9].pressed = false
    window.__pad.buttons[2].pressed = true
  })
  await padPage.waitForFunction(() => !window.__game.scene.getScene('Battle').ctl.down.pause)
  await padPage.evaluate(() => {
    window.__pad.buttons[9].pressed = true
  })
  await padPage.waitForFunction(() => !window.__game.scene.getScene('Battle').paused)
  assert.equal(
    await padPage.evaluate(() => window.__game.scene.getScene('Battle').player.state),
    'free',
    'paused gamepad attacks must be discarded'
  )
  console.log('simulated standard gamepad: title, movement, jump, pause and resume passed')
  await padPage.evaluate(() => {
    const b = window.__game.scene.getScene('Battle'),
      p = b.player
    b.direct = () => {}
    for (const e of b.enemies) e.update = () => {}
    p.invuln = 10000
    p.overloadT = 15
    window.__pad.buttons[9].pressed = false
    window.__pad.buttons[2].pressed = true
    window.__pad.buttons[3].pressed = true
  })
  await padPage.waitForFunction(() => window.__game.scene.getScene('Battle').player.charging)
  await padPage.evaluate(() => {
    window.__pad.buttons[3].pressed = false
  })
  await padPage.waitForFunction(() => {
    const b = window.__game.scene.getScene('Battle')
    return !b.player.overloaded && b.projs.some((p) => p.kind === 'surge')
  })
  console.log('simulated standard gamepad: X + Y charges and releasing Y fires the surge')
} catch (error) {
  console.error('FAILED', error)
  process.exitCode = 1
} finally {
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
  await browser?.close()
  if (server)
    await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())))
}
