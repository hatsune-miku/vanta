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
  const scripts = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })
  await page.goto(new URL('?arena=3', baseUrl).href)
  await page.waitForFunction(() => window.__game?.scene.isActive('Title'), null, { timeout: 120000 })
  await page.screenshot({ path: 'tools/out/title.png', timeout: 120000 })
  const title = await page.evaluate(() => ({
    texts: window.__game.scene
      .getScene('Title')
      .children.list.filter((o) => o.type === 'Text')
      .map((o) => ({ text: o.text, x: Math.round(o.x), font: o.style.fontFamily })),
    orbitron: document.fonts.check('900 64px Orbitron'),
  }))
  assert.deepEqual(
    title.texts.map((t) => t.text),
    ['VANTA', '任意键继续'],
    'the title shows the wordmark and one line, nothing else'
  )
  assert.ok(
    title.texts.every((t) => t.x === 960) && title.texts[0].font.startsWith('Orbitron') && title.orbitron,
    `the wordmark is centred and set in the display face: ${JSON.stringify(title)}`
  )
  // Opened directly, the game is not a KOOK session and never downloads the KOOK SDK.
  assert.equal(await page.evaluate(() => window.__kook.state), 'standalone')
  assert.ok(
    scripts.length > 0 && !scripts.some((url) => /kook/i.test(url)),
    `a page opened on its own loads no KOOK SDK: ${JSON.stringify(scripts)}`
  )
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game.scene.isActive('Battle'))
  const arena = await page.evaluate(() => window.__game.scene.getScene('Battle').arenaIdx)
  assert.equal(arena, 3, 'the title must preserve ?arena=3')
  // The key that left the title is a real press, so sound is allowed from here on.
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').sfx.state === 'running')
  const effects = await page.evaluate(() => window.__game.scene.getScene('Battle').sfx.whenReady())
  assert.equal(effects, 1, 'the one sound effect in use is served and decodes')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').sfx.musicTime > 0.2, null, {
    timeout: 120000,
  })
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('Battle').sfx.musicPlaying), true)
  await page.keyboard.press('KeyM')
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('Battle').sfx.muted), true, 'M mutes')
  await page.keyboard.press('KeyM')
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('Battle').sfx.muted), false, 'M unmutes')
  console.log(`production audio: ${effects} effects decoded, music playing, M toggles mute`)
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
      body: [b.player.rig.x, b.player.rig.y],
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
        body: [b.player.rig.x, b.player.rig.y],
        slowT: b.slowT,
        time: b.visualTime,
        overload: b.player.overloadT,
      })
    }),
    frozen,
    'pause must freeze presentation and slow-motion time'
  )
  await page.screenshot({ path: 'tools/out/pause.png', timeout: 120000 })
  // Escape opens the terminal: the game stands still behind it, and it is where stages, skills and credits are.
  const terminal = await page.evaluate(() => {
    const game = window.__game,
      b = game.scene.getScene('Battle'),
      texts = game.scene
        .getScene('Hud')
        .children.list.filter((o) => o.type === 'Text' && o.visible)
        .map((o) => o.text)
    return {
      tab: b.menu?.tab,
      row: b.menu?.row,
      texts,
      missing: [
        'bd_far',
        'bd_mid',
        'bd_column',
        'bd_floor',
        'bd_near',
        'bd_lights',
        'bd_far_yard',
        'bd_mid_yard',
      ].filter((key) => !game.textures.exists(key)),
    }
  })
  assert.equal(terminal.tab, 'stage', 'Escape opens the terminal on its stage screen')
  for (const text of ['VANTA', '作战终端', '废弃电厂', '外环货场', '技能', '资源署名'])
    assert.ok(terminal.texts.includes(text), `the terminal shows "${text}": ${JSON.stringify(terminal.texts)}`)
  assert.ok(
    !terminal.texts.some((t) => /PAUSE|暂 停|UNIT|GO/.test(t)),
    `no pause page and no stray HUD text: ${JSON.stringify(terminal.texts)}`
  )
  assert.deepEqual(terminal.missing, [], 'every layer of both backdrops is loaded')
  // P no longer does anything; W / S move the cursor; the credits row opens the attribution page
  await page.keyboard.press('KeyP')
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('Battle').paused), true, 'P is not bound')
  const rows = await page.evaluate(() => window.__game.scene.getScene('Battle').menu.rows)
  for (let i = terminal.row; i < rows - 1; i++) {
    await page.keyboard.press('KeyS')
    await page.waitForFunction((want) => window.__game.scene.getScene('Battle').menu.row === want, i + 1)
  }
  const creditPageOpened = page.context().waitForEvent('page')
  await page.keyboard.press('Enter')
  const credits = await creditPageOpened
  await credits.waitForLoadState('domcontentloaded')
  const creditText = await credits.locator('main').textContent()
  for (const name of ['Kai Sama', 'Quaternius', 'Kenney', 'Kevin MacLeod', 'Poly Haven', 'Orbitron'])
    assert.ok(creditText.includes(name), `the credits page names ${name}`)
  assert.equal(await credits.locator('a[href="https://creativecommons.org/licenses/by/4.0/"]').count(), 2)
  assert.equal(await credits.locator('a[href="./"]').count(), 0, 'the credits page has no link back into a second game')
  await credits.screenshot({ path: 'tools/out/credits.png', timeout: 120000 })
  await credits.close()
  await page.bringToFront()
  assert.equal(
    await page.evaluate(() => window.__game.scene.getScene('Battle').paused),
    true,
    'opening the credits leaves the terminal open'
  )
  // K turns to the skills page; W / S move through the skills
  await page.keyboard.press('KeyK')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').menu?.tab === 'skills')
  await page.keyboard.press('KeyS')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').menu.skill === 1)
  await page.screenshot({ path: 'tools/out/skills.png', timeout: 120000 })
  const skills = await page.evaluate(() => ({
    texts: window.__game.scene
      .getScene('Hud')
      .children.list.filter((o) => o.type === 'Text' && o.visible)
      .map((o) => o.text),
  }))
  for (const name of ['轻击', '重击', '处决', '闪避', '极限闪避', '光幕', '超载', '超载光幕', '闪避重击'])
    assert.ok(skills.texts.includes(name), `the skills page lists ${name}`)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').menu?.tab === 'stage')
  console.log('production terminal: stages, credits and the skills page')
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
      if (options.kind === 'surge') {
        window.__surge = projectile
        window.__surgeAt = performance.now()
      }
      return projectile
    }
    const verdict = b.spawnVerdict.bind(b)
    b.spawnVerdict = (hit) => {
      window.__verdict = { damage: hit.dmg, multiplier: hit.multiplier }
      return verdict(hit)
    }
    // how far the view swings overhead while the charge is held, sampled as it is drawn
    window.__top = 0
    // frames drawn while the charge was held: on a machine too slow to draw a handful, the swing cannot be seen
    window.__topFrames = 0
    const sample = () => {
      window.__top = Math.max(window.__top, b.topK)
      if (b.player.charging) window.__topFrames++
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.keyboard.down('KeyJ')
  await page.keyboard.down('KeyI')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.overCharging || window.__verdict)
  // A software-rendered frame can pass the full-charge deadline before this poll observes the midpoint.
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.chargeT >= 0.75 || window.__verdict)
  const automaticRelease = await page.evaluate(() => !!window.__verdict)
  await page.keyboard.up('KeyI')
  await page.waitForFunction(() => window.__verdict && !window.__game.scene.getScene('Battle').player.charging)
  await page.keyboard.up('KeyJ')
  const verdict = await page.evaluate(() => ({
    ...window.__verdict,
    overhead: window.__top,
    frames: window.__topFrames,
    active: window.__game.scene.getScene('Battle').player.overloaded,
    surge: !!window.__surge,
  }))
  assert.equal(verdict.damage, 25, 'each bite of the verdict is one first-stage heavy hit')
  assert.equal(verdict.multiplier, 1.2)
  assert.ok(
    verdict.overhead > 0.5 || verdict.frames < 5,
    `the view swings overhead while charging (${verdict.overhead} over ${verdict.frames} frames)`
  )
  assert.equal(verdict.active, false)
  assert.equal(verdict.surge, false, 'the overload charge no longer fires the crossing surge')
  console.log('production keyboard: J + I in overload swings overhead and drops the verdict', {
    ...verdict,
    automaticRelease,
  })
  // Outside overload the same hold is paid for in energy and fires the crossing surge.
  const released = await page.evaluate(() => {
    const b = window.__game.scene.getScene('Battle'),
      p = b.player
    p.overloadT = p.overloadCd = p.chargeCd = 0
    p.energy = 100
    p.state = 'free'
    p.move = null
    return b.frame
  })
  // A hold that outlived its release cannot start the next charge: the game has to see the buttons up first,
  // and a software-rendered frame is long enough for a key to go up and down again unseen.
  await page.waitForFunction((f) => window.__game.scene.getScene('Battle').frame > f + 1, released)
  await page.keyboard.down('KeyJ')
  await page.keyboard.down('KeyI')
  await page.waitForFunction(() => window.__game.scene.getScene('Battle').player.chargeCells > 0 || window.__surge)
  await page.keyboard.up('KeyI')
  await page.waitForFunction(() => window.__surge && !window.__game.scene.getScene('Battle').player.charging)
  await page.keyboard.up('KeyJ')
  const surge = await page.evaluate(() => {
    const p = window.__game.scene.getScene('Battle').player
    return {
      damage: window.__surge.hit.dmg * window.__surge.hit.multiplier,
      multiplier: window.__surge.hit.multiplier,
      energy: p.energy,
      cooldown: p.chargeCd,
      // on a machine this slow the five seconds can run out before the page is asked
      waited: (performance.now() - window.__surgeAt) / 1000,
    }
  })
  assert.ok(surge.damage >= 360 && surge.damage <= 720, JSON.stringify(surge))
  assert.equal(surge.multiplier, 1)
  assert.ok(
    surge.energy <= 80 && surge.energy >= 40 && (surge.cooldown > 0 || surge.waited > 4.5),
    JSON.stringify(surge)
  )
  console.log('production keyboard: J + I outside overload spends energy cells and fires the surge', surge)
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
  assert.deepEqual(
    await padPage.evaluate(() => {
      const b = window.__game.scene.getScene('Battle')
      return {
        placing: b.tutorial?.active,
        signs: b.tutorial?.signs.length,
        x: Math.round(b.player.x),
        locked: b.locked,
      }
    }),
    { placing: true, signs: 5, x: 260, locked: false },
    'a visit starts at the left end of the opening stretch, among its signs'
  )
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
    window.__pad.buttons[2].pressed = false
    window.__pad.buttons[9].pressed = false
  })
  // The opening stretch is scenery: its first sign has unfolded by now, with two passive enemies beyond it.
  await padPage.waitForFunction(() => {
    const b = window.__game.scene.getScene('Battle')
    return b.tutorial.signs[0].open === 1 && b.enemies.length === 2 && b.enemies.every((e) => e.passive)
  })
  console.log('simulated standard gamepad: the opening stretch posts the controls and asks for nothing')
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
    return !b.player.overloaded && b.player.overloadCd > 0 && !b.player.charging
  })
  console.log('simulated standard gamepad: X + Y charges in overload and releasing Y drops the verdict')
  await padPage.close()

  // An execution must switch the motion blur on.
  const execPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  execPage.setDefaultTimeout(60000)
  execPage.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)))
  execPage.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300))
  })
  await execPage.goto(baseUrl)
  await execPage.waitForFunction(() => window.__game?.scene.isActive('Title'), null, { timeout: 120000 })
  await execPage.keyboard.press('Space')
  await execPage.waitForFunction(() => window.__game.scene.getScene('Battle')?.frame > 3)
  await execPage.evaluate(() => {
    const b = window.__game.scene.getScene('Battle'),
      p = b.player,
      target = b.spawnTraining('grunt', p.x + 320, true)
    target.state = 'idle'
    target.invuln = 0
    b.attack(p, target.box, { dmg: target.hp, kx: 0, ky: 0, stun: 10, stop: 0, shake: 0 }, new Set())
    // sample the blur filter as it is drawn, for as long as the cinematic runs
    window.__blur = { light: 0, heavy: 0, frames: 0 }
    const sample = () => {
      const c = b.cine
      if (c) {
        const slowed = c.impact.at >= 0,
          s = b.motion.strength
        window.__blur.frames++
        if (slowed) window.__blur.heavy = Math.max(window.__blur.heavy, s)
        else window.__blur.light = Math.max(window.__blur.light, s)
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await execPage.waitForFunction(() => window.__game.scene.getScene('Battle').executionTarget)
  await execPage.keyboard.press('KeyL')
  await execPage.waitForFunction(() => window.__game.scene.getScene('Battle').cine)
  // software rendering draws each blurred frame slowly; a GPU finishes this in about a second
  await execPage.waitForFunction(() => !window.__game.scene.getScene('Battle').cine, null, { timeout: 900000 })
  const blur = await execPage.evaluate(() => ({
    ...window.__blur,
    after: window.__game.scene.getScene('Battle').motion.strength,
  }))
  assert.ok(blur.heavy > 0.15, `the heavy motion blur is drawn during the slow motion (${JSON.stringify(blur)})`)
  assert.ok(blur.light > 0.02 && blur.light < blur.heavy, `a lighter blur comes first (${JSON.stringify(blur)})`)
  console.log('production execution: light then heavy motion blur drawn', blur)
  // the page above is done with: left open it would go on rendering and starve the next one
  await execPage.close()

  // Embedded by a page that is not KOOK: the SDK is fetched and finds no host; the game must play regardless.
  const hostPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  hostPage.setDefaultTimeout(60000)
  hostPage.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)))
  hostPage.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300))
  })
  const framedScripts = []
  hostPage.on('request', (request) => {
    if (request.resourceType() === 'script') framedScripts.push(request.url())
  })
  await hostPage.setContent(
    `<body style="margin:0;background:#000"><iframe src="${baseUrl}" allow="autoplay; fullscreen" style="border:0;width:1280px;height:720px"></iframe></body>`
  )
  const gameFrame = hostPage.frames().find((f) => f !== hostPage.mainFrame())
  assert.ok(gameFrame, 'the game is running in a frame')
  await gameFrame.waitForFunction(() => window.__game?.scene.isActive('Title'), null, { timeout: 180000 })
  assert.ok(
    framedScripts.some((url) => /kook-minigame-sdk/.test(url)),
    'inside a frame the KOOK SDK is loaded on demand'
  )
  await gameFrame.waitForFunction(() => window.__kook.state !== 'connecting', null, { timeout: 60000 })
  const session = await gameFrame.evaluate(() => ({ state: window.__kook.state, reason: window.__kook.reason }))
  assert.equal(session.state, 'unavailable', `no KOOK host answered: ${JSON.stringify(session)}`)
  await gameFrame.locator('canvas').click({ position: { x: 640, y: 360 } })
  await gameFrame.waitForFunction(() => window.__game.scene.isActive('Battle'), null, { timeout: 300000 })
  await gameFrame.waitForFunction(() => window.__game.scene.getScene('Battle').frame > 3, null, { timeout: 180000 })
  await hostPage.keyboard.press('Escape')
  await gameFrame.waitForFunction(() => window.__game.scene.getScene('Battle').menu?.tab === 'stage')
  const framedRows = await gameFrame.evaluate(() => window.__game.scene.getScene('Battle').menu.extras)
  assert.deepEqual(
    framedRows,
    ['skills', 'sound', 'credits'],
    'framed by something other than KOOK there is no fullscreen or exit row to offer'
  )
  console.log(`framed without KOOK: the game plays on its own (${session.reason})`)
  await hostPage.close()
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
