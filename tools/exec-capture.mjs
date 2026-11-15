import assert from 'node:assert/strict'

// Stage a lethal light combo through the normal damage path, then capture the full execution.
export default async (g) => {
  await g.eval(async () => {
    const { Gunner } = await import('/src/game/enemies.ts')
    const { MOVES } = await import('/src/game/player.ts')
    const b = window.__vanta.scene,
      p = b.player
    for (const e of b.enemies) if (!e.gone) e.destroy()
    b.enemies = []
    b.direct = () => {}
    b.locked = true
    b.bounds = { l: 800, r: 2850 }
    b.plats = []
    b.banner = null
    p.x = p.px = 1500
    p.y = p.py = 900
    p.facing = 1
    const target = new Gunner(b, 1830)
    target.state = 'idle'
    target.invuln = 0
    target.rig.setAlpha(1)
    b.enemies = [target]
    // Stop at empty health: one more damaging hit would finish a dying target without an execution.
    for (let i = 0; i < 12 && !target.dying; i++) b.attack(p, target.box, MOVES.l1.hits[0].hit, new Set())
    b.cam.x = 1775
    b.cam.y = 478
    b.cam.zoom = 0.88
  })
  let s = await g.state()
  const dying = s.enemies.find((e) => e.dying)
  assert.ok(dying && dying.hp === 0, 'the lethal combo must produce a living, executable enemy')
  const execsBefore = s.execs
  console.log('dying:', JSON.stringify(dying), 'player', JSON.stringify(s.player), 'combo', s.combo)
  await g.shot('c1_dying')
  const dir = dying.x > s.player.x ? 'right' : 'left'
  await g.hold(dir)
  await g.step(2)
  await g.hold(dir, false)
  await g.tap('exec', 2)
  // Entering the dying state includes hitstop: wait for the buffered input to start the actual cinematic.
  s = await g.state()
  for (let i = 0; i < 30 && !s.cine; i++) {
    await g.step(1)
    s = await g.state()
  }
  assert.equal(s.cine, true, 'execution must start before capturing its beats')
  function ct() {
    return g.eval(() => {
      const b = window.__vanta.scene,
        c = b.cine
      // the cinematic's request for this frame; the filter itself is updated on the next draw
      return c ? { t: c.t, boom: c.boom, rate: c.rate, slowed: c.impact.at >= 0, blur: b.blurShot.strength } : null
    })
  }
  let waveSeen = false
  for (let i = 0; i < 120; i++) {
    await g.step(1)
    const count = await g.eval(() => window.__vanta.scene.fx.ripFronts().length)
    if (count) {
      const c = await ct()
      assert.ok(c && c.t < c.boom, 'the ripple must start on the opening beat, before detonation')
      assert.equal(count, 1, 'one water ring per execution')
      waveSeen = true
      break
    }
  }
  assert.ok(waveSeen, 'the opening beat must emit the water ripple')
  await g.shot('c_strike')
  // Follow the rest frame by frame: the light blur must come before any slow motion, the heavy one with it.
  const before = [],
    during = []
  let n = 0,
    peakShot = false
  for (; n < 600; n++) {
    await g.step(1)
    const c = await ct()
    if (!c) break
    ;(c.slowed ? during : before).push(c)
    if (n === 4) await g.shot('c_ripple1')
    if (c.slowed && !peakShot) {
      peakShot = true
      await g.shot('c_detonate')
    }
    if (during.length === 14) await g.shot('c_ripple2')
  }
  assert.ok(n < 600 && peakShot, 'execution must reach detonation and return control')
  const light = Math.max(...before.map((c) => c.blur)),
    heavy = Math.max(...during.map((c) => c.blur))
  assert.ok(
    before.every((c) => c.rate === 1),
    'the strike and the opening of the bloom play at full speed'
  )
  assert.ok(light > 0.02 && light < 0.1, `a light motion blur precedes the slow motion (${light})`)
  assert.ok(during[0].rate < 0.5 && during[0].blur > light * 2, 'the heavy motion blur starts with the slow motion')
  assert.ok(heavy > light * 3, `the second blur is clearly heavier (${light} -> ${heavy})`)
  assert.ok(during.filter((c) => c.rate < 0.5).length >= 30, 'the slow motion lasts long enough to read the bloom')
  s = await g.state()
  assert.equal(s.cine, false, 'execution must return control')
  assert.equal(s.execs, execsBefore + 1)
  const after = await g.eval(() => {
    const b = window.__vanta.scene
    b.draw(1, 0)
    return { blur: b.motion.strength, texts: b.fx.texts.map((x) => x.t.text) }
  })
  assert.equal(after.blur, 0, 'motion blur is switched off once control returns')
  assert.ok(
    after.texts.every((text) => text.startsWith('+')),
    `no damage numbers are shown (${after.texts})`
  )
  console.log(JSON.stringify(await g.state()))
}
