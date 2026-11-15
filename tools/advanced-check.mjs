import assert from 'node:assert/strict'

export default async (g) => {
  const results = await g.eval(async () => {
    const { Grunt, Warden } = await import('/src/game/enemies.ts')
    const { MOVES } = await import('/src/game/player.ts')
    const { ExecCine } = await import('/src/game/cine.ts')
    const b = window.__vanta.scene,
      p = b.player,
      ctl = b.ctl,
      results = []
    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }
    function close(a, z) {
      return Math.abs(a - z) < 1e-6
    }
    function reset(active = false) {
      for (const e of b.enemies) if (!e.gone) e.destroy()
      for (const q of b.projs) q.im.destroy()
      b.enemies = []
      b.projs = []
      b.cine = null
      b.boss = null
      b.direct = () => {}
      b.bounds = { l: 0, r: 4000 }
      b.plats = []
      b.over = ''
      b.paused = false
      b.stop = b.slowT = 0
      b.anchor = b.threat = null
      b.parryBoxes = []
      b.cam.x = 1500
      b.cam.y = 478
      b.cam.zoom = 0.88
      b.fx.update(10)
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
        dead: false,
        state: 'free',
        st: 0,
        move: null,
        cine: false,
        hidden: false,
        onGround: true,
        flying: false,
        invuln: 0,
        extremeT: 0,
        dashCd: 0,
        energy: 10,
        chargeCd: 0,
        chargeCells: 0,
        chargeLatch: false,
        counterPending: null,
        chargeT: 0,
        overloadT: active ? 15 : 0,
        overloadCd: 0,
      })
    }
    function enemy(x = 1200, durable = true) {
      const e = new Grunt(b, x)
      e.state = 'idle'
      e.invuln = 0
      e.onGround = true
      e.rig.setAlpha(1)
      e.update = () => {}
      if (durable) e.hp = e.maxHp = 10000
      b.enemies.push(e)
      return e
    }
    /** The counter follows a short slow-motion beat; only the player needs to advance for it to begin. */
    function awaitCounter() {
      for (let i = 0; i < 12 && !b.cine; i++) p.update()
    }
    function finishCounter() {
      awaitCounter()
      for (let i = 0; i < 400 && b.cine; i++) b.tick()
      b.stop = b.slowT = 0
    }
    function holdBoth() {
      ctl.virtual.light = ctl.virtual.heavy = true
      ctl.poll()
      p.update()
    }
    reset()
    check(
      'hero model and derived body grow by 1.2',
      close(p.rig.heightPx, 184 * 1.2) && p.h === Math.round(184 * 1.2 * 0.93)
    )
    for (const name of ['h1', 'h2', 'h3', 'launcher', 'whirl']) {
      for (const active of [false, true]) {
        reset(active)
        const e = enemy(1050)
        e.w = 500
        e.h = 700
        p.startMove(name)
        for (let i = 0; i < MOVES[name].len; i++) p.update()
        const expected = MOVES[name].hits.reduce((sum, h) => sum + h.hit.dmg, 0) * (active ? 2 * 1.2 : 1)
        check(
          `${name}: ${active ? 'two hits per heavy segment' : 'one hit per segment'}`,
          close(10000 - e.hp, expected),
          { damage: 10000 - e.hp, expected }
        )
      }
    }
    // The wheel: it starts above where the flurry began and bites a target standing against the hero six times.
    for (const active of [false, true]) {
      reset(active)
      const e = enemy(1110)
      p.startMove('h3')
      for (let i = 0; i < 12; i++) p.update()
      check(
        `the flurry cuts from afterimages while the body stays put and out of reach, overload ${active}`,
        p.x === 1000 && p.phased && p.invuln > 0 && e.hp < 10000
      )
      const afterFlurry = e.hp
      p.startGear()
      const height = 900 - p.y
      let bites = 0,
        last = e.hp
      for (let i = 0; i < 120 && p.state === 'gear'; i++) {
        p.update()
        if (e.hp < last) bites++
        last = e.hp
      }
      const dealt = afterFlurry - e.hp,
        expected = (5 * 7 + 32) * (active ? 2 * 1.2 : 1)
      check(
        `the wheel lands five teeth and a final bite on a hugging target, overload ${active}`,
        height >= 290 && bites >= 6 && dealt >= expected - 1e-6 && p.state === 'attack' && p.move === MOVES.gearLand,
        { height, bites, dealt, expected }
      )
    }
    // Holding heavy turns the first stage into a dash that stops at the first enemy and cuts from there.
    for (const [gap, held] of [
      [400, true],
      [0, true],
      // out of the plain first stage's reach, so a tap must leave it untouched
      [700, false],
    ]) {
      reset()
      const e = gap ? enemy(1000 + gap) : null
      p.startMove('h1')
      ctl.virtual.heavy = held
      ctl.poll()
      for (let i = 0; i < 10; i++) p.update()
      const lunging = p.state === 'lunge'
      for (let i = 0; i < 10 && p.state === 'lunge'; i++) p.update()
      const arrived = p.x
      for (let i = 0; i < 8; i++) p.update()
      ctl.virtual.heavy = false
      ctl.poll()
      check(
        held
          ? gap
            ? 'held heavy dashes to the enemy in the way and delivers the first stage there'
            : 'held heavy with nobody ahead dashes its full distance and still cuts'
          : 'a tapped heavy is the plain first stage',
        held
          ? lunging &&
              p.move === MOVES.h1 &&
              (e ? arrived > 1000 + 200 && arrived < e.x && close(e.hp, 10000 - 25) : close(arrived, 1000 + 360 * 1.25))
          : !lunging && arrived < 1100 && close(e.hp, 10000),
        { lunging, arrived, hp: e?.hp }
      )
    }
    // In the air heavy is the same chain; only down + attack plunges.
    for (const [down, action, expected] of [
      [false, 'heavy', 'h1'],
      [true, 'heavy', 'heavy plunge'],
      [true, 'light', 'light plunge'],
      [false, 'light', 'al1'],
    ]) {
      reset()
      p.y = p.py = 500
      p.onGround = false
      ctl.virtual.down = down
      ctl.virtual[action] = true
      ctl.poll()
      p.update()
      ctl.virtual.down = ctl.virtual[action] = false
      ctl.poll()
      const got =
        p.state === 'dive' ? (p.diveHeavy ? 'heavy plunge' : 'light plunge') : p.move === MOVES.h1 ? 'h1' : 'al1'
      check(`in the air ${down ? 'down + ' : ''}${action} is ${expected}`, got === expected && !p.onGround, got)
    }
    reset(true)
    check('overload reach is 1.25', p.heavyScale === 1.25)
    reset()
    const area = { x: 1050, y: 700, w: 250, h: 200 }
    const bolts = ['bolt', 'shock', 'rain'].map((kind) =>
      b.spawnProj({ kind, x: 1150, y: 800, w: 20, h: 30, team: 1, delay: 0 })
    )
    const outside = b.spawnProj({ kind: 'bolt', x: 1800, y: 800, team: 1 })
    b.attack(p, area, MOVES.h1.hits[0].hit, new Set())
    check('heavy attacks cancel hostile projectiles inside their reach', bolts.every((q) => q.dead) && !outside.dead)
    const fast = b.spawnProj({ kind: 'bolt', x: 800, y: 800, vx: 36000, team: 1 })
    b.updateProjs()
    check('fast bullets cannot tunnel through an active heavy attack', fast.dead)

    for (const direction of [1, -1]) {
      reset()
      p.facing = direction
      const attacker = enemy(1000 + direction * 650)
      const bullet = b.spawnProj({
        kind: 'bolt',
        x: 1000 + direction * 36,
        y: p.cy,
        w: 2,
        h: 2,
        team: 1,
        owner: attacker,
      })
      p.startDash()
      p.update()
      b.updateProjs()
      check(
        `blink path contact triggers a stronger perfect dodge facing ${direction}`,
        bullet.dead &&
          p.hp === 100 &&
          p.extremeT === 70 &&
          p.energy === 40 &&
          !b.cine &&
          b.slowT > 0 &&
          close(attacker.hp, 10000)
      )
      awaitCounter()
      check(`the counter begins after the slow-motion beat facing ${direction}`, !!b.cine?.counterHit)
      const duplicate = b.spawnProj({ kind: 'bolt', x: p.x, y: p.cy, team: 1, owner: attacker })
      b.updateProjs()
      finishCounter()
      check(
        `one dash rewards once and counters each attacker once facing ${direction}`,
        duplicate.dead && p.energy === 40 && close(attacker.hp, 9928)
      )
    }
    reset()
    const attacker = enemy(1650),
      seen = new Set()
    p.startDash()
    p.update()
    const crossing = { x: 1035, y: p.cy - 1, w: 2, h: 2 }
    b.attack(attacker, crossing, MOVES.h1.hits[0].hit, seen)
    finishCounter()
    check(
      'melee touched during a blink also triggers perfect dodge',
      seen.has(p) && p.hp === 100 && p.energy === 40 && close(attacker.hp, 9928)
    )

    // Outside overload the surge is paid for in energy cells: one to begin, one more at each full second.
    for (const [seconds, power, cells] of [
      [0.5, 7.5, 1],
      [1.25, 9.75, 2],
      [2, 12, 3],
    ]) {
      reset()
      p.energy = 100
      holdBoth()
      check(
        `both held attacks begin a paid charge at ${seconds}s`,
        p.charging && !p.move && p.chargeCells === 1 && p.energy === 80 && !p.overCharging
      )
      p.updateOverload(seconds)
      if (seconds < 2) {
        check(`charge rises linearly at ${seconds}s`, close(p.chargePower, power))
        ctl.virtual.heavy = false
        ctl.poll()
        p.update()
      }
      const shot = b.projs.find((q) => q.kind === 'surge')
      check(
        `the paid charge releases once, spends ${cells} cells and starts its cooldown at ${seconds}s`,
        !!shot && !p.charging && p.energy === 100 - cells * 20 && p.chargeCd === 5 && p.overloadCd === 0
      )
      const first = enemy(1300),
        second = enemy(1900)
      for (let i = 0; i < 600 && second.hp === 10000 && !shot.dead; i++) b.updateProjs()
      const damage = 3 * power * 20
      check(
        `surge pierces both targets for its charged damage at ${seconds}s`,
        close(10000 - first.hp, damage) && close(10000 - second.hp, damage) && !shot.dead,
        { damage, first: 10000 - first.hp, second: 10000 - second.hp }
      )
      for (let i = 0; i < 600; i++) b.updateProjs()
      check(`surge leaves the battlefield and despawns at ${seconds}s`, shot.dead && b.projs.length === 0)
      p.update()
      check('buttons still held from one charge do not start the next', !p.charging)
    }
    reset()
    p.energy = 40
    holdBoth()
    p.updateOverload(1)
    check(
      'a charge that runs out of energy lets go early',
      b.projs.length === 1 && close(b.projs[0].hit.dmg, 3 * 9 * 20) && p.energy === 0 && !p.charging
    )
    reset()
    p.energy = 39
    holdBoth()
    check('less than two cells cannot begin a charge', !p.charging && p.energy === 39)
    reset()
    p.energy = 100
    p.chargeCd = 3
    holdBoth()
    check('the paid charge waits out its cooldown', !p.charging && p.energy === 100)

    // In overload the charge is free: the world slows, the view swings overhead, and letting go drops the verdict.
    reset(true)
    const inView = enemy(1300),
      outOfView = enemy(6000)
    let steps = 0
    inView.update = () => steps++
    holdBoth()
    check(
      'the overload charge costs nothing',
      p.overCharging && p.chargeCells === 0 && p.energy === 10 && b.projs.length === 0
    )
    for (let i = 0; i < 30; i++) b.tick()
    check('everything but the hero runs at a tenth of its speed while she charges', steps === 3, steps)
    p.updateOverload(0.4)
    b.draw(1, 1)
    check(
      'the view swings overhead and the hero is lifted off the floor',
      b.topK > 0.99 &&
        p.chargeLift === 1 &&
        p.y === 900 &&
        b.topShade.alpha > 0.9 &&
        b.layer3d.depth > b.topShade.depth,
      { topK: b.topK, lift: p.chargeLift }
    )
    ctl.virtual.heavy = false
    ctl.poll()
    p.update()
    check(
      'letting go turns her, drops the verdict and ends overload',
      b.verdictActive && !p.overloaded && p.overloadCd === 5 && p.y < 900 - 250 && p.facing === -1 && !p.charging
    )
    b.draw(1, 1)
    check('the view returns to the side', b.topK < 0.01 && b.layer3d.depth < b.topShade.depth)
    let alive = 0,
      bites = 0,
      last = inView.hp
    for (; alive < 400 && b.verdictActive; alive++) {
      b.updateVerdict()
      if (inView.hp < last) {
        bites++
        if (!close(last - inView.hp, 25 * 1.2)) bites = -1000
        last = inView.hp
      }
    }
    check(
      'the verdict bites everything in view ten times a second, dragging on the floor for two seconds',
      !b.verdictActive && alive > 130 && alive < 170 && bites >= 20 && outOfView.hp === 10000,
      { alive, bites }
    )

    reset(true)
    holdBoth()
    p.updateOverload(1)
    b.paused = true
    window.__vanta.step(180)
    check('pause freezes charge and overload together', close(p.chargeT, 1) && close(p.overloadT, 14))
    b.paused = false
    p.takeHit({ ...MOVES.l1.hits[0].hit, dmg: 1 }, null, 1)
    check(
      'being hit cancels charge without emitting a wave',
      !p.charging && p.chargeT === 0 && !b.projs.length && !b.verdictActive
    )
    reset(true)
    holdBoth()
    p.overloadT = 1
    p.updateOverload(1)
    check('overload expiry releases the accumulated charge', b.verdictActive && !p.charging && p.overloadCd === 5)

    reset()
    const boss = new Warden(b, 1500)
    b.enemies = [boss]
    b.boss = boss
    boss.state = 'idle'
    boss.invuln = 0
    check('boss starts with three 500-health lives', boss.lives === 3 && boss.maxHp === 500 && boss.hp === 500)
    const kills = b.kills
    boss.takeHit({ ...MOVES.h1.hits[0].hit, dmg: 5000 }, p, 1)
    check(
      'extra lives prevent overkill from bypassing dying',
      boss.dying && boss.hp === 0 && boss.lives === 3 && !boss.dead
    )
    for (const lives of [2, 1]) {
      boss.executed(1)
      check(
        `execution forcibly knocks down one life, leaving ${lives}`,
        boss.lives === lives && boss.state === 'reviving' && !boss.dead && b.kills === kills
      )
      boss.takeHit({ ...MOVES.h1.hits[0].hit, dmg: 5000 }, p, 1)
      check(`knockdown cannot consume another life before recovery ${lives}`, boss.lives === lives)
      for (let i = 0; i < 60; i++) boss.update()
      check(`boss recovers with a full next life ${lives}`, boss.hp === 500 && !boss.dead && boss.state !== 'reviving')
    }
    boss.invuln = 0
    boss.takeHit({ ...MOVES.h1.hits[0].hit, dmg: 1000 }, p, 1)
    check('the final life permits overkill and counts one kill', boss.dead && boss.lives === 0 && b.kills === kills + 1)

    reset()
    const target = enemy(1250, false)
    target.state = 'dying'
    target.hp = 0
    // Restore the actual update for the executed body's fall / fade.
    delete target.update
    const cine = new ExecCine(b, target, false)
    b.cine = cine
    const burst = b.fx.bloomBurst.bind(b.fx),
      cut = b.fx.cut.bind(b.fx)
    let bursts = [],
      cuts = [],
      lifted = false,
      heroJumped = false
    b.fx.bloomBurst = (...args) => {
      bursts.push({ t: cine.t, py: p.y, ey: target.y, x: p.x })
      return burst(...args)
    }
    b.fx.cut = (...args) => {
      cuts.push(cine.t)
      cut(...args)
    }
    for (let i = 0; i < 300 && !cine.done; i++) {
      b.tick()
      lifted ||= target.y < 800
      heroJumped ||= p.y < 800
    }
    b.fx.bloomBurst = burst
    b.fx.cut = cut
    check(
      'small execution launches both bodies and explodes on its single airborne cut',
      cine.done &&
        lifted &&
        heroJumped &&
        bursts.length === 1 &&
        cuts.length === 1 &&
        bursts[0].t === cuts[0] &&
        bursts[0].py < 800 &&
        bursts[0].ey < 800 &&
        Math.abs(bursts[0].x - target.x) < 160,
      { bursts, cuts }
    )
    check(
      'aerial execution returns control beyond the target while airborne and particles keep fading',
      !p.cine && p.y < 800 && p.x > target.x && !b.fx.settled
    )
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'advanced combat regression'
  )
}
