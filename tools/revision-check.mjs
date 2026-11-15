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
        chargeCd: 0,
        chargeCells: 0,
        chargeLatch: false,
        counterPending: null,
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
    /** The counter follows a short slow-motion beat; only the player needs to advance for it to begin. */
    function awaitCounter() {
      for (let i = 0; i < 12 && !b.cine; i++) p.update()
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
        awaitCounter()
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
    check('the extreme dodge is held in slow motion before its counter', !b.cine && b.slowT > 0 && b.slowScale < 0.2)
    awaitCounter()
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
    p.energy = 100
    p.facing = -1
    ctl.virtual.light = ctl.virtual.heavy = true
    ctl.poll()
    p.update()
    p.updateOverload(2)
    const wave = b.projs.find((q) => q.kind === 'surge')
    check(
      'a full paid charge releases at two seconds with coefficient twelve and three cells spent',
      !!wave && close(wave.hit.dmg * wave.hit.multiplier, 720) && p.energy === 40 && p.chargeCd === 5
    )
    check(
      'the upright wave enters from the screen left even when facing left',
      wave.screenX < 0 && wave.vx === 1000 && wave.im.rotation === 0
    )
    const firstX = wave.screenX
    for (let i = 0; i < 60; i++) b.updateProjs()
    check('wave travels 1000 screen pixels in one second', close(wave.screenX - firstX, 1000) && wave.im.rotation === 0)
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

    // ---- the heavy chain's recovery: it paces the chain, and nothing else waits for it
    function fresh() {
      reset()
      Object.assign(p, { heavyLock: 0, chainT: 0, chainNext: null, heavyQueued: false, airMoves: 0 })
    }
    function mash(action, i) {
      ctl.virtual[action] = i % 4 < 2
    }
    const h1 = MOVES.h1,
      h2 = MOVES.h2
    fresh()
    p.startMove('h1')
    let next = -1
    for (let i = 1; i <= 80 && next < 0; i++) {
      mash('heavy', i)
      b.tick()
      if (p.move === h2) next = i
    }
    check(
      'mashing heavy starts the next stage when the recovery ends, not at the first cancel frame',
      next === h1.chain &&
        h1.chain - h1.cancel >= 8 &&
        h2.chain - h2.cancel >= 8 &&
        MOVES.h3.chain - MOVES.h3.cancel >= 8,
      { next, chain: h1.chain, cancel: h1.cancel }
    )
    check(
      "the landing of the wheel has the chain's longest recovery, though not by much",
      MOVES.gearLand.chain - MOVES.gearLand.cancel > h1.chain - h1.cancel &&
        MOVES.gearLand.chain - MOVES.gearLand.cancel <= 2 * (h1.chain - h1.cancel)
    )
    for (const [action, expected] of [
      ['dash', () => p.state === 'dash'],
      ['light', () => p.state === 'attack' && p.move === MOVES.l1],
      ['jump', () => p.state === 'free' && !p.onGround],
      ['right', () => p.state === 'free' && p.vx > 0],
    ]) {
      fresh()
      p.startMove('h1')
      for (let i = 0; i < h1.cancel; i++) b.tick()
      ctl.virtual[action] = true
      b.tick()
      b.tick()
      check(`${action} answers at once inside a heavy stage's recovery`, expected() && p.mf < h1.chain, {
        state: p.state,
        frame: p.mf,
      })
    }
    // walked out of the recovery: the chain keeps its place for a moment, and the recovery still has to pass
    fresh()
    p.startMove('h1')
    for (let i = 0; i < h1.cancel; i++) b.tick()
    ctl.virtual.right = true
    b.tick()
    ctl.virtual.right = false
    const leftAt = h1.cancel + 1
    let resumed = null,
      waited = 0
    for (let i = 1; i <= 40 && !resumed; i++) {
      mash('heavy', i)
      b.tick()
      if (p.state === 'attack') {
        resumed = p.move
        waited = i
      }
    }
    check(
      'a heavy press after walking out continues with the next stage once the recovery has run',
      resumed === h2 && leftAt + waited >= h1.chain,
      { stage: resumed === h2 ? 'h2' : resumed === h1 ? 'h1' : String(resumed), waited }
    )
    fresh()
    p.startMove('h1')
    for (let i = 0; i < h1.cancel; i++) b.tick()
    ctl.virtual.right = true
    b.tick()
    ctl.virtual.right = false
    for (let i = 0; i < 60; i++) b.tick()
    for (let i = 1; i <= 6 && p.state !== 'attack'; i++) {
      mash('heavy', i)
      b.tick()
    }
    check('once that moment has passed the chain starts over', p.move === h1)

    // ---- the second and fourth heavy stages: a lesser bloom, a longer pause, small frames left reeling
    const bloomBurst = b.fx.bloomBurst.bind(b.fx)
    let blooms = []
    b.fx.bloomBurst = (...args) => {
      blooms.push(args)
      return bloomBurst(...args)
    }
    fresh()
    const reeling = enemy(Grunt, 1300),
      second = enemy(Gunner, 1420),
      plated = enemy(Heavy, 1540)
    p.startMove('h2')
    for (let i = 0; i < h2.hits[0].from; i++) p.update()
    check(
      'the second heavy stage blooms on two bodies at most, the second smaller, and only the first washes the screen',
      blooms.length === 2 &&
        close(blooms[0][2], 0.8) &&
        close(blooms[1][2], 0.8 * 0.7) &&
        blooms[0][4] === 0.5 &&
        blooms[1][4] === 0 &&
        b.stop === 16,
      { blooms: blooms.map((a) => [a[2], a[4]]), stop: b.stop }
    )
    check(
      'it leaves small frames reeling where they stand and does not move armoured ones',
      reeling.state === 'hurt' &&
        reeling.stun === 48 &&
        Math.abs(reeling.vx) <= 150 &&
        reeling.onGround &&
        second.state === 'hurt' &&
        plated.state === 'idle',
      { small: [reeling.state, reeling.stun, reeling.vx], plated: plated.state }
    )
    fresh()
    blooms = []
    enemy(Grunt, 1300)
    p.startMove('h1')
    for (let i = 0; i < h1.hits[0].from + 2; i++) p.update()
    check('the first heavy stage does not bloom', blooms.length === 0 && b.comboN > 0)
    fresh()
    blooms = []
    p.overloadT = 15
    enemy(Grunt, 1300)
    p.startMove('h2')
    for (let i = 0; i < h2.hits[0].to; i++) p.update()
    check("overload's second cut repeats the damage but not the bloom", blooms.length === 1 && blooms[0][3] === true, {
      blooms: blooms.length,
    })
    fresh()
    blooms = []
    const under = enemy(Grunt, 1150)
    p.state = 'gear'
    p.gearLand()
    check(
      "the wheel's landing blooms a little harder and staggers small frames longest, without freezing the frame",
      blooms.length === 1 && close(blooms[0][2], 1) && b.stop === 0 && under.state === 'hurt' && under.stun === 64,
      { blooms: blooms.map((a) => a[2]), stop: b.stop, state: under.state, stun: under.stun }
    )
    b.fx.bloomBurst = bloomBurst

    // ---- the overload charge is cut twice: a herald that harms nothing, then the arc that bites
    fresh()
    const struck = enemy(Grunt, 1400),
      before = struck.hp
    b.spawnVerdict({ ...h1.hits[0].hit, multiplier: 1.2 })
    const herald = b.verdict.herald,
      heraldFrom = herald.y
    check(
      'the charge opens with the herald alone',
      b.verdictActive && b.verdict.wait === 18 && !!herald && !b.verdict.im[0].visible && herald.im.visible
    )
    for (let i = 0; i < 17; i++) b.tick()
    check(
      'the herald falls straight through the floor without stopping or hurting anything',
      struck.hp === before && close(herald.y - heraldFrom, 17 * 70) && herald.y > 900 && b.verdict.wait === 1,
      { hp: struck.hp, fell: herald.y - heraldFrom }
    )
    let fall = 0,
      grind = 0,
      after = 0,
      heraldGone = -1,
      smeared = 0,
      jolt = 0,
      tremble = 0
    for (let i = 0; i < 400 && b.verdict; i++) {
      const v = b.verdict
      if (v.wait <= 0 && v.y < 900) {
        b.draw(1, 0.016)
        if (v.trail.every((im) => im.visible && im.alpha > 0.05 && im.y < v.im[1].y)) smeared++
      } else if (v.wait <= 0 && v.ground > 0 && v.ground < 0.1) jolt = Math.max(jolt, b.shakeAmp)
      else if (v.wait <= 0 && v.ground > 1 && v.ground < 1.2) tremble = Math.max(tremble, b.shakeAmp)
      if (v.wait <= 0 && v.y < 900) fall++
      else if (v.wait <= 0 && v.ground < 2) grind++
      else if (v.wait <= 0) after++
      b.tick()
      if (b.verdict && !b.verdict.herald && heraldGone < 0) heraldGone = i
    }
    const bites = (before - struck.hp) / 30
    check(
      'the arc falls in a blink, drags on the floor for two seconds, then is gone',
      fall >= 6 && fall <= 14 && grind >= 119 && grind <= 122 && after <= 8 && !b.verdict,
      { fall, grind, after }
    )
    check(
      'the arc trails a smear of itself while it falls, jolts the view on landing and keeps it trembling',
      smeared >= fall - 1 && jolt >= 20 && tremble > 0 && !b.cine,
      { smeared, fall, jolt, tremble }
    )
    check(
      'only the arc bites, ten times a second for as long as it lasts',
      Math.abs(bites - Math.round(bites)) < 1e-6 && bites >= 20 && bites <= 24 && heraldGone >= 0,
      { bites, heraldGone }
    )

    // ---- the HUD carries no skill bar; the extreme dodge's cut is dressed as an execution; the wall is quick
    check(
      'the HUD has no skill icons',
      b.scene.get('Hud').skillRows === undefined &&
        !b.textures.exists('skill_frame') &&
        !b.textures.exists('skill_light')
    )
    for (const [Type, power] of [
      [Grunt, 1.3],
      [Heavy, 1.55],
      [Titan, 1.9],
    ]) {
      fresh()
      const countered = enemy(Type, 1400)
      const bloomed = [],
        rippled = [],
        ripple = b.fx.ripple.bind(b.fx),
        bloomBefore = b.fx.bloomBurst.bind(b.fx),
        core = b.fx.coreBurst.bind(b.fx)
      let lesser = 0,
        shook = 0
      b.fx.bloomBurst = (...args) => {
        bloomed.push(args)
        return bloomBefore(...args)
      }
      b.fx.coreBurst = (...args) => {
        lesser++
        return core(...args)
      }
      b.fx.ripple = (...args) => {
        rippled.push(args)
        ripple(...args)
      }
      b.tryCounter(countered, { ...hit, dmg: 72 })
      for (let i = 0; i < 400 && b.cine; i++) {
        b.tick()
        shook = Math.max(shook, b.shakeAmp)
      }
      b.fx.bloomBurst = bloomBefore
      b.fx.coreBurst = core
      b.fx.ripple = ripple
      check(
        `${countered.kind}: the extreme dodge's cut blooms, ripples and shakes exactly as an execution does`,
        bloomed.length === 1 &&
          close(bloomed[0][2], power) &&
          (bloomed[0][4] ?? 1) === 1 &&
          lesser === 0 &&
          rippled.length === 1 &&
          rippled[0][6] === false &&
          shook >= 15 &&
          !b.cine &&
          b.blurShot.strength === 0,
        { power: bloomed.map((a) => a[2]), lesser, ripples: rippled.length, shook }
      )
    }
    fresh()
    const wall = b.spawnSurge({ ...h1.hits[0].hit, multiplier: 1 })
    check('the light wall of the ordinary charge crosses the screen at 1000 a second', wall.vx === 1000, wall.vx)
    wall.dead = true
    fresh()
    p.startMove('l1')
    for (let i = 0; i < 80 && p.state === 'attack'; i++) p.update()
    p.update()
    const settle = p.an.blendLen
    p.an.play(p.an.anim, 5, true)
    ctl.virtual.right = true
    for (let i = 0; i < 12; i++) b.tick()
    ctl.virtual.right = false
    for (let i = 0; i < 30; i++) b.tick()
    check(
      'she eases back into her stance after an action, while stopping from a run stays quick',
      settle >= 18 && p.an.anim.clip === 'Sword_Idle' && p.an.blendLen === 5,
      { settle, after: p.an.blendLen, clip: p.an.anim.clip }
    )
    ctl.reset()

    // ---- the flurry's body, air dodges, the wheel, the dodge's streaks, the pared-down HUD, the backdrop
    fresh()
    p.startMove('h3')
    for (let i = 0; i < 26; i++) p.update()
    const goneAfterFlurry = p.phased
    for (let i = 26; i < MOVES.h3.len - 2; i++) p.update()
    check(
      'after the flurry the body stays gone until the stage is over',
      goneAfterFlurry && !p.phased && p.state === 'attack' && MOVES.h3.hits.every((h) => h.to < 26),
      { goneAfterFlurry, frame: p.mf }
    )
    fresh()
    Object.assign(p, { y: 420, py: 420, onGround: false, vy: 0 })
    ctl.virtual.right = true
    const heights = []
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 60 && (p.dashCd > 0 || p.state !== 'free'); i++) b.tick()
      ctl.virtual.dash = true
      b.tick()
      b.tick()
      ctl.virtual.dash = false
      for (let i = 0; i < 10; i++) b.tick()
      heights.push(Math.round(p.y))
    }
    ctl.virtual.right = false
    const travelled = p.x
    check(
      'air dodges chain across the air without losing height',
      heights.every((y) => Math.abs(y - 420) <= 2) && travelled > 1000 + 4 * 300,
      { heights, travelled }
    )
    for (let i = 0; i < 90; i++) b.tick()
    check('left alone, the hang runs out and she comes down', p.onGround && p.y === 900, p.y)
    fresh()
    p.startGear()
    const turned = p.gearRot
    b.tick()
    b.draw(1, 0.016)
    check(
      'the fourth heavy stage is a wheel: she turns more than a third of a circle each frame under discs of blade light',
      Math.abs(p.gearRot - turned) > 2 &&
        p.wheel.length === 3 &&
        p.wheel.every((im) => im.visible) &&
        p.rig.alpha <= 0.35,
      { step: p.gearRot - turned, alpha: p.rig.alpha }
    )
    while (p.state === 'gear') b.tick()
    b.draw(1, 0.016)
    check('the wheel is put away on landing', p.wheel.every((im) => !im.visible) && p.state === 'attack')
    fresh()
    const liveBefore = b.fx.live.length
    b.fx.dashTrail(1000, 500, 1400, 500)
    const first = b.fx.live.slice(liveBefore).map((q) => [Math.round(q.im.y), +q.max.toFixed(2)])
    const mark = b.fx.live.length
    b.fx.dashTrail(1000, 500, 1400, 500)
    const again = b.fx.live.slice(mark).map((q) => [Math.round(q.im.y), +q.max.toFixed(2)])
    check(
      "the dodge's streaks are short-lived and never drawn the same way twice",
      first.length >= 7 && first.every(([, life]) => life <= 0.27) && JSON.stringify(first) !== JSON.stringify(again),
      { first, again }
    )
    const hudTexts = b.scene
      .get('Hud')
      .children.list.filter((o) => o.type === 'Text')
      .map((o) => o.text)
    check(
      'the HUD names her VANTA and points with a bare arrow',
      hudTexts.includes('VANTA') && hudTexts.includes('▶') && !hudTexts.some((t) => /UNIT|GO|\[ U \]/.test(t)),
      hudTexts.filter(Boolean)
    )
    check(
      'the backdrop is the photographed plant, not the painted city',
      ['bd_far', 'bd_mid', 'bd_column', 'bd_floor', 'bd_near', 'bd_lights', 'bd_shafts'].every((key) =>
        b.textures.exists(key)
      ) && !['sky', 'bg_far', 'bg_mid', 'bg_near'].some((key) => b.textures.exists(key))
    )

    // ---- the terminal, the stages, and stage 2's enemies
    const { LEVELS } = await import('/src/scenes/Battle.ts')
    const { Lancer, Mortar, Arbiter } = await import('/src/game/enemies.ts')
    const tapKey = (action) => {
      ctl.virtual[action] = true
      b.tick()
      b.tick()
      ctl.virtual[action] = false
      b.tick()
    }
    fresh()
    const frozenAt = b.frame
    tapKey('pause')
    check(
      'Escape opens the terminal on its stage screen and holds the game still',
      b.menu?.tab === 'stage' && b.paused && b.frame <= frozenAt + 2,
      {
        tab: b.menu?.tab,
      }
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP' }))
    b.tick()
    check('P is no longer bound to anything', b.paused && b.menu?.tab === 'stage')
    const startRow = b.menu.row
    tapKey('down')
    tapKey('light')
    check(
      'W / S move the cursor; an attack button does not confirm',
      b.menu?.row === startRow + 1 && b.paused && !b.restarting,
      b.menu?.row
    )
    tapKey('skills')
    const onSkills = b.menu?.tab
    tapKey('down')
    const secondSkill = b.menu?.skill
    tapKey('pause')
    check(
      'K turns to the skills page, W / S step through the skills, Escape turns back',
      onSkills === 'skills' && secondSkill === 1 && b.menu?.tab === 'stage',
      { onSkills, secondSkill, tab: b.menu?.tab }
    )
    tapKey('pause')
    check('Escape again returns to the fight', !b.menu && !b.paused)
    tapKey('skills')
    const straight = b.menu?.tab
    tapKey('skills')
    check('K from the fight opens the skills page and K closes it again', straight === 'skills' && !b.menu && !b.paused)
    check(
      'there are two stages, each with its own backdrop, music and last lockdown',
      LEVELS.length === 2 &&
        LEVELS[0].backdrop === 'plant' &&
        LEVELS[1].backdrop === 'yard' &&
        LEVELS[0].music !== LEVELS[1].music &&
        LEVELS.every((level) => level.arenas.length === 4 && level.arenas[3].boss) &&
        ['bd_far_yard', 'bd_mid_yard', 'bd_near_yard', 'bd_lights_yard', 'bd_floor_yard'].every((key) =>
          b.textures.exists(key)
        )
    )
    check(
      'platforms stand well above where a heavy chain thrown from the deck can leave her',
      LEVELS.every((level) => level.arenas.every((arena) => arena.plats.every((plat) => 900 - plat.y >= 340)))
    )
    // the skirmisher: lunges from range, then breaks away
    fresh()
    b.bounds = { l: 0, r: 4000 }
    const lancer = new Lancer(b, 1560)
    Object.assign(lancer, { state: 'idle', invuln: 0, onGround: true, cd: 0 })
    lancer.rig.setAlpha(1)
    b.enemies.push(lancer)
    let lunged = false,
      farthest = 0
    for (let i = 0; i < 400; i++) {
      p.hp = 100
      p.invuln = 5
      b.tick()
      lunged ||= lancer.atk === undefined ? false : !!lancer.atk
      if (lunged && !lancer.atk) farthest = Math.max(farthest, Math.abs(lancer.x - p.x))
    }
    check('the skirmisher lunges from beyond sword reach, then gets clear again', lunged && farthest > 420, {
      lunged,
      farthest,
    })
    // the spotter: keeps away and calls marked strikes down
    fresh()
    b.bounds = { l: 0, r: 4000 }
    const mortar = new Mortar(b, 1700)
    Object.assign(mortar, { state: 'idle', invuln: 0, onGround: true, cd: 0 })
    mortar.rig.setAlpha(1)
    b.enemies.push(mortar)
    let strikes = 0
    for (let i = 0; i < 120; i++) {
      p.invuln = 5
      b.tick()
      strikes = Math.max(strikes, b.projs.filter((q) => q.kind === 'rain').length)
    }
    check(
      'the spotter calls three marked strikes down around the hero and does not close in',
      strikes === 3 && Math.abs(mortar.x - p.x) >= 600,
      { strikes, distance: Math.abs(mortar.x - p.x) }
    )
    // the boss: three lives, a banner name, and skirmishers each time it is put down
    fresh()
    b.bounds = { l: 0, r: 4000 }
    const arbiter = new Arbiter(b, 2200)
    Object.assign(arbiter, { state: 'idle', invuln: 0, onGround: true })
    arbiter.rig.setAlpha(1)
    b.enemies.push(arbiter)
    const before2 = b.enemies.length
    arbiter.takeHit({ dmg: 1e6, kx: 0, ky: 0, stun: 0, stop: 0, shake: 0, finish: true }, p, 1)
    check(
      "stage 2's boss has three lives and a name, and brings in two skirmishers when it loses one",
      arbiter.isBoss &&
        arbiter.title.includes('ARBITER') &&
        arbiter.lives === 2 &&
        b.enemies.length === before2 + 2 &&
        b.enemies.slice(-2).every((e) => e.kind === 'lancer'),
      { lives: arbiter.lives, enemies: b.enemies.map((e) => e.kind) }
    )

    // ---- as a KOOK mini-game: the load result is reported the way the SDK asks, against a stand-in host
    const { Kook, kook: kookLive } = await import('/src/core/kook.ts')
    const kkWait = (ms = 30) => new Promise((done) => setTimeout(done, ms))
    function kkHost({
      capabilities = ['lifecycle.reportLoadResult', 'lifecycle.onStateChanged'],
      refuse = 0,
      answer = 'authorized',
    } = {}) {
      const calls = [],
        // `answer`: what the player (or the host) does with an authorisation request; `asked`: the requests made
        host = { epoch: 1, connection: null, lifecycle: null, auth: null, refuse, answer, asked: [] }
      const client = {
        onConnectionChanged(listener) {
          host.connection = listener
          listener({ state: 'idle', epoch: 0, reason: null })
          return () => {}
        },
        ready() {
          calls.push('ready')
          return Promise.resolve({}).then((value) => {
            host.connection({ state: 'connected', epoch: host.epoch, reason: null })
            return value
          })
        },
        hasCapability: (name) => capabilities.includes(name),
        session: {
          get(input) {
            host.asked.push(input)
            if (host.answer === 'error') return Promise.reject({ code: 'REQUEST_TIMEOUT' })
            if (host.answer === 'cancelled') return Promise.resolve({ status: 'cancelled', state: input.state })
            return Promise.resolve({
              status: 'authorized',
              code: 'one-time-code',
              state: host.answer === 'forged' ? 'f'.repeat(32) : input.state,
              expiresAt: Date.now() + 60000,
              scopes: input.scopes,
              revision: 1,
            })
          },
        },
        auth: {
          onStateChanged(listener) {
            host.auth = listener
            return Promise.resolve({ unsubscribe: async () => {} })
          },
        },
        lifecycle: {
          reportLoadResult(input) {
            calls.push(JSON.stringify(input))
            return host.refuse-- > 0 ? Promise.reject({ code: 'NOT_READY' }) : Promise.resolve()
          },
          onStateChanged(listener) {
            host.lifecycle = listener
            return Promise.resolve({ unsubscribe: async () => {} })
          },
        },
        destroy() {
          calls.push('destroy')
        },
      }
      return { calls, host, load: () => Promise.resolve({ createKookClient: () => client }) }
    }
    const KK_LOADED = '{"status":"loaded"}'
    check(
      'opened on its own the game is not a KOOK session and asks for no SDK',
      kookLive.state === 'standalone' && !kookLive.framed
    )
    // the title is up before KOOK answers: the report waits for ready()
    let kkFake = kkHost(),
      kkSession = new Kook()
    kkSession.loadResult(true)
    kkSession.start(kkFake.load, true)
    await kkWait()
    check(
      'ready() comes first, then one "loaded" report',
      kkSession.state === 'ready' && JSON.stringify(kkFake.calls) === JSON.stringify(['ready', KK_LOADED]),
      kkFake.calls
    )
    // KOOK answers before the title is up: nothing is reported until the game can be played
    kkFake = kkHost()
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    await kkWait()
    const kkEarly = kkFake.calls.length
    kkSession.loadResult(true)
    kkSession.loadResult(false)
    await kkWait()
    check(
      'nothing is reported before the game is playable, and the first result is the only one sent',
      kkEarly === 1 && JSON.stringify(kkFake.calls) === JSON.stringify(['ready', KK_LOADED]),
      kkFake.calls
    )
    kkFake = kkHost()
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    kkSession.loadResult(false)
    await kkWait()
    check(
      'a failed load is reported as failed, with the resource reason code',
      kkFake.calls[1] === '{"status":"failed","reasonCode":"game_resource_failed"}' && kkFake.calls.length === 2,
      kkFake.calls
    )
    kkFake = kkHost({ capabilities: [] })
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    kkSession.loadResult(true)
    await kkWait()
    check(
      'a host without the capability is not sent a load result',
      JSON.stringify(kkFake.calls) === '["ready"]',
      kkFake.calls
    )
    // the SDK never replays this write: a report the host did not take is sent again
    kkFake = kkHost({ refuse: 2 })
    kkSession = new Kook()
    kkSession.retryMs = 10
    kkSession.start(kkFake.load, true)
    kkSession.loadResult(true)
    await kkWait(120)
    check(
      'a report the host did not take is sent again until it is taken',
      JSON.stringify(kkFake.calls) === JSON.stringify(['ready', KK_LOADED, KK_LOADED, KK_LOADED]),
      kkFake.calls
    )
    // a recovered connection: ready() again, and the same result again (the host merges repeats)
    kkFake.host.epoch = 2
    kkFake.host.connection({ state: 'recovering', epoch: 1, reason: null })
    kkFake.host.connection({ state: 'connected', epoch: 2, reason: null })
    await kkWait(60)
    check(
      'after a recovered connection it calls ready() once more and reports the same result again',
      JSON.stringify(kkFake.calls.slice(4)) === JSON.stringify(['ready', KK_LOADED]) && kkSession.state === 'ready',
      kkFake.calls
    )
    let kkClosed = 0,
      kkHidden = null
    kkSession.onClosed = () => kkClosed++
    kkSession.onVisibility = (hidden) => (kkHidden = hidden)
    kkFake.host.lifecycle({ revision: 1, visibility: 'hidden', presentation: 'embedded', status: 'active' })
    const kkHid = kkHidden
    kkFake.host.lifecycle({
      revision: 2,
      visibility: 'hidden',
      presentation: 'embedded',
      status: 'closed',
      reason: 'host_closed',
    })
    check(
      'the host hiding the game and the host closing it both reach the game',
      kkHid === true && kkClosed === 1 && kkSession.state === 'closed'
    )
    // framed by something that is not KOOK: the SDK finds no host, and that is not an error for the player
    kkSession = new Kook()
    kkSession.start(
      () =>
        Promise.resolve({
          createKookClient: () => ({
            onConnectionChanged: () => () => {},
            ready: () => Promise.reject({ code: 'BOOTSTRAP_TIMEOUT' }),
            destroy() {},
          }),
        }),
      true
    )
    kkSession.loadResult(true)
    await kkWait()
    check(
      'with no KOOK host the session is simply unavailable',
      kkSession.state === 'unavailable' && kkSession.reason === 'BOOTSTRAP_TIMEOUT' && !kkSession.can('lifecycle.leave')
    )
    const kkNoHost = await kkSession.authorize(),
      kkAlone = await kookLive.authorize()
    check(
      'outside KOOK no authorisation is ever asked for',
      kkNoHost === 'none' && kkAlone === 'none' && kookLive.auth === 'none',
      { kkNoHost, kkAlone }
    )

    // ---- signing in: session.get() with get_user_info, once, and the game goes on whatever the answer
    const kkAuthCaps = ['lifecycle.reportLoadResult', 'lifecycle.onStateChanged', 'auth.onStateChanged']
    kkFake = kkHost({ capabilities: kkAuthCaps })
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    await kkWait()
    const kkBefore = kkFake.host.asked.length,
      kkPair = [kkSession.authorize(), kkSession.authorize()],
      kkWhile = kkSession.auth,
      kkGranted = await Promise.all(kkPair),
      kkAsk = kkFake.host.asked[0] ?? {}
    check(
      'connecting does not ask for authorisation by itself',
      kkBefore === 0 && kkFake.calls.join() === 'ready',
      kkFake.calls
    )
    check(
      'signing in is one session.get() for get_user_info, with a fresh 128-bit state and the default callback',
      kkFake.host.asked.length === 1 &&
        JSON.stringify(kkAsk.scopes) === '["get_user_info"]' &&
        /^[0-9a-f]{32}$/.test(kkAsk.state) &&
        !('redirectUri' in kkAsk) &&
        kkWhile === 'asking' &&
        kkGranted.join() === 'authorized,authorized' &&
        kkSession.auth === 'authorized',
      { asked: kkFake.host.asked, kkWhile, kkGranted }
    )
    await kkSession.authorize()
    check(
      'an authorisation already given is not asked for again, and its one-time code is not kept',
      kkFake.host.asked.length === 1 && !Object.values(kkSession).some((value) => value === 'one-time-code'),
      kkFake.host.asked.length
    )
    kkFake = kkHost({ capabilities: kkAuthCaps, answer: 'cancelled' })
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    await kkWait()
    const kkDeclined = await kkSession.authorize()
    kkFake.host.answer = 'authorized'
    const kkRetried = await kkSession.authorize()
    check(
      'declining is an ordinary answer; asking again is a new request with a new state',
      kkDeclined === 'cancelled' &&
        kkRetried === 'authorized' &&
        kkFake.host.asked.length === 2 &&
        kkFake.host.asked[0].state !== kkFake.host.asked[1].state &&
        kkSession.state === 'ready',
      { kkDeclined, kkRetried }
    )
    kkFake = kkHost({ capabilities: kkAuthCaps, answer: 'error' })
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    await kkWait()
    const kkErrored = await kkSession.authorize()
    kkFake.host.answer = 'forged'
    const kkForged = await kkSession.authorize()
    check(
      'a request the host could not complete, or an answer for another request, counts as failed and nothing more',
      kkErrored === 'failed' && kkForged === 'failed' && kkSession.auth === 'failed' && kkSession.state === 'ready',
      { kkErrored, kkForged }
    )
    kkFake.host.auth({ revision: 5, status: 'revoked' })
    const kkRevoked = await kkSession.authorize()
    check(
      'once the player revokes the authorisation it is not asked for again in this launch',
      kkRevoked === 'revoked' && kkFake.host.asked.length === 2,
      { kkRevoked, asked: kkFake.host.asked.length }
    )
    // pressed before KOOK has answered the handshake: the request goes out once it has
    kkFake = kkHost({ capabilities: kkAuthCaps })
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    const kkEager = kkSession.authorize(),
      kkEagerAsked = kkFake.host.asked.length
    check(
      'a press during the handshake asks as soon as KOOK is ready',
      kkEagerAsked === 0 && (await kkEager) === 'authorized' && kkFake.host.asked.length === 1,
      { kkEagerAsked, asked: kkFake.host.asked.length }
    )
    // a consent the host already holds is reported without a request, and the sign-in call is still made
    kkFake = kkHost({ capabilities: kkAuthCaps })
    kkSession = new Kook()
    kkSession.start(kkFake.load, true)
    await kkWait()
    kkFake.host.auth({ revision: 1, status: 'authorized', scopes: ['get_user_info'] })
    const kkHeld = kkSession.auth
    await kkSession.authorize()
    check(
      "the host's own word on a standing consent is followed, and signing in still goes through session.get()",
      kkHeld === 'authorized' && kkFake.host.asked.length === 1 && kkSession.auth === 'authorized',
      { kkHeld, asked: kkFake.host.asked.length }
    )

    const originalAudio = window.AudioContext,
      originalElement = window.Audio
    let audioContexts = 0
    window.AudioContext = class {
      constructor() {
        audioContexts++
      }
    }
    const silent = new Sfx()
    silent.unlock()
    silent.startMusic()
    silent.play('clear')
    silent.muffle(1)
    silent.stopMusic()
    check('scripted runs stay silent and open no audio', audioContexts === 0 && silent.state === 'none')

    // Outside scripted runs the same class plays: watch what it does through a stand-in context.
    const { SFX_NAMES } = await import('/src/audio/sfx.ts')
    const param = (value = 0) => ({
      value,
      target: value,
      cancelScheduledValues() {},
      setTargetAtTime(target) {
        this.target = target
      },
    })
    const node = (extra = {}) => ({
      connect: (next) => next,
      disconnect() {},
      gain: param(1),
      frequency: param(0),
      Q: param(0),
      threshold: param(0),
      knee: param(0),
      ratio: param(0),
      attack: param(0),
      release: param(0),
      ...extra,
    })
    const heard = [],
      gains = [],
      lowpass = [],
      tracks = []
    let fake = null
    window.AudioContext = class {
      constructor() {
        audioContexts++
        fake = this
        this.state = 'running'
        this.currentTime = 10
        this.destination = node()
      }
      resume() {
        return Promise.resolve()
      }
      createDynamicsCompressor() {
        return node()
      }
      createGain() {
        const made = node()
        gains.push(made)
        return made
      }
      createBiquadFilter() {
        const made = node()
        lowpass.push(made)
        return made
      }
      createMediaElementSource() {
        return node()
      }
      createBufferSource() {
        const made = node({
          playbackRate: param(1),
          start: (when, offset) => heard.push({ name: made.buffer.name, offset, rate: made.playbackRate.value }),
        })
        return made
      }
      decodeAudioData(bytes) {
        // twenty samples of silence, then signal: the lead the player must skip
        const data = new Float32Array(4410).fill(0.5)
        data.fill(0, 0, 441)
        return Promise.resolve({ bytes: bytes.byteLength, sampleRate: 44100, getChannelData: () => data })
      }
    }
    window.Audio = class {
      constructor(url) {
        this.url = url
        this.paused = true
        this.currentTime = 0
        this.readyState = 4
        this.error = null
        tracks.push(this)
      }
      play() {
        this.paused = false
        return Promise.resolve()
      }
      pause() {
        this.paused = true
      }
    }
    localStorage.removeItem('vanta.muted')
    const live = new Sfx(true)
    live.play('clear')
    check('nothing is opened before the first press', audioContexts === 0 && live.state === 'none')
    live.unlock()
    live.unlock()
    // later instances open contexts of their own; this is the one under test
    const liveContext = fake,
      decoded = await live.whenReady()
    check(
      'the first press opens one context and decodes the effects in use',
      audioContexts === 1 && decoded === SFX_NAMES.length && live.ready === SFX_NAMES.length,
      { audioContexts, decoded, expected: SFX_NAMES.length }
    )
    for (const [name, sound] of live.sounds) sound.buffer.name = name
    live.play('clear')
    live.play('clear')
    live.play('hit')
    live.play('exBoom')
    check(
      'the area-clear cue plays past its silent lead; a repeat in the same instant and cues without a sound do not',
      heard.length === 1 &&
        heard[0].name === 'clear' &&
        Math.abs(heard[0].offset - (441 / 44100 - 0.002)) < 1e-6 &&
        heard[0].rate === 1,
      heard
    )
    liveContext.currentTime += 0.2
    live.play('clear')
    check('the same sound plays again once its gap has passed', heard.length === 2 && heard[1].name === 'clear')
    live.startMusic()
    const music = gains[2]
    check(
      'music streams from one looping element and fades in',
      tracks.length === 1 &&
        tracks[0].url.endsWith('audio/bgm1.mp3') &&
        tracks[0].loop &&
        live.musicPlaying &&
        music.gain.target > 0.3,
      { tracks: tracks.length, target: music.gain.target }
    )
    const open = { gain: music.gain.target, tone: lowpass[0].frequency.target }
    live.muffle(1)
    check(
      'muffling rolls the music off and lowers it without stopping it',
      lowpass[0].frequency.target < 1000 &&
        open.tone > 15000 &&
        music.gain.target < open.gain &&
        music.gain.target > 0 &&
        live.musicPlaying,
      { open, tone: lowpass[0].frequency.target, gain: music.gain.target }
    )
    live.muffle(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }))
    liveContext.currentTime += 0.2
    live.play('clear')
    check(
      'M mutes everything and the choice is remembered',
      live.muted && heard.length === 2 && gains[0].gain.target === 0 && localStorage.getItem('vanta.muted') === '1',
      { muted: live.muted, heard: heard.length, master: gains[0].gain.target }
    )
    check('a later visit starts muted', new Sfx(true).muted)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }))
    liveContext.currentTime += 0.2
    live.play('clear')
    check('M again restores the sound', !live.muted && heard.length === 3 && gains[0].gain.target > 0.5)
    live.stopMusic()
    check('stopping fades the music to silence', music.gain.target === 0)
    liveContext.state = 'suspended'
    liveContext.currentTime += 1
    live.openedAt = -1e9
    live.play('clear')
    check('a context that is not running does not queue sounds', heard.length === 3)
    // a browser that has seen no press leaves the resume pending: asking again must not stack requests
    let resumes = 0
    liveContext.resume = () => {
      resumes++
      return new Promise(() => {})
    }
    for (let i = 0; i < 30; i++) live.unlock()
    check('a refused resume is asked for once, not on every press', resumes === 1, resumes)
    localStorage.removeItem('vanta.muted')
    window.AudioContext = originalAudio
    window.Audio = originalElement

    // The packed files themselves: every one must decode in a real browser, and start promptly.
    const real = new originalAudio(),
      files = []
    for (const name of SFX_NAMES) {
      const response = await fetch(`/audio/sfx/${name}.mp3`),
        buffer = response.ok ? await real.decodeAudioData(await response.arrayBuffer()).catch(() => null) : null,
        data = buffer?.getChannelData(0)
      let first = 0
      while (data && first < data.length && Math.abs(data[first]) < 0.004) first++
      files.push({ name, seconds: buffer?.duration ?? 0, lead: buffer ? first / buffer.sampleRate : -1 })
    }
    await real.close()
    check(
      'the packed effect decodes, is short, and has little dead air at its start',
      files.every((file) => file.seconds > 0.05 && file.seconds < 1.8 && file.lead >= 0 && file.lead < 0.08),
      files.filter((file) => !(file.seconds > 0.05 && file.seconds < 1.8 && file.lead >= 0 && file.lead < 0.08))
    )
    const pieces = []
    for (const name of ['bgm1', 'bgm2']) {
      const head = await fetch(`/audio/${name}.mp3`, { method: 'HEAD' })
      pieces.push(head.ok ? Number(head.headers.get('content-length')) : 0)
    }
    check(
      'each stage has its own piece of music, and both are served',
      pieces.every((bytes) => bytes > 1e6),
      pieces
    )
    live.startMusic('bgm2')
    check(
      "asking for another stage's music points the same element at it",
      tracks.length === 1 && tracks[0].src.endsWith('audio/bgm2.mp3'),
      tracks[0].src
    )
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    'combat presentation revision regression'
  )
}
