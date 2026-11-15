import assert from 'node:assert/strict'

export default async (g) => {
  const results = await g.eval(async () => {
    const { Grunt, Gunner, Heavy, Titan, Warden, Drone } = await import('/src/game/enemies.ts')
    const { MOVES } = await import('/src/game/player.ts')
    const { A } = await import('/src/art/anims.ts')
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
      const kneels = ['heavy', 'titan', 'warden'].includes(e.kind)
      e.update()
      check(
        `${e.kind}: dying opens with ${kneels ? 'a drop to one knee' : 'a reel'}`,
        e.an.anim === (kneels ? A.kneel : A.reel)
      )
      for (let i = 0; i < 600; i++) e.update()
      check(`${e.kind}: dying does not recover or time out`, e.dying && e.hp === 0 && !e.dead)
      check(
        `${e.kind}: ${kneels ? 'large frames stay down on one knee' : 'regular frames stay on their feet'}`,
        kneels ? e.an.anim === A.kneel && e.crouch === 1 && e.coreY > e.cy : e.an.anim === A.stun && e.crouch === 0,
        { crouch: e.crouch }
      )
      b.cam.x = 1400
      b.draw(1, 0)
      check(
        `${e.kind}: dying wears a lit mark on its body`,
        e.breakLight.length === 3 &&
          e.breakLight.every((im) => im.visible && im.alpha > 0.4) &&
          Math.abs(e.breakLight[0].y - e.coreY) < 1 &&
          e.marker.y < e.breakLight[0].y
      )
      check(`${e.kind}: zero damage cannot finish a dying target`, hit(e, 0) === 0 && e.dying)
      const guard = Math.max(80, e.maxHp)
      hit(e, guard - 1)
      check(`${e.kind}: stray hits do not finish a dying target`, e.dying && !e.dead && b.kills === kills)
      hit(e, 1)
      check(
        `${e.kind}: wearing its guard down bypasses execution`,
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
    // Slashes delivered through a dodge finish what they empty; anything short of that is an ordinary hit.
    for (const Type of [Grunt, Drone, Titan]) {
      let e = enemy(Type)
      const kills = b.kills
      b.attack(p, e.box, { ...MOVES.l1.hits[0].hit, dmg: e.hp, finish: true }, new Set())
      check(`${e.kind}: a lethal dodge slash defeats outright`, e.dead && !e.dying && b.kills === kills + 1)
      e = enemy(Type)
      b.attack(p, e.box, { ...MOVES.l1.hits[0].hit, dmg: e.hp - 1, finish: true }, new Set())
      check(`${e.kind}: a dodge slash that is not lethal is an ordinary hit`, !e.dead && !e.dying && e.hp === 1)
    }
    let dying = enemy()
    hit(dying, dying.hp)
    b.attack(p, dying.box, { ...MOVES.l1.hits[0].hit, dmg: 1, finish: true }, new Set())
    check('a dodge slash ends a dying target at once', dying.dead && !dying.dying)
    let boss = enemy(Warden)
    boss.lives = boss.maxLives = 3
    b.attack(p, boss.box, { ...MOVES.l1.hits[0].hit, dmg: boss.hp, finish: true }, new Set())
    check(
      'a lethal dodge slash floors a boss with lives left and takes one life',
      boss.lives === 2 && boss.state === 'reviving' && !boss.dying && !boss.dead
    )
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
    // the map itself no longer carries anchors: outside overload there is nothing to dodge to
    let found = 0
    for (const x of [330, 620, 3140, 3400, 6240, 6500, 9340, 9600]) {
      p.x = p.px = x - 200
      p.y = p.py = 560
      b.ctl.reset()
      if (b.findAnchor()) found++
    }
    check('the map has no traversal anchors', found === 0 && b.anchors === undefined, found)
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'enemy health and interaction regression'
  )
}
