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
    for (let i = 0; i < 6; i++) b.attack(p, target.box, MOVES.l1.hits[0].hit, new Set())
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
      const c = window.__vanta.scene.cine
      return c ? { t: c.t, boom: c.boom } : null
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
  await g.step(10)
  await g.shot('c_ripple1')
  await g.step(12)
  await g.shot('c_ripple2')
  let n = 0
  for (; n < 400; n++) {
    const c = await ct()
    if (!c || c.t > c.boom + 1) break
    await g.step(1)
  }
  assert.ok(n < 400, 'execution must reach detonation')
  await g.shot('c_detonate')
  for (let i = 0; i < 200 && (await g.state()).cine; i++) await g.step(1)
  s = await g.state()
  assert.equal(s.cine, false, 'execution must return control')
  assert.equal(s.execs, execsBefore + 1)
  console.log(JSON.stringify(await g.state()))
}
