import assert from 'node:assert/strict'

export default async (g) => {
  const results = await g.eval(async () => {
    const { Grunt, Gunner, Heavy, Titan, Warden, Drone } = await import('/src/game/enemies.ts')
    const { MOVES, Player } = await import('/src/game/player.ts')
    const { COL } = await import('/src/config.ts')
    const { Stage3D } = await import('/src/three/stage3d.ts')
    const b = window.__vanta.scene,
      p = b.player,
      ctl = b.ctl,
      results = []
    b.direct = () => {}
    b.bounds = { l: 0, r: 5000 }
    b.plats = []
    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }
    function close(a, z) {
      return Math.abs(a - z) < 1e-6
    }
    function key(code) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code }))
      window.dispatchEvent(new KeyboardEvent('keyup', { code }))
      b.tick()
    }
    function reset(active = false) {
      for (const e of b.enemies) e.destroy()
      for (const q of b.projs) q.im.destroy()
      b.enemies = []
      b.projs = []
      b.cine = null
      b.over = ''
      b.paused = false
      b.stop = b.shakeAmp = b.punch = 0
      b.threat = b.anchor = null
      b.fx.update(5)
      Stage3D.I.update(5)
      ctl.reset()
      Object.assign(p, {
        x: 1000,
        px: 1000,
        y: 900,
        py: 900,
        vx: 0,
        vy: 0,
        facing: 1,
        hp: 100,
        energy: 0,
        dead: false,
        state: 'free',
        st: 0,
        move: null,
        cine: false,
        hidden: false,
        flying: false,
        onGround: true,
        invuln: 0,
        dashCd: 0,
        airDashed: false,
        jumps: 0,
        jumping: false,
        coyote: 6,
        chargeCd: 0,
        chargeCells: 0,
        chargeLatch: false,
        counterPending: null,
        overloadT: active ? 15 : 0,
        overloadCd: 0,
      })
    }
    function enemy(Type = Grunt, x = 1400, durable = true) {
      const e = new Type(b, x)
      e.state = 'idle'
      e.invuln = 0
      e.rig.setAlpha(1)
      e.update = () => {}
      if (durable) {
        e.hp = e.maxHp = 10000
      }
      b.enemies.push(e)
      return e
    }

    reset()
    p.energy = 80
    for (const code of ['Digit7', 'Numpad7', 'KeyQ']) key(code)
    check('the old 7 and Q bindings no longer activate an ability', !p.overloaded && !p.move && !b.projs.length)
    key('KeyU')
    check(
      'U activates overload without spending energy on the removed skill',
      p.energy === 80 && !p.move && !b.projs.length
    )
    check('U activates fifteen seconds of overload', p.overloaded && p.overloadT === 15 && p.overloadCd === 0)
    b.stop = 10000
    const before = p.overloadT
    check('repeated activation cannot refresh overload', !p.activateOverload() && p.overloadT === before)
    key('Escape')
    window.__vanta.step(600)
    check('pause freezes the overload timer', p.overloadT === before)
    key('Escape')
    b.slowmo(0.2, 120)
    window.__vanta.step(899)
    check('hitstop and slow motion do not extend the active duration', p.overloaded && close(p.overloadT, 1 / 60))
    window.__vanta.step(1)
    check('expiry starts five seconds of cooldown', !p.overloaded && close(p.overloadCd, 5))
    key('KeyU')
    check('cooldown rejects activation', !p.overloaded)
    window.__vanta.step(299)
    check('cooldown ends after five seconds', p.overloadCd === 0)
    key('KeyU')
    check('U can reactivate after cooldown', p.overloadT === 15)

    reset()
    const near = b.spawnProj({ kind: 'bolt', x: p.cx + 500, y: p.cy, team: 1, vx: 0 }),
      rearBullet = b.spawnProj({ kind: 'bolt', x: p.cx - 500, y: p.cy, team: 1, vx: 0 }),
      edge = b.spawnProj({ kind: 'bolt', x: p.cx + 1800, y: p.cy, team: 1, vx: 0 }),
      outside = b.spawnProj({ kind: 'bolt', x: p.cx + 2300, y: p.cy, team: 1, vx: 0 }),
      friendly = b.spawnProj({ kind: 'bolt', x: p.cx + 500, y: p.cy, team: 0, vx: 0 })
    p.activateOverload()
    b.fx.update(0.05)
    b.sweepProjs()
    const front = b.fx.ripFronts()[0]
    check(
      'overload sends a visible ripple out from the player center',
      front?.x === p.cx && front.y === p.cy && b.fx.ripFilter.active
    )
    check('bullets ahead of the wave survive until it reaches them', !near.dead && !edge.dead)
    b.fx.update(0.2)
    b.sweepProjs()
    check(
      'overload sweeps bullets in both directions without hitting friendly waves',
      near.dead && rearBullet.dead && !edge.dead && !friendly.dead
    )
    b.fx.update(0.4)
    b.sweepProjs()
    check('the sweep has the ordinary ripple range', edge.dead && !outside.dead && b.fx.ripFilter.active)
    b.fx.update(0.1)
    check('the ripple expires normally', b.fx.ripFronts().length === 0 && !b.fx.ripFilter.active)

    reset(true)
    let e = enemy()
    let hp = e.hp
    b.attack(p, e.box, MOVES.h1.hits[0].hit, new Set())
    check('melee damage is multiplied once by 1.2', close(hp - e.hp, 30), hp - e.hp)
    hp = e.hp
    b.attack(p, e.box, MOVES.l1.hits[0].hit, new Set())
    check('light damage receives only the final multiplier', close(hp - e.hp, 12), hp - e.hp)
    hp = e.hp
    b.spawnProj({ kind: 'bolt', x: e.x, y: e.cy, vx: 0, w: 80, h: 80, team: 0, hit: MOVES.h1.hits[0].hit })
    b.updateProjs()
    check('friendly projectiles retain the final multiplier', close(hp - e.hp, MOVES.h1.hits[0].hit.dmg * 1.2))
    hp = e.hp
    p.extremeDodge({ src: e, negate() {} })
    // the counter follows the slow-motion beat
    for (let i = 0; i < 12 && !b.cine; i++) p.update()
    for (let i = 0; i < 400 && b.cine; i++) b.tick()
    check('perfect dodge counter gets the same multiplier', close(hp - e.hp, 72 * 1.2))
    hp = e.hp
    p.overloadT = 0
    b.attack(p, e.box, MOVES.h1.hits[0].hit, new Set())
    check('damage returns to normal when overload ends', close(hp - e.hp, 25))
    reset(true)
    e = enemy(Warden, 1500, false)
    hp = e.hp
    e.takeHit(MOVES.h1.hits[0].hit, p, 1)
    check('boss damage receives the same final multiplier', close(hp - e.hp, 30))
    const damageHit = { ...MOVES.l1.hits[0].hit, dmg: 10 }
    p.takeHit(damageHit, e, 1)
    check('overload does not amplify incoming damage', p.hp === 90)

    for (const Type of [Grunt, Gunner, Heavy, Titan, Warden, Drone]) {
      reset(true)
      e = enemy(Type, 1500, false)
      check(`${e.kind} becomes an enemy anchor`, b.findAnchor()?.target === e)
      p.overloadT = 0
      check(`${e.kind} loses the enemy anchor outside overload`, !b.findAnchor()?.target)
    }
    reset(true)
    const behind = enemy(Grunt, 900),
      ahead = enemy(Gunner, 1500)
    ctl.virtual.right = true
    ctl.poll()
    check('held direction selects the enemy ahead instead of behind', b.findAnchor()?.target === ahead)
    ahead.dead = true
    check('dead enemies cannot be selected', !b.findAnchor()?.target)
    ctl.reset()
    behind.gone = true
    check('removed enemies cannot be selected', !b.findAnchor()?.target)

    for (const direction of [1, -1]) {
      reset(true)
      p.facing = direction
      e = enemy(Grunt, 1000 + direction * 500, false)
      b.anchor = b.findAnchor()
      b.threat = null
      const combo = b.comboN
      p.startDash()
      check(
        `enemy anchor is consumed when the blink starts facing ${direction}`,
        p.dashTarget === e && e.anchorUsed && e.hp === 70
      )
      for (let i = 0; i < p.blinkN - 1; i++) p.update()
      check(`no anchor hit before arrival facing ${direction}`, e.hp === 70)
      e.x += direction * 40
      p.update()
      check(
        `arrival follows the target and defeats a full-health grunt outright facing ${direction}`,
        e.dead && !e.dying && e.hp === 0 && Math.abs(e.x - p.x) <= 130 && b.comboN === combo + 1,
        { hp: e.hp, separation: e.x - p.x }
      )
      for (let i = 0; i < 8; i++) p.update()
      check(`anchor slash hits only once facing ${direction}`, b.comboN === combo + 1 && e.hp === 0)
      check('anchor slash preserves the no-shake rule', b.shakeAmp === 0 && b.punch === 0)
    }
    reset(true)
    e = enemy(Drone, 1600, false)
    b.anchor = b.findAnchor()
    p.startDash()
    for (let i = 0; i < p.blinkN; i++) p.update()
    check('airborne enemy anchor arrives at target height and strikes', e.dead && Math.abs(p.cy - e.cy) < 5)
    reset(true)
    e = enemy(Grunt, 1500, false)
    b.anchor = b.findAnchor()
    p.startDash()
    e.dead = true
    const combo = b.comboN
    for (let i = 0; i < p.blinkN + 4; i++) p.update()
    check('a target lost during the blink is not struck', b.comboN === combo)

    const slash = b.fx.attackSlash.bind(b.fx)
    let effects = []
    b.fx.attackSlash = (...args) => {
      effects.push(args)
      slash(...args)
    }
    for (const direction of [1, -1]) {
      for (const active of [false, true]) {
        reset(active)
        p.facing = direction
        // beyond the ordinary reach of the first heavy stage, inside the overload one
        e = enemy(Grunt, 1000 + direction * 640)
        effects = []
        p.startMove('h1')
        for (let i = 0; i < 15; i++) p.update()
        check(
          `heavy reach ${active ? 'expands' : 'stays normal'} facing ${direction}`,
          active ? close(e.hp, 9970) : e.hp === 10000,
          10000 - e.hp
        )
        const heavyFx = effects.filter((args) => args[2] === 'slash_wide')
        check(
          `heavy blade light matches reach and color facing ${direction}, overload ${active}`,
          active
            ? heavyFx.some((args) => close(args[4], 1.9 * 1.25) && args[6] === COL.main) &&
                heavyFx.some((args) => args[6] === COL.pink)
            : heavyFx.length === 1 && close(heavyFx[0][4], 1.9)
        )
      }
    }
    reset(true)
    e = enemy(Grunt, 1400)
    p.startMove('l1')
    for (let i = 0; i < 10; i++) p.update()
    check('light attack reach stays unchanged during overload', e.hp === 10000)
    for (const active of [false, true]) {
      reset(active)
      e = enemy(Grunt, 1300)
      p.state = 'dive'
      p.diveLand()
      check(
        `dive landing ${active ? 'inherits larger heavy reach' : 'keeps normal reach'}`,
        active ? close(e.hp, 10000 - 20 * 1.2 * 2) : e.hp === 10000
      )
    }
    b.fx.attackSlash = slash
    reset(true)
    enemy(Grunt, 1420)
    enemy(Gunner, 1750)
    enemy(Drone, 1950)
    b.fx.update(5)
    b.anchor = b.findAnchor()
    p.startMove('h1')
    for (let i = 0; i < 15; i++) p.update()
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  await g.shot('overload_heavy')
  assert.ok(
    results.every((result) => result.ok),
    'overload regression; see results above'
  )
}
