import assert from 'node:assert/strict'

export default async (g) => {
  const results = await g.eval(async () => {
    const { Grunt, Gunner, Heavy, Titan, Warden, Drone } = await import('/src/game/enemies.ts')
    const { MOVES } = await import('/src/game/player.ts')
    const b = window.__vanta.scene,
      p = b.player,
      results = []
    b.direct = () => {}
    b.bounds = { l: 0, r: 4000 }
    b.plats = []
    p.x = p.px = 1000
    p.y = p.py = 900
    p.overloadT = 0
    b.cam.x = 1400
    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }
    function enemy(Type = Grunt) {
      for (const e of b.enemies) if (!e.gone) e.destroy()
      b.enemies = []
      b.cine = null
      p.cine = false
      b.stop = 0
      b.fx.update(5)
      const e = new Type(b, 1450)
      e.state = 'idle'
      e.lives = e.maxLives = 1
      e.onGround = !e.flying
      e.invuln = 0
      e.rig.setAlpha(1)
      b.enemies = [e]
      return e
    }
    function hit(e, damage, seen = new Set()) {
      return b.attack(p, e.box, { ...MOVES.l1.hits[0].hit, dmg: damage }, seen)
    }
    for (const Type of [Grunt, Gunner, Heavy, Titan, Warden, Drone]) {
      let e = enemy(Type)
      const kills = b.kills
      const seen = new Set()
      const health = e.hp
      hit(e, health, seen)
      check(
        `${e.kind}: empty health enters a living, executable state`,
        e.hp === 0 && e.dying && !e.dead && b.executionTarget === e && b.kills === kills
      )
      check(`${e.kind}: the same hit cannot also finish the dying target`, hit(e, 1, seen) === 0 && e.dying)
      for (let i = 0; i < 600; i++) e.update()
      check(`${e.kind}: dying does not recover or time out`, e.dying && e.hp === 0 && !e.dead)
      check(`${e.kind}: zero damage cannot finish a dying target`, hit(e, 0) === 0 && e.dying)
      hit(e, 1)
      check(
        `${e.kind}: another damaging hit bypasses execution`,
        e.dead && !e.dying && b.kills === kills + 1 && !b.executionTarget
      )
      hit(e, 100)
      check(`${e.kind}: defeat counts once`, b.kills === kills + 1)

      e = enemy(Type)
      hit(e, e.maxHp * 2 - 0.001)
      check(`${e.kind}: just below the overkill threshold still enters dying`, e.dying && !e.dead)
      e = enemy(Type)
      hit(e, e.maxHp * 2)
      check(`${e.kind}: exactly twice maximum health defeats immediately`, e.dead && !e.dying)
      e = enemy(Type)
      e.hp = 10
      hit(e, 12)
      check(`${e.kind}: low HP does not lower the overkill threshold`, e.dying && !e.dead)
      e = enemy(Type)
      hit(e, e.hp)
      e.executed(1)
      check(`${e.kind}: execution finishes a dying enemy`, e.dead && e.hp === 0)
    }
    let e = enemy()
    for (let i = 0; i < 6; i++) hit(e, 8)
    check(
      'positive low health remains active without a separate break gauge',
      e.hp === 22 && !e.dying && !e.dead && !b.executionTarget && !('posture' in e)
    )
    e = enemy()
    p.overloadT = 15
    hit(e, (e.maxHp * 2) / 1.2)
    check('overkill uses final damage including overload', e.dead && e.hp === 0)
    p.overloadT = 0

    e = enemy()
    hit(e, 70)
    b.stop = 0
    b.cam.x = 1400
    b.draw(1, 0)
    check(
      'execution keycap is attached below the target marker',
      e.execKey?.visible && e.execKey.x === e.marker.x && e.execKey.y > e.marker.y && e.bar.length === 2
    )
    p.overloadT = 15
    b.anchor = b.findAnchor()
    b.draw(1, 0)
    check(
      'anchor keycap follows the selected enemy and stays separate from execution',
      e.anchorKey?.visible &&
        e.anchorKey.x === e.anchorMarker.x &&
        e.anchorKey.y > e.anchorMarker.y &&
        e.anchorKey.x - e.execKey.x >= 70
    )
    p.cine = true
    b.draw(1, 0)
    check('interaction keys disappear during the cinematic', !e.execKey.visible && !e.anchorKey.visible)
    p.cine = false
    p.overloadT = 0
    e.destroy()
    b.enemies = []
    const anchor = b.anchors[0]
    p.x = p.px = anchor.x - 200
    p.y = p.py = anchor.y
    b.cam.x = anchor.x
    b.ctl.reset()
    b.anchor = b.findAnchor()
    b.draw(1, 0)
    check(
      'traversal anchor has its own keycap below the object',
      b.anchor === anchor && anchor.key.visible && anchor.key.x === anchor.x && anchor.key.y > anchor.im.y
    )
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'enemy health and interaction regression'
  )
}
