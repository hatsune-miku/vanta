import assert from 'node:assert/strict'

// Run with `?test&tutorial`: the opening stretch is walked from its left end, as on a first visit.
export default async (g) => {
  const results = await g.eval(async () => {
    const { LEAD_W } = await import('/src/config.ts')
    const b = window.__vanta.scene,
      p = b.player,
      t = b.tutorial,
      results = []
    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }
    function run(n) {
      for (let i = 0; i < n; i++) b.tick()
    }
    function walk(x) {
      b.ctl.virtual.right = true
      for (let i = 0; i < 1500 && p.x < x; i++) b.tick()
      b.ctl.virtual.right = false
      run(50)
    }
    function standing() {
      return b.enemies.filter((e) => !e.dead && !e.gone)
    }
    const posted = t.signs.map((sign) => sign.entries.map((e) => `${e.keys.join('+')}=${e.name}`).join(' '))
    check(
      'the hero starts at the left end of the opening stretch, with nothing closed around her',
      p.x === 260 && t.active && !b.locked && b.bounds.l === 0 && b.bounds.r > LEAD_W + 10000 && b.goHint
    )
    check(
      'five signs stand left to right ahead of the first lockdown and name the controls, the last pointing at the skills page',
      JSON.stringify(posted) ===
        JSON.stringify([
          'light=轻击 heavy=重击 exec=处决',
          'dash=闪避',
          'light+heavy=光幕',
          'overload=超载',
          'skills=技能详情',
        ]) &&
        t.signs.every((sign, i) => i === 0 || sign.x > t.signs[i - 1].x) &&
        t.signs[4].x < LEAD_W + 700,
      posted
    )
    run(1)
    check(
      'only the first sign has begun to unfold',
      t.signs[0].open > 0 && t.signs[0].open < 1 && t.signs.slice(1).every((sign) => sign.open === 0),
      t.signs.map((sign) => sign.open)
    )
    run(60)
    const first = standing()
    check(
      'it opens fully, with two passive small enemies standing beyond it',
      t.signs[0].open === 1 &&
        first.length === 2 &&
        first.every((e) => e.passive && ['grunt', 'gunner'].includes(e.kind) && e.x > t.signs[0].x),
      first.map((e) => [e.kind, e.x, e.passive])
    )
    const health = p.hp
    run(240)
    check('they never attack', p.hp === health && first.every((e) => !e.atk))
    b.draw(1, 0.016)
    const lettering = b.signText[0].map((entry) => [entry.keys.map((k) => k.text).join('+'), entry.name.text])
    check(
      'the sign is drawn in the scene with a keycap and a name for each control',
      JSON.stringify(lettering) ===
        JSON.stringify([
          ['J', '轻击'],
          ['I', '重击'],
          ['L', '处决'],
        ]) &&
        b.signText[0].every((entry) => entry.name.visible && entry.name.alpha > 0.8 && entry.name.scrollFactorX === 1),
      lettering
    )
    walk(1500)
    check(
      'walking on unfolds the dodge sign, where nothing at all is placed',
      t.signs[1].open === 1 && standing().length === 2 && t.signs[2].open === 0
    )
    const energy = p.energy
    walk(2300)
    check(
      'the light-curtain sign fills the energy bar and stands ten small enemies beyond it',
      t.signs[2].open === 1 && energy < p.maxEnergy && p.energy === p.maxEnergy && standing().length === 12,
      { energy: p.energy, standing: standing().length }
    )
    walk(3700)
    check(
      'the overload sign stands five more',
      t.signs[3].open === 1 && standing().length === 17 && standing().every((e) => e.passive),
      standing().length
    )
    // nothing along the stretch has to be done: one of them is cut down, the rest are simply walked past
    const cut = standing()[16]
    cut.takeHit({ dmg: 1e6, kx: 0, ky: 0, stun: 0, stop: 0, shake: 0 }, p, 1)
    run(2)
    const killed = b.kills
    walk(LEAD_W + 700 + 430)
    run(5)
    check(
      'the first lockdown closes as usual, takes away whoever was left and starts the record clean',
      b.locked && !t.active && b.enemies.every((e) => !e.passive) && killed === 1 && b.kills === 0 && b.execs === 0,
      { locked: b.locked, killed, kills: b.kills, left: b.enemies.filter((e) => e.passive).length }
    )
    check(
      'the signs stay standing',
      t.signs.every((sign) => sign.open === 1)
    )
    b.scene.restart({ arena: 0 })
    return results
  })
  await g.page.waitForFunction(() => window.__vanta.scene.frame < 5 && !window.__vanta.scene.restarting)
  await g.step(10)
  results.push(
    await g.eval(async () => {
      const { LEAD_W } = await import('/src/config.ts')
      const b = window.__vanta.scene
      return {
        name: 'a restart rejoins just outside the first lockdown: the signs are open and nobody is placed again',
        ok:
          !b.tutorial.active &&
          b.tutorial.signs.every((sign) => sign.open === 1) &&
          b.enemies.length === 0 &&
          Math.abs(b.player.x - (LEAD_W + 700 - 260)) < 5,
        detail: Math.round(b.player.x),
      }
    })
  )
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'opening stretch regression; see results above'
  )
}
