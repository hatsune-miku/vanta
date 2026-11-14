import assert from 'node:assert/strict'

export default async (g) => {
  const results = await g.eval(async () => {
    const { Grunt, Gunner, Heavy, Titan, Warden, Drone } = await import('/src/game/enemies.ts')
    const { CounterCine } = await import('/src/game/counter.ts')
    const { ExecCine } = await import('/src/game/cine.ts')
    const { MOVES } = await import('/src/game/player.ts')
    const { Sfx } = await import('/src/audio/sfx.ts')
    const { COL, VIEW_W } = await import('/src/config.ts')
    const b = window.__vanta.scene,
      p = b.player,
      ctl = b.ctl,
      results = []
    const hit = { ...MOVES.l1.hits[0].hit, dmg: 10 }
    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }
    function close(a, z) {
      return Math.abs(a - z) < 1e-6
    }
    function reset() {
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
      b.locked = true
      b.banner = null
      b.stop = b.slowT = b.shakeAmp = b.punch = b.cineAmt = 0
      b.anchor = b.threat = null
      b.parryBoxes = []
      b.cam = { x: 1500, y: 478, zoom: 0.88, rot: 0 }
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
        energy: 0,
        chargeT: 0,
        overloadT: 0,
        overloadCd: 0,
        airDashed: false,
        jumps: 0,
      })
    }
    function enemy(Type = Grunt, x = 1700, durable = true) {
      const e = new Type(b, x)
      e.state = 'idle'
      e.invuln = 0
      e.onGround = true
      e.rig.setAlpha(1)
      e.update = () => {}
      if (durable) e.hp = e.maxHp = 1000
      b.enemies.push(e)
      return e
    }
    function finishCine() {
      for (let i = 0; i < 400 && b.cine; i++) b.tick()
      return !b.cine
    }

    for (const energy of [0, 19, 19.999, 20, 39, 40, 100]) {
      reset()
      p.energy = energy
      const damageBefore = p.damageTaken
      const blocked = energy >= 20
      p.takeHit(hit, null, 1)
      check(
        `shield needs a complete cell at ${energy} energy`,
        close(p.hp, blocked ? 100 : 90) &&
          close(p.energy, blocked ? energy - 20 : energy) &&
          p.state === (blocked ? 'free' : 'hurt') &&
          close(p.damageTaken - damageBefore, blocked ? 0 : 10)
      )
    }
    reset()
    p.energy = 40
    const source = enemy(),
      seen = new Set()
    b.attack(source, p.box, hit, seen)
    b.attack(source, p.box, hit, seen)
    check('one lingering melee hit consumes only one cell', p.energy === 20 && p.hp === 100 && seen.has(p))
    b.attack(source, p.box, hit, new Set())
    check('the next separate attack consumes the next cell', p.energy === 0 && p.hp === 100)
    b.attack(source, p.box, hit, new Set())
    check('the next attack deals damage after cells run out', p.hp === 90)

    for (const kind of ['bolt', 'shock', 'rain']) {
      reset()
      p.energy = 40
      const q = b.spawnProj({
        kind,
        x: p.x,
        y: kind === 'bolt' ? p.cy : 900,
        w: 60,
        h: kind === 'rain' ? 900 : 100,
        team: 1,
        dmg: 13,
        owner: enemy(),
      })
      b.updateProjs()
      b.updateProjs()
      check(
        `energy shield consumes a ${kind} contact without hitstun or repeat drain`,
        p.hp === 100 && p.energy === 20 && p.state === 'free' && (q.dead || q.hitSet.has(p))
      )
    }
    reset()
    p.energy = 20
    p.overloadT = 15
    ctl.virtual.light = ctl.virtual.heavy = true
    ctl.poll()
    p.update()
    p.updateOverload(0.5)
    p.takeHit(hit, null, 1)
    check(
      'energy shield preserves charging, position and health',
      p.charging && close(p.chargeT, 0.5) && p.hp === 100 && p.energy === 0 && p.vx === 0
    )

    for (const kind of ['shock', 'rain']) {
      for (const dir of [1, -1]) {
        reset()
        p.energy = 20
        p.facing = dir
        const attacker = enemy(Grunt, 1000 + dir * 650)
        const beforeExecs = b.execs,
          beforeKills = b.kills
        const q = b.spawnProj({
          kind,
          x: 1000 + dir * 5,
          y: 900,
          w: 2,
          h: kind === 'rain' ? 900 : 70,
          delay: kind === 'rain' ? 1 : 0,
          team: 1,
          dmg: 13,
          owner: attacker,
        })
        p.startDash()
        p.update()
        b.updateProjs()
        check(
          `${kind} triggers perfect dodge on the swept path facing ${dir}`,
          q.dead && !!b.cine?.counterHit && p.cine && p.hp === 100 && p.energy === 50
        )
        finishCine()
        check(
          `${kind} counter animation deals ordinary damage without execution rewards facing ${dir}`,
          close(attacker.hp, 928) &&
            !attacker.dead &&
            attacker.lives === 1 &&
            b.execs === beforeExecs &&
            b.kills === beforeKills
        )
      }
    }
    reset()
    p.hp = 64
    p.overloadT = 15
    let boss = enemy(Warden, 1500, false)
    const beforeExecs = b.execs
    p.startDash()
    p.extremeDodge({ src: boss, negate() {} })
    const counter = b.cine
    p.overloadT = 0
    finishCine()
    check(
      'boss counter uses the universal passing slash and preserves lives and healing rules',
      counter instanceof CounterCine &&
        !(counter instanceof ExecCine) &&
        close(boss.hp, 413.6) &&
        boss.lives === 3 &&
        !boss.dead &&
        p.hp === 64 &&
        b.execs === beforeExecs,
      { hp: boss.hp, lives: boss.lives, playerHp: p.hp }
    )

    for (const Type of [Grunt, Gunner, Heavy, Titan, Warden, Drone]) {
      for (const dir of [1, -1]) {
        reset()
        const target = enemy(Type, 1000 + dir * 450)
        const beforeY = target.y,
          beforeExecs = b.execs
        check(`${target.kind}: starts the universal counter facing ${dir}`, b.tryCounter(target, { ...hit, dmg: 72 }))
        const counter = b.cine
        let ticks = 0,
          crossings = 0,
          slowTicks = 0,
          premature = false,
          peakVisible = false,
          wasBefore = true
        for (; ticks < 100 && b.cine; ticks++) {
          b.tick()
          if (counter.rate < 1) {
            premature ||= target.hp !== 928 || !counter.impact.peak?.reached
            if (slowTicks === 0)
              peakVisible =
                p.an.pose.time >= 0.72 &&
                b.fx.live.some(
                  (q) => q.peakAt > 0 && Math.abs(q.life - q.peakAt) < 1e-6 && Math.abs(q.im.alpha - q.a0) < 1e-6
                )
            slowTicks++
          }
          const before = (p.x - target.x) * dir < 0
          if (wasBefore && !before) crossings++
          wasBefore = before
        }
        check(
          `${target.kind}: one passing counter slows only at the visible impact peak facing ${dir}`,
          counter instanceof CounterCine &&
            ticks >= 45 &&
            ticks < 60 &&
            !premature &&
            peakVisible &&
            slowTicks >= 37 &&
            slowTicks <= 39 &&
            crossings === 1 &&
            close(target.hp, 928) &&
            target.y === beforeY &&
            b.execs === beforeExecs &&
            !b.fx.ripFronts().length &&
            !p.cine &&
            (p.x - target.x) * dir > 0,
          { ticks, crossings, hp: target.hp, slowTicks, premature, peakVisible }
        )
      }
    }

    reset()
    const counterVictim = enemy(Drone, 1500, false)
    delete counterVictim.update
    b.tryCounter(counterVictim, { ...hit, dmg: 72 })
    finishCine()
    check('a countered body follows the slowed cinematic clock', counterVictim.dead && counterVictim.st < 20 && !p.cine)

    reset()
    p.overloadT = 15
    boss = enemy(Warden, 1500, false)
    b.anchor = b.findAnchor()
    p.startDash()
    check('enemy anchor is consumed at departure', boss.anchorUsed && b.findAnchor()?.target !== boss)
    for (let i = 0; i < p.blinkN + 4; i++) p.update()
    check('consumed anchor still gets its one arrival slash', close(boss.hp, 410))
    b.anchor = b.findAnchor()
    p.startDash()
    for (let i = 0; i < p.blinkN + 4; i++) p.update()
    check('same enemy cannot be struck again through anchoring', close(boss.hp, 410))
    p.overloadT = p.overloadCd = 0
    p.activateOverload()
    check('a later overload cannot reset a used enemy anchor', b.findAnchor()?.target !== boss)
    boss.executed(1)
    delete boss.update
    for (let i = 0; i < 60; i++) boss.update()
    check(
      'boss revival keeps its consumed anchor',
      boss.lives === 2 && boss.anchorUsed && b.findAnchor()?.target !== boss
    )
    b.draw(1, 0)
    check('consumed anchors lose both their marker and keycap', !boss.anchorMarker?.visible && !boss.anchorKey?.visible)

    reset()
    p.overloadT = 15
    p.facing = -1
    ctl.virtual.light = ctl.virtual.heavy = true
    ctl.poll()
    p.update()
    p.updateOverload(1.5)
    const wave = b.projs.find((q) => q.kind === 'surge')
    check(
      'full charge releases at 1.5 seconds with coefficient twelve',
      !!wave && close(wave.hit.dmg * wave.hit.multiplier, 864) && !p.overloaded
    )
    check(
      'the upright wave enters from the screen left even when facing left',
      wave.screenX < 0 && wave.vx === 400 && wave.im.rotation === 0
    )
    const firstX = wave.screenX
    for (let i = 0; i < 120; i++) b.updateProjs()
    check('wave travels 800 screen pixels in two seconds', close(wave.screenX - firstX, 800) && wave.im.rotation === 0)
    b.cam.x += 300
    b.cam.y -= 80
    b.cam.zoom = 1.2
    b.updateProjs()
    check(
      'camera movement and zoom do not make the blade orbit or tilt',
      close((wave.x - b.cam.x) * b.cam.zoom + VIEW_W / 2, wave.screenX) &&
        close(wave.y, b.cam.y) &&
        wave.im.rotation === 0
    )
    for (let i = 0; i < 400; i++) b.updateProjs()
    check('wave exits on the right after crossing the whole screen', wave.dead && wave.screenX > VIEW_W)

    for (const bulletFirst of [true, false]) {
      reset()
      p.x = p.px = 1500
      p.energy = 40
      let blade
      if (!bulletFirst) blade = b.spawnSurge(hit)
      const contact = b.spawnProj({ kind: 'bolt', x: 1600, y: p.cy, team: 1, vx: -6000, dmg: 10 })
      const fast = b.spawnProj({ kind: 'bolt', x: 1900, y: p.cy - 100, team: 1, vx: -48000 })
      const far = b.spawnProj({ kind: 'bolt', x: 2400, y: p.cy, team: 1, vx: -60 })
      const friendly = b.spawnProj({ kind: 'bolt', x: 1600, y: p.cy, team: 0, vx: -6000 })
      if (bulletFirst) blade = b.spawnSurge(hit)
      blade.screenX = VIEW_W / 2
      b.updateProjs()
      check(
        `surge absorbs contacts and fast crossings before damage, bullet spawned first ${bulletFirst}`,
        contact.dead && fast.dead && !blade.dead && p.hp === 100 && p.energy === 40
      )
      check('absorption only removes hostile bullets crossing this blade', !far.dead && !friendly.dead)
    }

    reset()
    let entries = 0
    const entry = b.fx.overloadEnter.bind(b.fx)
    b.fx.overloadEnter = (...args) => {
      entries++
      entry(...args)
    }
    p.activateOverload()
    p.activateOverload()
    p.updateOverload(1)
    check('strong overload entry flash happens once per activation', entries === 1 && b.fx.overlayA >= 0.75)
    b.fx.overloadEnter = entry
    const hud = b.scene.get('Hud')
    hud.update(0, 16)
    check(
      'overload countdown sits at the upper centre',
      hud.overload.x === VIEW_W / 2 && hud.overload.y < 160 && hud.overload.originX === 0.5
    )
    b.fx.update(10)
    b.fx.slash(p.x, p.cy, 'slash', 0, 1, 1, COL.main)
    const blades = b.fx.live.filter((fx) => fx.im.texture.key.startsWith('blade_'))
    const mask = b.textures.get('blade_slash').source[0].image
    const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data
    let opaque = 0,
      drawn = 0,
      feathered = 0
    const tones = new Set()
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]) drawn++
      if (pixels[i] >= 250) opaque++
      if (pixels[i] > 32 && pixels[i] < 220) feathered++
      if (pixels[i] > 80) tones.add(pixels[i - 1])
    }
    check(
      'hero blade carries shaded translucent volume, a saturated halo and a narrow highlight',
      blades.length === 3 && blades[1].im.blendMode === 3 && opaque === 0 && feathered / drawn > 0.6 && tones.size > 64,
      { featheredFraction: feathered / drawn, tones: tones.size }
    )

    for (let recycled = 0; recycled < 2; recycled++) {
      b.fx.update(10)
      b.fx.attackSlash(p.x, p.cy, 'slash', 0.3, 1.2, -1, COL.main)
      const layers = b.fx.live,
        shade = layers.find((q) => q.im.blendMode === 0),
        light = layers.filter((q) => q !== shade)
      const positions = new Set(layers.map((q) => [q.im.x, q.im.y, q.im.rotation, q.im.scaleX, q.im.scaleY].join(',')))
      check(
        `attack layers keep one silhouette and emission above shade after reuse ${recycled}`,
        positions.size === 1 &&
          light.every((q) => q.im.depth > shade.im.depth) &&
          light.some((q) => q.im.texture.key.endsWith('_hot'))
      )
    }

    const originalAudio = window.AudioContext
    let audioContexts = 0
    window.AudioContext = class {
      constructor() {
        audioContexts++
      }
    }
    const silent = new Sfx()
    silent.unlock()
    silent.startMusic()
    silent.play('exBoom')
    silent.stopMusic()
    window.AudioContext = originalAudio
    check('all sound and music paths stay silent without opening audio', audioContexts === 0)
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'combat presentation revision regression'
  )
}
