import assert from 'node:assert/strict'

export default async (g) => {
  const results = await g.eval(async () => {
    const { A } = await import('/src/art/anims.ts')
    const { Grunt, Gunner, Heavy, Titan, Warden, Drone } = await import('/src/game/enemies.ts')
    const { Player, MOVES } = await import('/src/game/player.ts')
    const { ExecCine } = await import('/src/game/cine.ts')
    const { Stage3D } = await import('/src/three/stage3d.ts')
    const b = window.__vanta.scene,
      p = b.player,
      results = []
    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }
    for (const e of b.enemies) e.destroy()
    b.enemies = []
    p.x = p.px = 1000
    p.y = p.py = 900
    p.onGround = true
    const enemy = new Grunt(b, 1090)
    enemy.state = 'idle'
    enemy.hp = enemy.maxHp = 10000
    enemy.invuln = 0
    enemy.onGround = true
    b.enemies = [enemy]
    const hit = MOVES.l1.hits[0].hit,
      seen = new Set(),
      box = enemy.box
    const hp = enemy.hp
    b.stop = b.shakeAmp = b.punch = 0
    check('light hit connects once', b.attack(p, box, hit, seen) === 1 && enemy.hp === hp - hit.dmg)
    check('hits do not pop damage numbers', b.fx.texts.length === 0)
    check(
      'a light hit does not freeze the frame or move the camera',
      b.stop === 0 && b.shakeAmp === 0 && b.punch === 0,
      {
        stop: b.stop,
        shake: b.shakeAmp,
      }
    )
    check('same swing cannot repeat its damage', b.attack(p, box, hit, seen) === 0 && enemy.hp === hp - hit.dmg)
    // Only the second heavy stage freezes the frame on contact.
    const pausing = MOVES.h2.hits[0].hit
    b.attack(p, box, pausing, new Set())
    check(
      'the second heavy stage freezes the frame on contact, without camera movement',
      pausing.pause === true && b.stop === pausing.stop && b.stop === 16 && b.shakeAmp === 0 && b.punch === 0,
      { stop: b.stop, shake: b.shakeAmp }
    )
    p.px = p.x - 25
    b.draw(0.2, 1 / 60)
    check('contact frame renders at its current position', Math.abs(p.rig.x - p.x) < 0.001)
    const frame = b.frame,
      pose = JSON.stringify(p.an.pose),
      ex = enemy.x
    b.ctl.virtual.light = true
    window.__vanta.step(16)
    b.draw(0.7, 1 / 60)
    check(
      'hitstop freezes logic, animation and interpolation',
      b.frame === frame && enemy.x === ex && JSON.stringify(p.an.pose) === pose && p.rig.x === p.x && b.stop === 0
    )
    check('combo presses survive the entire freeze', b.ctl.peek('light'))
    b.ctl.reset()
    b.stop = b.shakeAmp = 0
    check(
      'whiff does not freeze or shake',
      b.attack(p, { x: 9000, y: 0, w: 10, h: 10 }, pausing, new Set()) === 0 && b.stop === 0 && b.shakeAmp === 0
    )
    const heavy = MOVES.h1.hits[0].hit
    b.attack(p, box, heavy, new Set())
    check(
      'no other attack freezes the frame: not the first heavy stage',
      b.stop === 0 && b.shakeAmp === 0 && b.punch === 0,
      {
        stop: b.stop,
        shake: b.shakeAmp,
      }
    )
    b.spawnProj({ kind: 'bolt', x: enemy.x, y: enemy.cy, team: 0, vx: 0, w: 80, h: 80, hit: heavy })
    b.updateProjs()
    check('nor a friendly projectile', b.stop === 0 && b.shakeAmp === 0 && b.punch === 0)
    p.invuln = 0
    p.takeHit({ ...hit, dmg: 1 }, enemy, -1)
    b.shake(50, 0.1)
    check(
      'enemy hits and other non-execution impacts cannot shake or punch the camera',
      b.shakeAmp === 0 && b.punch === 0
    )
    enemy.destroy()
    b.enemies = []
    for (const q of b.projs) q.im.destroy()
    b.projs = []

    const plats = b.plats
    b.plats = []
    function jumpHeight(airborne = false, tap = false) {
      Object.assign(p, {
        x: 1000,
        px: 1000,
        y: 900,
        py: 900,
        vx: 0,
        vy: 0,
        state: 'free',
        st: 0,
        move: null,
        onGround: !airborne,
        jumps: 0,
        coyote: airborne ? 0 : 6,
        jumping: false,
      })
      b.ctl.reset()
      b.ctl.virtual.jump = true
      let top = p.y
      for (let i = 0; i < 90; i++) {
        b.ctl.poll()
        // A complete tap received between polls still has a latched press.
        if (tap) b.ctl.down.jump = b.ctl.virtual.jump = false
        p.update()
        top = Math.min(top, p.y)
        if (p.vy >= 0) break
      }
      return 900 - top
    }
    const fullHeight = jumpHeight(),
      airHeight = jumpHeight(true),
      tapHeight = jumpHeight(false, true)
    check('held jump reaches 1.5 times its previous apex', Math.abs(fullHeight / 312 - 1.5) < 0.002, fullHeight)
    check('second jump reaches 1.5 times its previous apex', Math.abs(airHeight / (736 / 3) - 1.5) < 0.002, airHeight)
    // the lowest platforms stand 250 and 270 above the deck, and the next tier 220 above those
    check(
      'the shortest tap still carries her onto a platform, well short of a full jump',
      tapHeight >= 285 && tapHeight <= 330 && tapHeight < fullHeight * 0.75,
      tapHeight
    )
    b.plats = plats
    b.ctl.reset()

    // A single positive annulus in the displacement map, rather than multiple
    // sine-wave rings hiding inside one effect instance.
    const canvas = b.textures.get('ripple').getSourceImage()
    const pixels = canvas.getContext('2d').getImageData(128, 128, 128, 1).data
    let bands = 0,
      inside = false,
      reversals = 0
    for (let i = 0; i < 128; i++) {
      const displacement = ((pixels[i * 4] - 128) * pixels[i * 4 + 3]) / 255
      const active = displacement > 20
      if (active && !inside) bands++
      if (displacement < -1.5) reversals++
      inside = active
    }
    check('water displacement has exactly one crest', bands === 1 && reversals === 0, { bands, reversals })

    b.fx.update(5)
    const peak = b.fx.coreBurst(1200, 650, 1)
    const envelope = b.fx.live.find((q) => q.peakAt > 0)
    b.fx.update(1 / 60)
    check('the impact opens before announcing its peak', !peak.reached && envelope.im.alpha < envelope.a0)
    b.fx.update(0.2)
    check(
      'a long render frame still displays the exact maximum before decay',
      peak.reached &&
        Math.abs(envelope.im.scaleX - envelope.sx1) < 1e-6 &&
        Math.abs(envelope.im.alpha - envelope.a0) < 1e-6
    )
    b.fx.update(0.05)
    check('the already-open bloom decays after the peak', envelope.im.alpha < envelope.a0)

    const ripple = b.fx.ripple.bind(b.fx)
    const burst = b.fx.bloomBurst.bind(b.fx),
      cut = b.fx.cut.bind(b.fx)
    // `count` is the wave that sweeps bullets away; the strike's own ripple is only seen
    let count = 0,
      strikeWaves = 0,
      bursts = 0,
      cuts = 0
    b.fx.ripple = (...args) => {
      if (args[6] === false) strikeWaves++
      else count++
      ripple(...args)
    }
    b.fx.bloomBurst = (...args) => {
      bursts++
      return burst(...args)
    }
    b.fx.cut = (...args) => {
      cuts++
      cut(...args)
    }
    for (const Enemy of [Grunt, Gunner, Heavy, Titan, Warden, Drone]) {
      for (const quick of [false, true]) {
        b.fx.update(4)
        Stage3D.I.update(4)
        b.stop = b.shakeAmp = 0
        b.cineAmt = 0
        count = strikeWaves = bursts = cuts = 0
        p.x = p.px = 1000
        p.y = p.py = 900
        p.state = 'free'
        p.hidden = false
        const target = new Enemy(b, 1250)
        target.state = 'dying'
        target.lives = target.maxLives = 1
        target.hp = 0
        target.invuln = 0
        b.enemies = [target]
        const bolt = b.spawnProj({ kind: 'bolt', x: target.x + 600, y: target.cy, team: 1, vx: 0 })
        const cine = new ExecCine(b, target, quick)
        b.cine = cine
        // The optional approach blink has its own movement streaks.
        cuts = 0
        let first = -1,
          early = false,
          maxFronts = 0,
          fastRadius = 0,
          peakShake = 0,
          peakPunch = 0,
          lockedUntilStrike = true,
          slowTicks = 0,
          slowStep = 0,
          premature = false,
          peakVisible = false,
          finishRate = 1,
          deepTicks = 0,
          deepEarly = false,
          tailTicks = 0,
          fullAfterDeep = false
        for (let i = 0; i < 300 && !cine.done; i++) {
          b.ctl.virtual.light = i % 2 === 0
          const previousX = p.x
          b.tick()
          if (cine.airStrike >= 0 && cine.rate < 1) {
            premature ||= cine.t <= cine.boom || !cine.impact.peak?.reached
            if (slowTicks === 0)
              peakVisible =
                p.an.pose.time >= 0.72 &&
                b.fx.live.some(
                  (q) => q.peakAt > 0 && Math.abs(q.life - q.peakAt) < 1e-6 && Math.abs(q.im.alpha - q.a0) < 1e-6
                )
            slowTicks++
            slowStep = Math.max(slowStep, Math.abs(p.x - previousX))
          }
          if (cine.rate === 0.16) {
            deepTicks++
            deepEarly ||= cine.t <= cine.boom || !cine.impact.peak?.reached
          } else if (deepTicks > 0) {
            if (cine.rate === 0.5) tailTicks++
            else fullAfterDeep = true
          }
          if (cine.t > cine.boom) finishRate = Math.min(finishRate, cine.rate)
          if (cine.t <= cine.boom && !p.cine) lockedUntilStrike = false
          peakShake = Math.max(peakShake, b.shakeAmp)
          peakPunch = Math.max(peakPunch, b.punch)
          const fronts = b.fx.ripFronts()
          maxFronts = Math.max(maxFronts, fronts.length)
          if (count && first < 0) {
            first = i
            early = cine.t < cine.boom
          }
          if (first >= 0 && i === first + 10) fastRadius = fronts[0]?.r ?? 0
        }
        const small = ['grunt', 'gunner', 'drone'].includes(target.kind)
        check(
          `${target.kind}: control returns ${small ? 'once the half-speed tail has played' : 'promptly after the strike'}, while effects continue`,
          cine.done &&
            lockedUntilStrike &&
            cine.t <= cine.boom + (small ? 26 : 16) &&
            target.dead &&
            !b.fx.settled &&
            !b.ctl.peek('light')
        )
        b.ctl.reset()
        check(
          `${target.kind} ${quick ? 'quick' : 'full'}: one fast wave during execution`,
          cine.done && early && count === 1 && maxFronts === 1 && fastRadius > 300 && bolt.dead && strikeWaves === 1,
          { count, strikeWaves, early, fastRadius, clearedBullet: bolt.dead }
        )
        check(
          `${target.kind}: restrained execution shake ends with control restored`,
          peakShake > 0 && peakShake <= 26 && peakPunch <= 0.035 && b.shakeAmp === 0 && b.punch === 0 && !p.cine,
          { peakShake, peakPunch }
        )
        if (small) {
          check(
            `${target.kind}: full-speed strike reaches the visible bloom peak before the slow passing movement`,
            finishRate === 0.16 && !premature && peakVisible && slowStep < 18 && p.y < 800,
            { slowTicks, slowStep, finishRate, premature, peakVisible }
          )
          check(
            `${target.kind}: after the slow crossing the set piece plays out at half speed, never back at full`,
            tailTicks >= 20 && tailTicks <= 28 && !fullAfterDeep && slowTicks === deepTicks + tailTicks,
            { tailTicks, fullAfterDeep, slowTicks, deepTicks }
          )
        }
        check(
          `${target.kind}: ${small ? 'one aerial cut with a simultaneous bloom' : 'heavy execution keeps its cuts and ends in one bloom'}`,
          small ? bursts === 1 && cuts === 1 : bursts === 1 && cuts > 0,
          { bursts, cuts }
        )
        check(
          `${target.kind}: the deep slow motion waits for the bloom's peak`,
          deepTicks >= 37 && deepTicks <= 39 && !deepEarly && finishRate === 0.16,
          { deepTicks, deepEarly, finishRate }
        )
        if (!target.gone) target.destroy()
        b.enemies = []
        for (const q of b.projs) q.im.destroy()
        b.projs = []
      }
    }
    b.fx.ripple = ripple
    b.fx.bloomBurst = burst
    b.fx.cut = cut
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'combat feedback regression; see results above'
  )
}
