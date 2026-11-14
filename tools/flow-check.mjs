import assert from 'node:assert/strict'

export default async (g) => {
  const results = await g.eval(() => {
    const v = window.__vanta
    const b = v.scene
    const ctl = b.ctl
    const results = []

    function key(type, code) {
      window.dispatchEvent(new KeyboardEvent(type, { code }))
    }

    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }

    key('keydown', 'KeyA')
    key('keydown', 'ArrowLeft')
    ctl.poll()
    key('keyup', 'KeyA')
    ctl.poll()
    check('releasing one alias preserves the held movement key', ctl.axis === -1, ctl.axis)
    key('keyup', 'ArrowLeft')
    ctl.poll()
    ctl.clear()

    key('keydown', 'KeyJ')
    ctl.poll()
    ctl.take('light')
    key('keyup', 'KeyJ')
    key('keydown', 'KeyJ')
    ctl.poll()
    check('a release and repress between ticks is a new attack', ctl.take('light'))
    key('keyup', 'KeyJ')
    ctl.poll()
    ctl.clear()

    key('keydown', 'KeyI')
    key('keyup', 'KeyI')
    window.dispatchEvent(new Event('blur'))
    ctl.poll()
    check('focus loss drops pending attacks', !ctl.peek('heavy') && !ctl.anyPressed)
    window.dispatchEvent(new Event('focus'))
    ctl.clear()

    // The simulation and presentation must both stay still while the HUD can update.
    b.cam.x += 100
    v.tap('pause')
    const before = JSON.stringify({ cam: b.cam, tail: b.player.tail.pts, frame: b.frame })
    b.update(0, 16)
    b.update(16, 16)
    const after = JSON.stringify({ cam: b.cam, tail: b.player.tail.pts, frame: b.frame })
    check('pause freezes camera and cloth as well as logic', before === after)
    v.tap('light')
    v.tap('pause')
    check('attacks pressed during pause are discarded', b.player.state === 'free', b.player.state)

    b.hitstop(6)
    v.tap('light')
    v.step(5)
    check('hitstop still buffers attacks', b.player.state === 'attack', b.player.state)

    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'input and pause regressions; see results above'
  )

  // Exercise Phaser's real shutdown/create lifecycle, including input used to retry.
  for (const outcome of ['dead', 'win']) {
    const oldId = await g.eval((outcome) => {
      const b = window.__vanta.scene
      b.arenaIdx = 2
      b.over = outcome
      b.overT = 80
      b.player.overloadT = 12
      b.player.overloadCd = 3
      const hud = b.scene.get('Hud')
      hud.hpLag = 0.2
      hud.veil.setAlpha(0.8)
      window.__vanta.tap('overload')
      return b.player.id
    }, outcome)
    await g.page.waitForFunction((id) => window.__vanta.scene.player.id !== id, oldId)
    await g.step(3)
    const state = await g.state()
    assert.equal(state.arena, outcome === 'win' ? 0 : 2)
    assert.equal(state.player.state, 'free', 'the retry key must not activate a move in the new run')
    assert.equal(state.player.energy, 40)
    assert.ok(
      await g.eval(() => {
        const p = window.__vanta.scene.player
        return p.overloadT === 0 && p.overloadCd === 0
      }),
      'overload state must reset with a new run'
    )
    assert.equal(state.over, '')
    const hud = await g.eval(() => {
      const hud = window.__vanta.scene.scene.get('Hud')
      return { hpLag: hud.hpLag, veil: hud.veil.alpha }
    })
    assert.equal(hud.hpLag, 1)
    assert.equal(hud.veil, 0, 'the previous result overlay must not carry into the new run')
    console.log(`${outcome}: restart returns to arena ${state.arena} with neutral input`)
  }
}
