import * as Phaser from 'phaser'

import { Actor, HitDef, World } from './actor'
import { KeyHint } from './keyHint'

import { A, Anim } from '../art/anims'
import { Tail } from '../art/tail'
import type { SfxName } from '../audio/sfx'
import { COL, DEPTH, GROUND_Y } from '../config'
import { approach, clamp, rand, randRange } from '../core/util'

const H = (dmg: number, kx: number, ky: number, extra: Partial<HitDef> = {}): HitDef => ({
  dmg,
  kx,
  ky,
  stun: 22,
  stop: 6,
  shake: 7,
  ...extra,
})

interface Atk {
  wind: Anim
  windLen: number
  strike: Anim
  len: number
  hits: { from: number; to: number; box: [number, number, number, number]; hit: HitDef }[]
  step?: [number, number, number]
  /** slash effect, drawn at chest height in front of the body */
  fx?: { at: number; key: string; rot: number; scale: number; flipY?: boolean; sy?: number }
  ghost?: boolean
  shock?: number
  sfx?: SfxName
  /** power attack: long, clearly readable wind-up with a gathering glow and a marked danger zone */
  charge?: boolean
}

const ATK: Record<string, Atk> = {
  // stage 2's skirmisher: one long, clearly telegraphed lunge from well outside sword reach
  lancerLunge: {
    charge: true,
    wind: A.windThrust,
    windLen: 34,
    strike: A.strikeThrust,
    len: 36,
    step: [1, 13, 1500],
    hits: [{ from: 2, to: 14, box: [9, -154, 250, 88], hit: H(13, 480, -120) }],
    fx: { at: 2, key: 'cut', rot: 0, scale: 1.05 },
  },
  gruntOver: {
    wind: A.windOver,
    windLen: 24,
    strike: A.strikeOver,
    len: 28,
    step: [1, 5, 380],
    hits: [{ from: 4, to: 8, box: [0, -220, 202, 229], hit: H(9, 320, 0) }],
    fx: { at: 4, key: 'slash', rot: 0.15, scale: 0.77 },
  },
  gruntThrust: {
    charge: true,
    wind: A.windThrust,
    windLen: 38,
    strike: A.strikeThrust,
    len: 32,
    step: [1, 10, 1050],
    hits: [{ from: 2, to: 11, box: [9, -154, 220, 88], hit: H(11, 440, -120) }],
    fx: { at: 2, key: 'cut', rot: 0, scale: 0.88 },
  },
  heavySlam: {
    charge: true,
    wind: A.windSlam,
    windLen: 54,
    strike: A.strikeSlam,
    len: 48,
    shock: 6,
    sfx: 'slam',
    hits: [{ from: 6, to: 10, box: [0, -264, 299, 273], hit: H(20, 580, -560, { stun: 28, stop: 9, shake: 12 }) }],
    fx: { at: 5, key: 'slash_wide', rot: 0.5, scale: 1.23 },
  },
  heavySweep: {
    charge: true,
    wind: A.windSweep,
    windLen: 42,
    strike: A.strikeSweep,
    len: 34,
    step: [1, 6, 320],
    hits: [{ from: 4, to: 9, box: [-97, -211, 414, 194], hit: H(15, 540, -220) }],
    fx: { at: 4, key: 'slash_wide', rot: 0, scale: 1.5, sy: 0.32 },
  },
  bossOver: {
    wind: A.windOver,
    windLen: 18,
    strike: A.strikeOver,
    len: 20,
    step: [1, 6, 620],
    hits: [{ from: 4, to: 8, box: [0, -387, 378, 396], hit: H(12, 380, 0) }],
    fx: { at: 4, key: 'slash', rot: 0.15, scale: 1.54 },
  },
  bossRise: {
    wind: A.windRise,
    windLen: 9,
    strike: A.strikeRise,
    len: 20,
    step: [1, 6, 560],
    hits: [{ from: 4, to: 8, box: [0, -405, 378, 414], hit: H(12, 300, -420) }],
    fx: { at: 4, key: 'slash', rot: -0.1, scale: 1.54, flipY: true },
  },
  bossSweep: {
    charge: true,
    wind: A.windSweep,
    windLen: 30,
    strike: A.strikeSweep,
    len: 38,
    step: [1, 7, 700],
    hits: [{ from: 4, to: 9, box: [-176, -317, 686, 299], hit: H(17, 660, -440, { stun: 28, stop: 9, shake: 12 }) }],
    fx: { at: 4, key: 'slash_wide', rot: 0, scale: 2.38, sy: 0.3 },
  },
  bossDash: {
    charge: true,
    wind: A.windThrust,
    windLen: 46,
    strike: A.strikeThrust,
    len: 42,
    step: [1, 18, 1900],
    ghost: true,
    hits: [{ from: 1, to: 19, box: [0, -264, 317, 194], hit: H(18, 640, -320, { stun: 28, stop: 9, shake: 12 }) }],
    fx: { at: 1, key: 'cut', rot: 0, scale: 1.94 },
  },
}

export abstract class Enemy extends Actor {
  lives = 1
  maxLives = 1
  anchorUsed = false
  armored = false
  cd = 60
  speed = 200
  protected stun = 0
  protected atk: Atk | null = null
  protected hitSet = new Set<Actor>()
  private marker: Phaser.GameObjects.Image | null = null
  private anchorMarker: Phaser.GameObjects.Image | null = null
  private execKey: KeyHint | null = null
  private anchorKey: KeyHint | null = null
  /** Large frames sink to one knee while dying; regular frames reel, then sway on their feet. */
  protected kneels = false
  /** 0 standing .. 1 down on one knee; lowers everything that is placed relative to the body */
  private crouch = 0
  /** The exposed core: a small hot point with an anamorphic streak, worn on the body while dying. */
  private breakLight: Phaser.GameObjects.Image[] = []
  private pulse = 0
  private bar: Phaser.GameObjects.Rectangle[] = []
  protected side = rand() < 0.5 ? -1 : 1
  protected jitter = randRange(-40, 60)
  kind = 'grunt'
  /** How much more damage a dying body soaks up before it falls without an execution. */
  private guard = 0
  /** A training target: it stands its ground, watches the player and never attacks. */
  passive = false
  /** attack boxes and slash effects are authored for a regular frame; bigger frames reusing them scale up */
  atkScale = 1

  constructor(world: World, kind: string, skin: string, x: number, y: number) {
    super(world)
    this.kind = kind
    this.team = 1
    this.x = this.px = x
    this.y = this.py = y
    this.initBody(skin, DEPTH.enemy)
    this.set('spawn')
    this.facing = world.player.x < x ? -1 : 1
    this.an.play(A.eIdle, 0, true)
    this.applyPose(this.an.update(0))
    this.rig.setAlpha(0)
    world.fx.pillar(x, y, COL.hostile, 700, 0.5, 1.2)
    world.fx.ring(x, y, COL.hostile, 30, 200, 0.4, 0.25)
  }

  get p() {
    return this.world.player
  }
  get dx() {
    return this.p.x - this.x
  }
  /** Empty health is a living, executable state until another hit or an execution. */
  get dying() {
    return this.state === 'dying' && !this.dead
  }
  /** Where the body's core is drawn; it drops and leans forward as a large frame kneels. */
  get coreX() {
    return this.x + this.facing * this.h * 0.07 * this.crouch
  }
  get coreY() {
    return this.cy + this.h * 0.17 * this.crouch
  }
  /** Height of the head above the feet, for markers and bars. */
  private get top() {
    return this.h * (1 - 0.36 * this.crouch)
  }
  face() {
    if (Math.abs(this.dx) > 12) this.facing = this.dx > 0 ? 1 : -1
  }

  update() {
    this.rig.setPos(this.x, this.y, this.facing)
    if (this.invuln > 0) this.invuln--
    if (this.flashT > 0) this.flashT--
    this.st++
    this.crouch = approach(this.crouch, this.dying && this.kneels && this.onGround ? 1 : 0, 0.045)
    this.rig.rest = this.crouch
    switch (this.state) {
      case 'spawn':
        this.rig.setAlpha(Math.min(1, this.st / 24))
        if (this.st >= 34) {
          this.rig.setAlpha(1)
          this.set('idle')
        }
        break
      case 'hurt':
        this.vx = approach(this.vx, 0, this.flying ? 14 : 22)
        if (this.flying) this.vy = approach(this.vy, 0, 14)
        this.an.play(A.hurt, 3)
        if (!this.flying && !this.onGround) this.set('launched')
        else if (this.st >= this.stun) this.set('idle')
        break
      case 'launched':
        this.gravity = 0.82
        this.an.play(A.launched, 4)
        this.vx = approach(this.vx, 0, 5)
        break
      case 'down':
        this.vx = approach(this.vx, 0, 30)
        this.an.play(A.down, 4)
        if (this.st >= 34) {
          this.set('getup')
          this.an.play(A.getup, 3, true)
        }
        break
      case 'getup':
        this.vx = approach(this.vx, 0, 30)
        if (this.st >= 22) this.set('idle')
        break
      case 'dying':
        this.vx = approach(this.vx, 0, 26)
        this.an.play(
          !(this.onGround || this.flying) ? A.launched : this.kneels ? A.kneel : this.st < 32 ? A.reel : A.stun,
          6
        )
        if (this.flying) this.vy = approach(this.vy, 0, 20)
        // The frame keeps shorting out: arcs crawl over the body between showers of sparks.
        if (this.st % 11 === 0)
          this.world.fx.arc(
            this.coreX + randRange(-0.3, 0.3) * this.w,
            this.coreY + randRange(-0.28, 0.26) * this.h * (1 - 0.4 * this.crouch),
            0.22 + this.h / 1100,
            rand() < 0.3 ? COL.cyan : COL.pink
          )
        if (this.st % 14 === 0)
          this.world.fx.spark(
            this.coreX + randRange(-30, 30),
            this.coreY + randRange(-60, 40),
            rand() * 6.28,
            2,
            COL.main,
            0.4,
            3
          )
        break
      case 'reviving':
        this.vx = approach(this.vx, 0, 22)
        this.an.play(this.st < 30 ? A.down : A.getup, 4)
        if (this.st >= 60) this.revive()
        break
      case 'dead':
        this.vx = approach(this.vx, 0, 20)
        this.an.play(A.die, 3)
        this.rig.setAlpha(Math.max(0, 1 - this.st / 20))
        if (this.st >= 20) this.destroy()
        break
      case 'wind':
        this.windUp()
        break
      case 'strike':
        this.strike()
        break
      default:
        if (this.cd > 0) this.cd--
        if (this.passive) {
          this.vx = approach(this.vx, 0, 30)
          if (this.flying) this.vy = approach(this.vy, 0, 30)
          this.face()
          this.an.play(A.eIdle, 6)
        } else this.ai()
    }
    if (this.gone) return
    this.physics()
    this.gravity = 1
    this.applyPose(this.an.update(1))
  }

  protected abstract ai(): void

  protected onLand(v: number) {
    if (this.state === 'launched') {
      this.set('down')
      this.world.fx.dust(this.x, this.y, 0, 5)
      if (v > 1200) {
        this.world.shake(4)
        this.world.sfx.play('land')
      }
    }
  }

  /* ----------------------------- shared attack runner ----------------------------- */

  /** How far forward the given attack reaches, including the lunge. */
  private reachOf(a: Atk) {
    return (
      a.hits.reduce((m, h) => Math.max(m, (h.box[0] + h.box[2]) * this.atkScale), 0) +
      (a.step ? (a.step[2] * (a.step[1] - a.step[0] + 1)) / 60 : 0)
    )
  }

  protected begin(name: string) {
    this.atk = ATK[name]
    this.set('wind')
    this.face()
    this.an.play(this.atk.wind, 4, true)
    this.telegraph()
  }
  protected telegraph() {
    this.world.fx.icon('warn', this.x, this.y - this.h - 46, 0.5, 0.7)
    this.world.fx.glint(
      this.rig.wx(this.rig.hand.x),
      this.rig.wy(this.rig.hand.y),
      COL.hostile,
      0.5 + this.h / 600,
      0.3
    )
    this.world.sfx.play('warn')
  }
  private windUp() {
    const a = this.atk!
    this.vx = approach(this.vx, 0, 30)
    if (this.st < a.windLen * 0.6) this.face()
    if (a.charge) {
      const fx = this.world.fx,
        hx = this.rig.wx(this.rig.tip.x),
        hy = this.rig.wy(this.rig.tip.y),
        k = this.st / a.windLen
      if (this.st === 2) {
        // mark where it will land
        fx.beam(
          this.x,
          this.y - 5,
          this.x + this.facing * this.reachOf(a),
          this.y - 5,
          COL.hostile,
          a.windLen / 60,
          0.5
        )
      }
      // energy drawn in along the weapon, tightening as the swing nears
      if (this.st % 3 === 0) {
        const an = rand() * 6.28,
          d = 110 * (1.2 - k)
        fx.spark(hx + Math.cos(an) * d, hy + Math.sin(an) * d, an + Math.PI, 1, COL.hostile, 0.3, 0.1)
      }
      if (this.st % 8 === 0) fx.flash(hx, hy, COL.hostile, 0.3 + k * 0.5, 0.14)
      if (this.st === a.windLen - 8) {
        fx.glint(hx, hy, COL.hostileHot, 0.7, 0.14)
        this.world.sfx.play('warn')
      }
    }
    if (this.st >= a.windLen) {
      this.set('strike')
      this.hitSet.clear()
      this.an.play(a.strike, 1, true)
    }
  }
  private strike() {
    const a = this.atk!,
      f = this.st,
      fx = this.world.fx
    if (a.step && f >= a.step[0] && f <= a.step[1]) this.vx = this.facing * a.step[2]
    else this.vx = approach(this.vx, 0, 60)
    if (a.fx && a.fx.at === f) {
      const e = a.fx,
        k = this.atkScale,
        y = this.y - this.h * 0.66
      if (e.key === 'cut')
        fx.cut(this.x + this.facing * 170 * e.scale * k, y, 0, 480 * e.scale * k, COL.hostile, 0.22, 1.4)
      else
        fx.slash(this.x + this.facing * this.w * 0.35, y, e.key, e.rot, e.scale * k, this.facing, COL.hostile, {
          flipY: e.flipY,
          sy: e.sy,
          life: 0.24,
        })
      this.world.sfx.play(a.sfx ?? 'swingHeavy')
    }
    if (a.ghost && f % 2 === 0 && f < 20) fx.ghost(this.rig, COL.hostile, 0.5, 0.25)
    const k = this.atkScale
    for (const h of a.hits)
      if (f >= h.from && f <= h.to)
        this.world.attack(this, this.fbox(h.box[0] * k, h.box[1] * k, h.box[2] * k, h.box[3] * k), h.hit, this.hitSet)
    if (a.shock && f === a.shock) this.groundShock(this.x + this.facing * 195 * k, this.kind === 'titan' ? 2 : 1)
    if (f >= a.len) this.endAttack()
  }
  protected groundShock(x: number, waves: number) {
    const fx = this.world.fx
    fx.ring(x, this.y, COL.hostile, 40, 320, 0.36, 0.26)
    fx.dust(x, this.y, 1, 6)
    fx.dust(x, this.y, -1, 6)
    fx.spark(x, this.y, -Math.PI / 2, 10, COL.hostile, 0.8, 1.3)
    this.world.shake(10, 0.03)
    if (waves >= 1)
      this.world.spawnProj({
        kind: 'shock',
        x,
        y: this.y,
        vx: this.facing * 760,
        vy: 0,
        team: 1,
        dmg: 12,
        w: 80,
        h: 70,
        life: 46,
        owner: this,
      })
    if (waves >= 2)
      this.world.spawnProj({
        kind: 'shock',
        x,
        y: this.y,
        vx: -this.facing * 760,
        vy: 0,
        team: 1,
        dmg: 12,
        w: 80,
        h: 70,
        life: 46,
        owner: this,
      })
  }
  protected endAttack() {
    this.atk = null
    this.world.releaseToken(this)
    this.cd = randRange(70, 130)
    this.set('idle')
  }

  /* ----------------------------- dodge window ----------------------------- */

  /** True while this enemy has an attack about to land on (or already sweeping through) the given actor. */
  threatens(p: Actor): boolean {
    if (this.dead || this.dying) return false
    const a = this.atk
    if (!a) return false
    const last = a.hits.reduce((m, h) => Math.max(m, h.to), 0)
    const live = (this.state === 'wind' && this.st >= a.windLen - 11) || (this.state === 'strike' && this.st <= last)
    if (!live) return false
    const back = a.hits.reduce((m, h) => Math.min(m, h.box[0] * this.atkScale), 0)
    const dx = (p.x - this.x) * this.facing
    return dx > back - 70 && dx < this.reachOf(a) + 70 && Math.abs(p.y - this.y) < 250 * this.atkScale
  }
  /** The actor slipped this attack: it can no longer be hit by the current swing. */
  negate(p: Actor) {
    this.hitSet.add(p)
  }

  /* ----------------------------- damage ----------------------------- */

  takeHit(hit: HitDef, src: Actor | null, dir: number): boolean {
    if (this.dead || this.state === 'spawn' || this.state === 'reviving' || this.invuln > 0) return false
    const damage = hit.dmg * (src === this.world.player ? (hit.multiplier ?? this.world.player.damageMultiplier) : 1)
    if (damage <= 0) return false
    if (this.dying) {
      // Hard to finish by accident: stray hits wear the guard down, and only a dodge slash ends it at once.
      this.flashT = 4
      this.guard -= damage
      if (hit.finish || this.guard <= 0) this.die(false, dir)
      return true
    }
    const directKill = this.lives === 1 && damage >= this.maxHp * 2
    this.hp = Math.max(0, this.hp - damage)
    this.flashT = 4
    if (directKill) {
      this.die(false, dir)
      return true
    }
    if (this.hp === 0) {
      // A finishing hit defeats on the spot (a body with lives left is floored and loses one); others leave it dying.
      if (hit.finish) this.die(false, dir)
      else this.enterDying()
      return true
    }
    if (this.armored) {
      this.vx += dir * hit.kx * 0.1
      return true
    }
    this.interrupt()
    this.facing = -dir as 1 | -1
    this.stun = hit.stagger ?? hit.stun
    if (hit.stagger) {
      // held reeling where it stands: not thrown, and hardly moved
      this.vx = dir * Math.min(hit.kx, 150)
      if (this.flying) this.vy = 0
      if (this.flying || this.onGround) this.set('hurt')
      else {
        this.vy = Math.max(this.vy, -160)
        this.set('launched')
      }
      return true
    }
    if (this.flying) {
      this.vx = dir * hit.kx * 0.8
      this.vy = clamp(hit.ky * 0.35, -420, 420)
      this.set('hurt')
      return true
    }
    this.vx = dir * hit.kx
    if (hit.ky < 0) {
      this.vy = hit.ky
      this.onGround = false
      this.set('launched')
    } else if (!this.onGround) {
      this.vy = hit.spike ? hit.ky : -280
      this.set('launched')
    } else if (this.state === 'down') {
      this.vy = -420
      this.onGround = false
      this.set('launched')
    } else this.set('hurt')
    return true
  }
  protected interrupt() {
    this.atk = null
    this.world.releaseToken(this)
  }

  holdForCounter() {
    this.interrupt()
    this.vx = this.vy = 0
    this.cd = Math.max(this.cd, 45)
    if (!this.dying) {
      this.set('hurt')
      this.stun = 20
    }
  }

  private enterDying() {
    const fx = this.world.fx
    this.interrupt()
    this.set('dying')
    this.guard = Math.max(80, this.maxHp)
    this.vx *= 0.2
    fx.ring(this.cx, this.cy, COL.main, 30, 260, 0.4)
    fx.ring(this.cx, this.cy, COL.pinkDeep, 20, 150 + this.h * 0.5, 0.3)
    fx.shards(this.cx, this.cy, 10, COL.main, 0.7)
    fx.glint(this.cx, this.cy, COL.pinkDeep, 0.9, 0.3)
    for (let i = 0; i < 3; i++)
      fx.arc(this.cx + randRange(-0.3, 0.3) * this.w, this.cy + randRange(-0.3, 0.3) * this.h, 0.3 + this.h / 850)
    this.world.sfx.play('break')
  }

  /** Result of an execution. */
  executed(dir: number) {
    if (this.dead || this.state === 'reviving') return
    this.hp = 0
    this.die(true, dir)
  }

  die(executed: boolean, dir: number) {
    if (this.dead || this.state === 'reviving') return
    const fx = this.world.fx
    this.hp = 0
    this.interrupt()
    this.vx = dir * 260
    this.flashT = 6
    this.lives = Math.max(0, this.lives - 1)
    if (this.lives > 0) {
      this.set('reviving')
      this.invuln = 999
      this.an.play(A.down, 2, true)
      this.world.sfx.play('die')
      return
    }
    this.dead = true
    this.set('dead')
    // an execution brings its own light show; a plain kill gets a compact burst
    if (!executed) {
      fx.shards(this.cx, this.cy, 14, COL.hostile, 0.9)
      fx.weld(this.cx, this.cy, -Math.PI / 2, 26, 1.1, this.groundBelow(), 3.2)
      fx.flash(this.cx, this.cy, COL.hostileHot, 0.8, 0.16)
      fx.ring(this.cx, this.cy, COL.hostile, 30, 240, 0.35)
    }
    this.world.sfx.play('die')
    this.world.onEnemyDead(this, executed)
  }

  protected revive() {
    this.hp = this.maxHp
    this.invuln = 45
    this.vx = this.vy = 0
    this.cd = 60
    this.set('idle')
    this.rig.setAlpha(1)
    this.world.fx.flash(this.cx, this.cy, COL.hostileHot, 0.65, 0.22)
  }

  render(alpha: number, time: number) {
    this.pulse = time
    super.render(alpha, time)
    const show = this.dying && !this.p.cine
    this.renderBreakLight(show, time)
    const anchored =
      this.p.overloaded &&
      !this.p.cine &&
      !this.anchorUsed &&
      !this.dead &&
      this.state !== 'spawn' &&
      this.state !== 'reviving'
    const paired = show && anchored
    const markerY = this.ry - this.top - 100
    if (show) {
      this.marker ??= this.world.stage.add
        .image(0, 0, 'marker')
        .setDepth(DEPTH.frontFx + 2)
        .setBlendMode(Phaser.BlendModes.ADD)
      const pulse = 0.5 + Math.sin(time * 10) * 0.06
      const selected = this.world.executionTarget === this
      this.marker
        .setVisible(true)
        .setPosition(this.rx - (paired ? 38 : 0), markerY)
        .setScale(pulse * (this.h > 250 ? 1.35 : 1))
        .setRotation(time * 1.5)
        .setAlpha(selected ? 1 : 0.55)
      this.execKey ??= new KeyHint(this.world.stage, 'L', COL.pink)
      this.execKey.setVisible(selected).setPosition(this.marker.x, markerY + 48)
    } else this.marker?.setVisible(false)
    if (!show) this.execKey?.setVisible(false)
    if (anchored) {
      const selected = this.world.anchor?.target === this
      this.anchorMarker ??= this.world.stage.add
        .image(0, 0, 'anchor')
        .setDepth(DEPTH.frontFx + 1)
        .setBlendMode(Phaser.BlendModes.ADD)
      this.anchorMarker
        .setVisible(true)
        .setPosition(this.rx + (paired ? 38 : 0), markerY)
        .setScale(selected ? 0.76 : 0.48)
        .setAlpha(selected ? 1 : 0.55)
        .setTint(selected ? COL.pink : COL.cyan)
        .setRotation(time * (selected ? 1.4 : 0.4))
      this.anchorKey ??= new KeyHint(this.world.stage, 'O', COL.cyan)
      this.anchorKey.setVisible(selected).setPosition(this.anchorMarker.x, markerY + 48)
    } else this.anchorMarker?.setVisible(false)
    if (!anchored) this.anchorKey?.setVisible(false)
    // Only health is shown; execution eligibility follows empty health.
    if (!this.isBoss) {
      const vis = !this.dead && this.hp < this.maxHp && this.state !== 'spawn'
      if (vis && !this.bar.length) {
        const s = this.world.stage
        this.bar = [
          s.add.rectangle(0, 0, 84, 7, 0x05070c, 0.8),
          s.add.rectangle(0, 0, 80, 3, COL.hostile).setOrigin(0, 0.5),
        ]
        this.bar.forEach((b) => b.setDepth(DEPTH.frontFx + 1))
      }
      if (this.bar.length) {
        const x = this.rx,
          y = this.ry - this.top - 22
        this.bar[0].setPosition(x, y + 1).setVisible(vis)
        this.bar[1]
          .setPosition(x - 40, y)
          .setVisible(vis)
          .setScale(clamp(this.hp / this.maxHp, 0, 1), 1)
      }
    }
  }
  /** The body itself glows and throbs in the execution colour while it can be finished. */
  protected dyingTint() {
    this.rig.setTintMul(COL.pinkDeep, 0.035 + 0.075 * (0.5 + 0.5 * Math.sin(this.pulse * 8.5)))
  }
  protected applyTint() {
    if (this.dying) this.dyingTint()
    else this.rig.setFlash(null)
  }

  /** The mark worn on the body: a flickering hot point at the core, crossed by a thin lens streak. */
  private renderBreakLight(show: boolean, time: number) {
    if (!show) {
      for (const im of this.breakLight) im.setVisible(false)
      return
    }
    if (!this.breakLight.length) {
      const add = this.world.stage.add
      this.breakLight = [
        add.image(0, 0, 'glow').setTint(COL.pinkDeep),
        add.image(0, 0, 'cut').setTint(COL.pink),
        add.image(0, 0, 'glow'),
      ]
      this.breakLight.forEach((im, i) =>
        im.setDepth(DEPTH.frontFx + 0.5 + i * 0.01).setBlendMode(Phaser.BlendModes.ADD)
      )
    }
    const [halo, streak, hot] = this.breakLight,
      size = 0.55 + this.h / 520,
      throb = 0.5 + 0.5 * Math.sin(time * 8.5),
      // an unstable supply: mostly steady, with brief dips
      flicker = 0.82 + 0.18 * Math.sin(time * 47) * Math.sin(time * 13.7),
      x = this.rx + (this.coreX - this.x),
      y = this.ry + (this.coreY - this.y)
    halo
      .setVisible(true)
      .setPosition(x, y)
      .setScale(size * (0.62 + 0.2 * throb))
      .setAlpha(0.75 * flicker)
    streak
      .setVisible(true)
      .setPosition(x, y)
      .setScale(size * (0.3 + 0.16 * throb), 0.55 * flicker)
      .setAlpha(0.9 * flicker)
    hot
      .setVisible(true)
      .setPosition(x, y)
      .setScale(size * (0.16 + 0.05 * throb))
      .setAlpha(flicker)
  }

  destroy() {
    for (const im of this.breakLight) im.destroy()
    super.destroy()
    this.marker?.destroy()
    this.anchorMarker?.destroy()
    this.execKey?.destroy()
    this.anchorKey?.destroy()
    this.bar.forEach((b) => b.destroy())
  }

  /** Shared ground locomotion: close in to `range`, hang back when not allowed to attack. */
  protected approachPlayer(range: number, run: Anim, hasToken: boolean) {
    const adx = Math.abs(this.dx),
      dir = Math.sign(this.dx) || 1
    this.face()
    const want = range + this.jitter + (hasToken ? 0 : 150)
    if (adx > want + 30) {
      this.vx = approach(this.vx, dir * this.speed, 30)
      this.an.play(run, 6)
    } else if (adx < want - 70) {
      this.vx = approach(this.vx, -dir * this.speed * 0.6, 30)
      this.an.play(A.eWalk, 6)
    } else {
      this.vx = approach(this.vx, 0, 30)
      this.an.play(A.eIdle, 6)
    }
  }
}

/* ---------------------------------- grunt ---------------------------------- */

export class Grunt extends Enemy {
  constructor(world: World, x: number, y = GROUND_Y) {
    super(world, 'grunt', 'grunt', x, y)
    this.maxHp = this.hp = 70
    this.speed = 250
    this.cd = randRange(30, 90)
  }
  protected ai() {
    const adx = Math.abs(this.dx),
      near = Math.abs(this.p.y - this.y) < 200
    this.approachPlayer(150, A.eRun, this.cd <= 0)
    if (this.cd <= 0 && near && adx < 330 && this.world.takeToken(this, false))
      this.begin(adx > 210 || rand() < 0.35 ? 'gruntThrust' : 'gruntOver')
  }
}

/* ---------------------------------- gunner ---------------------------------- */

export class Gunner extends Enemy {
  private ang = 0
  constructor(world: World, x: number, y = GROUND_Y) {
    super(world, 'gunner', 'gunner', x, y)
    this.maxHp = this.hp = 48
    this.speed = 210
    this.cd = randRange(50, 120)
  }
  protected ai() {
    const adx = Math.abs(this.dx),
      dir = Math.sign(this.dx) || 1,
      b = this.world.bounds
    if (this.state === 'aim') {
      this.vx = approach(this.vx, 0, 30)
      if (this.st === 1) {
        this.face()
        this.an.play(A.aim, 4, true)
        this.world.sfx.play('warn')
        this.world.fx.icon('warn', this.x, this.y - this.h - 46, 0.5, 0.7)
      }
      if (this.st === 16) {
        const mx = this.rig.wx(this.rig.tip.x),
          my = this.rig.wy(this.rig.tip.y)
        this.ang = Math.atan2(this.p.cy - my, this.p.x - mx)
        this.ang =
          this.facing > 0
            ? clamp(this.ang, -0.7, 0.7)
            : Math.abs(this.ang) < Math.PI - 0.7
              ? Math.sign(this.ang || 1) * (Math.PI - 0.7)
              : this.ang
        this.world.fx.beam(
          mx,
          my,
          mx + Math.cos(this.ang) * 1500,
          my + Math.sin(this.ang) * 1500,
          COL.hostile,
          0.36,
          0.3
        )
      }
      if (this.st >= 38) this.set('fire')
      return
    }
    if (this.state === 'fire') {
      if (this.st % 8 === 1 && this.st < 24) {
        const mx = this.rig.wx(this.rig.tip.x),
          my = this.rig.wy(this.rig.tip.y)
        this.world.spawnProj({
          kind: 'bolt',
          x: mx,
          y: my,
          vx: Math.cos(this.ang) * 1050,
          vy: Math.sin(this.ang) * 1050,
          team: 1,
          dmg: 7,
          w: 26,
          h: 26,
          life: 110,
          owner: this,
        })
        this.world.fx.flash(mx, my, COL.hostile, 0.9, 0.1)
        this.an.play(A.shoot, 0, true)
        this.world.sfx.play('shoot')
      }
      if (this.st >= 36) {
        this.world.releaseToken(this)
        this.cd = randRange(100, 170)
        this.set('idle')
      }
      return
    }
    this.face()
    const cornered = (dir > 0 ? this.x - b.l : b.r - this.x) < 120
    if (adx < 420 && !cornered) {
      this.vx = approach(this.vx, -dir * this.speed, 30)
      this.an.play(A.eWalk, 6)
    } else if (adx > 860) {
      this.vx = approach(this.vx, dir * this.speed, 30)
      this.an.play(A.eWalk, 6)
    } else {
      this.vx = approach(this.vx, 0, 30)
      this.an.play(A.gIdle, 6)
    }
    if (this.cd <= 0 && adx < 1100 && this.world.takeToken(this, true)) this.set('aim')
  }
}

/* ---------------------------------- heavy ---------------------------------- */

export class Heavy extends Enemy {
  constructor(world: World, x: number, y = GROUND_Y) {
    super(world, 'heavy', 'heavy', x, y)
    this.maxHp = this.hp = 190
    this.speed = 140
    this.armored = true
    this.kneels = true
    this.cd = randRange(40, 100)
  }
  protected ai() {
    const adx = Math.abs(this.dx)
    this.approachPlayer(210, A.eWalk, this.cd <= 0)
    if (this.cd <= 0 && adx < 400 && Math.abs(this.p.y - this.y) < 260 && this.world.takeToken(this, false))
      this.begin(rand() < 0.55 ? 'heavySlam' : 'heavySweep')
  }
}

/* ---------------------------------- titan ---------------------------------- */

/** Siege frame: twice the height of the player, never flinches, every swing shakes the floor. */
export class Titan extends Enemy {
  constructor(world: World, x: number, y = GROUND_Y) {
    super(world, 'titan', 'titan', x, y)
    this.maxHp = this.hp = 430
    this.speed = 105
    this.armored = true
    this.kneels = true
    this.atkScale = 1.5
    this.cd = randRange(50, 110)
  }
  protected ai() {
    const adx = Math.abs(this.dx)
    this.approachPlayer(290, A.eWalk, this.cd <= 0)
    if (this.cd <= 0 && adx < 560 && Math.abs(this.p.y - this.y) < 380 && this.world.takeToken(this, false))
      this.begin(rand() < 0.6 ? 'heavySlam' : 'heavySweep')
  }
}

/* ---------------------------------- drone ---------------------------------- */

export class Drone extends Enemy {
  private tx = 0
  private ty = 0
  private ph = rand() * 6
  constructor(world: World, x: number, y = GROUND_Y - 360) {
    super(world, 'drone', 'drone', x, y)
    this.maxHp = this.hp = 36
    this.w = 90
    this.h = 70
    this.flying = true
    this.cd = randRange(70, 160)
  }
  get cy() {
    return this.y - 35
  }
  threatens(p: Actor) {
    if (this.dead) return false
    const d = Math.hypot(p.x - this.x, p.cy - this.cy)
    return (this.state === 'charge' && this.st >= 22 && d < 900) || (this.state === 'swoop' && d < 380)
  }
  protected ai() {
    const p = this.p
    if (this.state === 'charge') {
      this.vx = approach(this.vx, 0, 30)
      this.vy = approach(this.vy, 0, 30)
      this.face()
      if (this.st === 1) {
        this.world.fx.icon('warn', this.x, this.y - 110, 0.5, 0.7)
        this.world.sfx.play('warn')
      }
      if (this.st % 8 === 0) this.world.fx.flash(this.x + this.facing * 26, this.cy, COL.hostile, 0.8, 0.12)
      if (this.st === 26) {
        this.tx = p.x
        this.ty = p.cy + 30
        this.world.fx.beam(this.x, this.cy, this.tx, this.ty, COL.hostile, 0.14, 0.3)
      }
      if (this.st >= 34) {
        const a = Math.atan2(this.ty - this.cy, this.tx - this.x)
        this.vx = Math.cos(a) * 1350
        this.vy = Math.sin(a) * 1350
        this.hitSet.clear()
        this.set('swoop')
        this.world.sfx.play('dash')
      }
      return
    }
    if (this.state === 'swoop') {
      this.world.attack(this, { x: this.x - 50, y: this.y - 75, w: 100, h: 80 }, H(9, 380, -200), this.hitSet)
      if (this.st % 2 === 0)
        this.world.fx.spark(this.x, this.cy, Math.atan2(-this.vy, -this.vx), 1, COL.hostile, 0.4, 0.3)
      if (this.st >= 22 || this.y >= GROUND_Y - 6) {
        this.world.releaseToken(this)
        this.cd = randRange(120, 200)
        this.set('idle')
      }
      return
    }
    this.face()
    const hx = p.x - this.side * (330 + this.jitter),
      hy = Math.min(GROUND_Y - 300, p.y - 300) + Math.sin(this.world.frame * 0.05 + this.ph) * 40
    this.vx = approach(this.vx, clamp((hx - this.x) * 3, -420, 420), 16)
    this.vy = approach(this.vy, clamp((hy - this.y) * 3, -380, 380), 16)
    if (this.cd <= 0 && Math.abs(this.dx) < 700 && this.world.takeToken(this, true)) this.set('charge')
  }
  render(alpha: number, time: number) {
    this.rig.extraRot =
      clamp(this.vx / 3000, -0.3, 0.3) +
      (this.state === 'swoop' ? Math.atan2(this.vy, Math.abs(this.vx)) * 0.6 * this.facing : 0) +
      // a dying drone cannot hold its attitude: it lists and shudders in place
      (this.dying ? 0.2 * Math.sin(time * 7.3 + this.ph) + 0.08 * Math.sin(time * 23) : 0)
    super.render(alpha, time)
    this.rig.setPos(
      this.rx + (this.dying ? Math.sin(time * 31 + this.ph) * 2.5 : 0),
      this.ry + Math.sin(time * 4 + this.ph) * 5 - 35,
      this.facing
    )
  }
}

/* ---------------------------------- boss: WARDEN ---------------------------------- */

export class Warden extends Enemy {
  phase = 1
  private queue: string[] = []
  private cape: Tail
  constructor(world: World, x: number) {
    super(world, 'warden', 'warden', x, GROUND_Y)
    this.isBoss = true
    this.armored = true
    this.kneels = true
    this.title = '典狱者  WARDEN'
    this.maxHp = this.hp = 500
    this.maxLives = this.lives = 3
    this.speed = 200
    this.cd = 80
    this.cape = new Tail(world.stage, 9, 23, 26, 0x7a1030, 0x2a0612, DEPTH.enemy - 2)
    this.cape.reset(x, GROUND_Y - this.h)
  }

  takeHit(hit: HitDef, src: Actor | null, dir: number) {
    const r = super.takeHit(hit, src, dir)
    if (r && this.phase === 1 && this.hp <= this.maxHp * 0.5 && !this.dying && !this.dead && this.state !== 'reviving')
      this.enterPhase2()
    return r
  }
  threatens(p: Actor) {
    if (this.state === 'leap')
      return this.st > 34 && this.vy > 200 && Math.abs(p.x - this.x) < 340 && this.y > GROUND_Y - 420
    return super.threatens(p)
  }
  protected revive() {
    super.revive()
    this.queue = []
    if (this.lives === 1 && this.phase === 1) this.enterPhase2()
  }
  private enterPhase2() {
    this.phase = 2
    this.interrupt()
    this.queue = []
    this.set('roar')
    this.invuln = 70
    this.an.play(A.cast, 6, true)
  }

  protected endAttack() {
    this.atk = null
    const next = this.queue.shift()
    if (next) {
      this.begin(next)
      return
    }
    this.world.releaseToken(this)
    this.cd = randRange(40, 80) * (this.phase === 2 ? 0.55 : 1)
    this.set('idle')
  }
  protected telegraph() {
    super.telegraph()
    if (this.atk === ATK.bossDash)
      this.world.fx.beam(
        this.x,
        this.y - this.h * 0.6,
        this.x + this.facing * 1700,
        this.y - this.h * 0.6,
        COL.hostile,
        0.5,
        0.7
      )
  }

  protected ai() {
    const p = this.p,
      adx = Math.abs(this.dx),
      fx = this.world.fx
    switch (this.state) {
      case 'roar':
        this.vx = approach(this.vx, 0, 40)
        if (this.st === 20) {
          fx.ring(this.cx, this.cy, COL.hostile, 60, 900, 0.7)
          fx.ring(this.cx, this.cy, 0xffffff, 30, 600, 0.5)
          fx.screenFlash(COL.hostile, 0.3, 0.3)
          fx.shards(this.cx, this.cy, 24, COL.hostile, 1.2)
          fx.ripple(this.cx, this.cy, 1300, 0.9, 0.7)
          this.world.shake(16, 0.05)
          this.world.sfx.play('exBoom')
          const d = Math.sign(p.x - this.x) || 1
          if (adx < 520) p.takeHit(H(6, 700, -420, { stun: 20 }), this, d)
        }
        if (this.st >= 60) {
          this.cd = 30
          this.set('idle')
        }
        return
      case 'leap': {
        if (this.st === 1) {
          this.an.play(A.windSlam, 5, true)
          this.telegraph()
        }
        if (this.st < 28) {
          this.vx = approach(this.vx, 0, 40)
          this.face()
          if (this.st % 8 === 0) this.world.fx.flash(this.x, this.y - 20, COL.hostile, 0.6, 0.14)
          return
        }
        if (this.st === 28) {
          this.vy = -1750
          this.onGround = false
          this.vx = clamp((p.x - this.x) / 1.09, -1300, 1300)
          fx.dust(this.x, this.y, 0, 8)
          this.an.play(A.leapUp, 4, true)
          this.world.sfx.play('jump')
        }
        if (this.st > 28 && this.vy > 0) this.an.play(A.leapDown, 5)
        if (this.st > 30 && this.onGround) {
          this.vx = 0
          this.hitSet.clear()
          this.world.attack(
            this,
            { x: this.x - 290, y: this.y - 240, w: 580, h: 260 },
            H(20, 620, -620, { stun: 28, stop: 9, shake: 14 }),
            this.hitSet
          )
          this.groundShock(this.x, 2)
          fx.pillar(this.x, this.y, COL.hostile, 600, 0.3, 1.5)
          this.world.sfx.play('slam')
          this.an.play(A.strikeSlam, 0, true)
          this.an.update(8)
          this.set('recover')
        }
        return
      }
      case 'recover':
        this.vx = approach(this.vx, 0, 40)
        if (this.st >= 34) this.endAttack()
        return
      case 'cast': {
        this.vx = approach(this.vx, 0, 40)
        if (this.st === 1) {
          this.face()
          this.an.play(A.cast, 5, true)
          this.telegraph()
        }
        const rain = this.queue[0] === 'rain'
        if (this.st === 28) {
          if (rain) {
            this.queue.shift()
            const n = 7
            for (let i = 0; i < n; i++) {
              const x = clamp(
                p.x + (i - (n - 1) / 2) * 190 * (i % 2 ? 1 : -1) * 0.5 + randRange(-60, 60) + p.vx * 0.3,
                this.world.bounds.l + 60,
                this.world.bounds.r - 60
              )
              this.world.spawnProj({
                kind: 'rain',
                x,
                y: GROUND_Y,
                vx: 0,
                vy: 0,
                team: 1,
                dmg: 13,
                w: 120,
                h: 900,
                life: 8,
                delay: 34 + i * 9,
                owner: this,
              })
            }
          } else {
            const n = this.phase === 2 ? 7 : 5,
              sx = this.x + this.facing * 70,
              sy = this.y - this.h * 0.85
            const base = Math.atan2(p.cy - sy, p.x - sx)
            for (let i = 0; i < n; i++) {
              const a = base + (i - (n - 1) / 2) * 0.16
              this.world.spawnProj({
                kind: 'bolt',
                x: sx,
                y: sy,
                vx: Math.cos(a) * 900,
                vy: Math.sin(a) * 900,
                team: 1,
                dmg: 9,
                w: 30,
                h: 30,
                life: 130,
                owner: this,
              })
            }
            fx.flash(sx, sy, COL.hostile, 2.4, 0.2)
            this.world.sfx.play('shoot')
          }
        }
        if (this.st >= 56) this.endAttack()
        return
      }
    }
    // idle: reposition and choose a pattern
    this.approachPlayer(260, A.eWalk, true)
    if (this.cd > 0 || !this.world.takeToken(this, false)) return
    const r = rand()
    if (adx < 420) {
      if (r < 0.55) {
        this.queue = ['bossRise', 'bossSweep']
        this.begin('bossOver')
      } else if (r < 0.75) {
        this.queue = []
        this.begin('bossSweep')
      } else this.set('leap')
    } else if (r < 0.38) this.begin('bossDash')
    else if (r < 0.66) this.set('leap')
    else {
      if (this.phase === 2 && rand() < 0.6) this.queue = ['rain']
      this.set('cast')
    }
  }

  render(alpha: number, time: number) {
    super.render(alpha, time)
    this.cape.update(
      this.rig.wx(this.rig.neck.x - 8 * this.facing),
      this.rig.wy(this.rig.neck.y + 14),
      this.facing + this.vx / 600,
      time
    )
    this.cape.setAlpha(this.rig.alpha)
  }
  protected applyTint() {
    if (this.dying) this.dyingTint()
    else if (this.phase === 2) this.rig.setTintMul(0xffc8d0)
    else this.rig.setFlash(null)
  }
  destroy() {
    super.destroy()
    this.cape.destroy()
  }
}

/* ---------------------------------- stage 2 ---------------------------------- */

/** Strikes called down from above on marked ground: `count` of them around `x`, one after another. */
function callStrikes(owner: Enemy, world: World, x: number, count: number, spread: number, dmg: number, wait: number) {
  for (let i = 0; i < count; i++)
    world.spawnProj({
      kind: 'rain',
      x: clamp(x + (i - (count - 1) / 2) * spread + randRange(-40, 40), world.bounds.l + 60, world.bounds.r - 60),
      y: GROUND_Y,
      vx: 0,
      vy: 0,
      team: 1,
      dmg,
      w: 120,
      h: 900,
      life: 8,
      delay: wait + i * 10,
      owner,
    })
}

/**
 * Skirmisher of the outer yard, in amber plate. It never stands and trades: it holds off at lunge range, commits
 * to one long thrust, and breaks away again before it can be punished.
 */
export class Lancer extends Enemy {
  private away = 0
  private lunged = false
  constructor(world: World, x: number, y = GROUND_Y) {
    super(world, 'lancer', 'grunt', x, y)
    this.maxHp = this.hp = 90
    this.speed = 360
    this.cd = randRange(40, 100)
  }
  protected applyTint() {
    if (this.dying) this.dyingTint()
    else this.rig.setTintMul(0xffb45a, 0.2)
  }
  protected ai() {
    const adx = Math.abs(this.dx),
      dir = Math.sign(this.dx) || 1
    if (this.lunged) {
      // the thrust is over: get clear
      this.lunged = false
      this.away = 46
    }
    if (this.away > 0) {
      this.away--
      this.face()
      const wall = dir > 0 ? this.x - this.world.bounds.l : this.world.bounds.r - this.x
      this.vx = approach(this.vx, wall > 140 ? -dir * this.speed : 0, 40)
      this.an.play(A.eRun, 6)
      return
    }
    this.approachPlayer(540, A.eRun, this.cd <= 0)
    if (
      this.cd <= 0 &&
      adx > 260 &&
      adx < 780 &&
      Math.abs(this.p.y - this.y) < 220 &&
      this.world.takeToken(this, false)
    ) {
      this.begin('lancerLunge')
      this.lunged = true
    }
  }
}

/**
 * Spotter, in teal. It keeps well back and calls strikes down on the hero's position: three in a row, each landing
 * where its marker has been burning on the ground.
 */
export class Mortar extends Enemy {
  private cast = 0
  constructor(world: World, x: number, y = GROUND_Y) {
    super(world, 'mortar', 'gunner', x, y)
    this.maxHp = this.hp = 80
    this.speed = 220
    this.cd = randRange(80, 150)
  }
  protected applyTint() {
    if (this.dying) this.dyingTint()
    else this.rig.setTintMul(0x7dffd6, 0.2)
  }
  protected ai() {
    const adx = Math.abs(this.dx),
      dir = Math.sign(this.dx) || 1,
      b = this.world.bounds
    this.face()
    if (this.cast > 0) {
      // arm raised, calling it in
      this.vx = approach(this.vx, 0, 30)
      if (--this.cast === 0) this.world.releaseToken(this)
      return
    }
    // hold a long way off; back away when crowded, unless the wall is behind
    const room = dir > 0 ? this.x - b.l : b.r - this.x
    if (adx < 620 && room > 160) {
      this.vx = approach(this.vx, -dir * this.speed, 30)
      this.an.play(A.eWalk, 6)
    } else if (adx > 1000) {
      this.vx = approach(this.vx, dir * this.speed, 30)
      this.an.play(A.eRun, 6)
    } else {
      this.vx = approach(this.vx, 0, 30)
      this.an.play(A.eIdle, 6)
    }
    if (this.cd <= 0 && adx < 1500 && this.world.takeToken(this, true)) {
      this.cd = randRange(170, 230)
      this.cast = 44
      this.an.play(A.aim, 4, true)
      this.world.sfx.play('warn')
      this.world.fx.icon('warn', this.x, this.y - this.h - 46, 0.5, 0.7)
      callStrikes(this, this.world, this.p.x + this.p.vx * 0.25, 3, 190, 9, 40)
    }
  }
}

/**
 * Stage 2's boss: a siege frame half as tall again as a Titan. It fights like one, slowly and with the whole floor
 * shaking, but it also commands the yard: it calls a line of strikes across the arena, and every time it is put
 * down it brings skirmishers in. On its last life it stops waiting between swings.
 */
export class Arbiter extends Enemy {
  private barrage = 240
  private enraged = false
  constructor(world: World, x: number) {
    super(world, 'arbiter', 'titan', x, GROUND_Y)
    this.isBoss = true
    this.title = '裁决机  ARBITER'
    this.armored = true
    this.kneels = true
    this.maxHp = this.hp = 520
    this.maxLives = this.lives = 3
    this.speed = 130
    this.atkScale = 1.7
    this.cd = 90
  }
  protected applyTint() {
    if (this.dying) this.dyingTint()
    else this.rig.setTintMul(this.enraged ? 0xff6a5a : 0xb89cff, this.enraged ? 0.3 : 0.18)
  }
  takeHit(hit: HitDef, src: Actor | null, dir: number) {
    const lives = this.lives,
      r = super.takeHit(hit, src, dir)
    if (this.lives < lives) this.reinforce()
    return r
  }
  executed(dir: number) {
    const lives = this.lives
    super.executed(dir)
    if (this.lives < lives) this.reinforce()
  }
  /** A life lost: skirmishers come in from both ends, and on the last life it turns red. */
  private reinforce() {
    if (this.lives <= 0) return
    const b = this.world.bounds
    for (const x of [b.l + 220, b.r - 220]) this.world.reinforce('lancer', x)
    this.enraged = this.lives === 1
  }
  protected ai() {
    const adx = Math.abs(this.dx)
    this.approachPlayer(330, A.eWalk, this.cd <= 0)
    if (--this.barrage <= 0) {
      // a line of strikes marching across the arena, the hero somewhere in the middle of it
      this.barrage = this.enraged ? 250 : 380
      this.world.sfx.play('warn')
      this.world.fx.icon('warn', this.x, this.y - this.h - 60, 0.7, 0.9)
      callStrikes(this, this.world, this.p.x, 6, 230, 12, 46)
    }
    if (this.cd <= 0 && adx < 640 && Math.abs(this.p.y - this.y) < 420 && this.world.takeToken(this, false)) {
      this.begin(rand() < 0.55 ? 'heavySlam' : 'heavySweep')
      if (this.enraged) this.cd = Math.min(this.cd, 40)
    }
  }
}

export function spawnEnemy(world: World, kind: string, x: number, y?: number): Enemy {
  switch (kind) {
    case 'lancer':
      return new Lancer(world, x, y)
    case 'mortar':
      return new Mortar(world, x, y)
    case 'arbiter':
      return new Arbiter(world, x)
    case 'gunner':
      return new Gunner(world, x, y)
    case 'heavy':
      return new Heavy(world, x, y)
    case 'titan':
      return new Titan(world, x, y)
    case 'drone':
      return new Drone(world, x, y)
    case 'warden':
      return new Warden(world, x)
    default:
      return new Grunt(world, x, y)
  }
}
