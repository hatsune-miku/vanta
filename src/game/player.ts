import { Actor, HitDef, Threat, World } from './actor'
import type { Enemy } from './enemies'

import { A, Anim } from '../art/anims'
import { Tail } from '../art/tail'
import { COL, DEPTH, GROUND_Y } from '../config'
import { Box, approach, clamp, lerp, randRange, segmentBox } from '../core/util'

const RUN = 1110,
  // At 60 Hz these reach 468 / 368 units, 1.5× the previous 312 / 245.3 peaks.
  JUMP = 1757.5,
  JUMP2 = 1561.4,
  JUMP_CUT = 753.6,
  DASH_DIST = 360,
  BLINK = 5
export const SHIELD_COST = 20
export const OVERLOAD_DURATION = 15
export const OVERLOAD_COOLDOWN = 5
export const CHARGE_DURATION = 1.5

const H = (
  dmg: number,
  kx: number,
  ky: number,
  stun: number,
  stop: number,
  shake: number,
  extra: Partial<HitDef> = {}
): HitDef => ({ dmg, kx, ky, stun, stop, shake, ...extra })

interface MoveFx {
  at: number
  key: string
  x: number
  y: number
  rot: number
  scale: number
  flipY?: boolean
  sy?: number
  life?: number
  sfx?: string
}
interface Move {
  anim: Anim
  len: number
  cancel: number
  air?: boolean
  heavy?: boolean
  hits: { from: number; to: number; box: [number, number, number, number]; hit: HitDef }[]
  fx: MoveFx[]
  step?: [from: number, to: number, v: number][]
  nextL?: string
  nextH?: string
  jumpCancel?: number
}

export const MOVES: Record<string, Move> = {
  l1: {
    anim: A.l1,
    len: 24,
    cancel: 10,
    nextL: 'l2',
    nextH: 'launcher',
    step: [[1, 7, 300]],
    hits: [{ from: 6, to: 10, box: [-17, -225, 217, 233], hit: H(8, 170, 0, 22, 6, 6) }],
    fx: [{ at: 6, key: 'slash', x: 22, y: -140, rot: 0.1, scale: 0.7, sfx: 'swing' }],
  },
  l2: {
    anim: A.l2,
    len: 24,
    cancel: 10,
    nextL: 'l3',
    nextH: 'launcher',
    step: [[1, 6, 280]],
    hits: [{ from: 5, to: 9, box: [-17, -242, 217, 250], hit: H(8, 150, -140, 22, 6, 6) }],
    fx: [{ at: 5, key: 'slash', x: 22, y: -133, rot: -0.1, scale: 0.7, flipY: true, sfx: 'swing' }],
  },
  l3: {
    anim: A.l3,
    len: 26,
    cancel: 12,
    nextL: 'l4',
    nextH: 'whirl',
    step: [[4, 9, 980]],
    hits: [{ from: 7, to: 12, box: [8, -150, 250, 83], hit: H(10, 420, 0, 26, 7, 7) }],
    fx: [{ at: 7, key: 'cut', x: 142, y: -107, rot: 0, scale: 0.96, sfx: 'swing' }],
  },
  l4: {
    anim: A.l4,
    len: 28,
    cancel: 15,
    nextL: 'l5',
    nextH: 'whirl',
    step: [[2, 13, 330]],
    hits: [
      { from: 4, to: 7, box: [-167, -167, 358, 150], hit: H(6, 60, -80, 20, 5, 6) },
      { from: 10, to: 14, box: [-167, -167, 358, 150], hit: H(8, 240, -120, 24, 7, 7) },
    ],
    fx: [
      { at: 4, key: 'slash_wide', x: 0, y: -104, rot: 0, scale: 1, sy: 0.3, sfx: 'swing' },
      { at: 10, key: 'slash_wide', x: 0, y: -112, rot: 3.14, scale: 1.08, sy: 0.32, sfx: 'swing' },
    ],
  },
  l5: {
    anim: A.l5,
    len: 38,
    cancel: 25,
    nextL: 'l1',
    nextH: 'h3',
    step: [[8, 13, 420]],
    hits: [
      {
        from: 12,
        to: 17,
        box: [-25, -275, 250, 283],
        hit: H(18, 560, -520, 34, 12, 14, { knock: true, heavy: true }),
      },
    ],
    fx: [{ at: 12, key: 'slash_wide', x: 25, y: -158, rot: 0.5, scale: 0.83, life: 0.26, sfx: 'swingHeavy' }],
  },
  h1: {
    heavy: true,
    anim: A.h1,
    len: 40,
    cancel: 24,
    nextL: 'l1',
    nextH: 'h2',
    step: [[12, 18, 520]],
    hits: [{ from: 15, to: 21, box: [-75, -175, 333, 158], hit: H(20, 480, -200, 34, 13, 14, { heavy: true }) }],
    fx: [{ at: 15, key: 'slash_wide', x: 17, y: -100, rot: 0, scale: 1.17, sy: 0.34, life: 0.26, sfx: 'swingHeavy' }],
  },
  h2: {
    heavy: true,
    anim: A.h2,
    len: 36,
    cancel: 22,
    nextL: 'l1',
    nextH: 'h3',
    step: [[9, 15, 460]],
    hits: [{ from: 13, to: 18, box: [-17, -308, 225, 317], hit: H(18, 120, -980, 40, 12, 12, { heavy: true }) }],
    fx: [
      { at: 13, key: 'slash_wide', x: 17, y: -142, rot: -0.5, scale: 1, flipY: true, life: 0.26, sfx: 'swingHeavy' },
    ],
  },
  h3: {
    heavy: true,
    anim: A.h3,
    len: 44,
    cancel: 31,
    nextL: 'l1',
    nextH: 'h1',
    step: [[6, 17, 430]],
    hits: [
      {
        from: 17,
        to: 22,
        box: [-75, -317, 350, 325],
        hit: H(28, 520, -560, 38, 15, 21, { knock: true, heavy: true }),
      },
    ],
    fx: [{ at: 17, key: 'slash_wide', x: 25, y: -167, rot: 0.55, scale: 1.13, life: 0.3, sfx: 'swingHeavy' }],
  },
  launcher: {
    heavy: true,
    anim: A.launcher,
    len: 30,
    cancel: 14,
    jumpCancel: 10,
    nextL: 'l1',
    nextH: 'h3',
    step: [[3, 8, 240]],
    hits: [{ from: 8, to: 13, box: [-8, -283, 183, 292], hit: H(12, 30, -1280, 40, 10, 10, { heavy: true }) }],
    fx: [{ at: 8, key: 'slash', x: 17, y: -133, rot: -0.55, scale: 0.9, flipY: true, life: 0.24, sfx: 'swingHeavy' }],
  },
  whirl: {
    heavy: true,
    anim: A.whirl,
    len: 42,
    cancel: 30,
    nextL: 'l1',
    nextH: 'h3',
    step: [[1, 26, 380]],
    hits: [
      { from: 4, to: 8, box: [-183, -167, 367, 150], hit: H(6, 40, -60, 20, 5, 6) },
      { from: 12, to: 16, box: [-183, -167, 367, 150], hit: H(6, 40, -60, 20, 5, 6) },
      {
        from: 20,
        to: 26,
        box: [-200, -183, 400, 175],
        hit: H(15, 600, -420, 34, 12, 14, { knock: true, heavy: true }),
      },
    ],
    fx: [
      { at: 4, key: 'slash_wide', x: 0, y: -104, rot: 0, scale: 1.04, sy: 0.3, sfx: 'swing' },
      { at: 12, key: 'slash_wide', x: 0, y: -112, rot: 3.14, scale: 1.08, sy: 0.3, sfx: 'swing' },
      { at: 20, key: 'slash_wide', x: 0, y: -104, rot: 0, scale: 1.29, sy: 0.34, life: 0.28, sfx: 'swingHeavy' },
    ],
  },
  al1: {
    anim: A.al1,
    len: 20,
    cancel: 9,
    air: true,
    nextL: 'al2',
    nextH: 'dive',
    hits: [{ from: 5, to: 9, box: [-17, -225, 217, 242], hit: H(7, 60, -340, 24, 6, 6) }],
    fx: [{ at: 5, key: 'slash', x: 25, y: -125, rot: 0.15, scale: 0.79, sfx: 'swing' }],
  },
  al2: {
    anim: A.al2,
    len: 20,
    cancel: 9,
    air: true,
    nextL: 'al3',
    nextH: 'dive',
    hits: [{ from: 5, to: 9, box: [-17, -242, 217, 258], hit: H(7, 60, -340, 24, 6, 6) }],
    fx: [{ at: 5, key: 'slash', x: 25, y: -125, rot: -0.1, scale: 0.79, flipY: true, sfx: 'swing' }],
  },
  al3: {
    anim: A.al3,
    len: 24,
    cancel: 17,
    air: true,
    nextH: 'dive',
    hits: [
      {
        from: 9,
        to: 13,
        box: [-33, -258, 258, 300],
        hit: H(14, 320, 950, 30, 11, 12, { knock: true, spike: true, heavy: true }),
      },
    ],
    fx: [{ at: 9, key: 'slash_wide', x: 17, y: -125, rot: 0.5, scale: 0.92, life: 0.24, sfx: 'swingHeavy' }],
  },
  diveLand: { anim: A.diveLand, len: 22, cancel: 12, nextL: 'l1', nextH: 'h1', hits: [], fx: [] },
  chargeRelease: { anim: A.chargeRelease, len: 28, cancel: 20, nextL: 'l1', nextH: 'h1', hits: [], fx: [] },
}
const DIVE_FALL = H(8, 80, 700, 24, 6, 7, { spike: true, heavy: true })
const DIVE_LAND = H(16, 340, -760, 36, 12, 16, { heavy: true, knock: true })
/** what an extreme dodge does to the attacker */
const RIPOSTE = H(72, 380, -420, 54, 14, 16, { heavy: true })
const ANCHOR_SLASH = H(75, 320, -180, 34, 10, 0, { heavy: true })

export class Player extends Actor {
  overloadT = 0
  overloadCd = 0
  chargeT = 0
  energy = 40
  maxEnergy = 100
  move: Move | null = null
  mf = 0
  private win = -1
  private hitSet = new Set<Actor>()
  private echoSet = new Set<Actor>()
  private landedHit = false
  dashT = 0
  dashCd = 0
  private dvx = 1
  private dvy = 0
  private airDashed = false
  private bx0 = 0
  private by0 = 0
  private bx1 = 0
  private by1 = 0
  private blinkN = BLINK
  private dashTarget: Enemy | null = null
  private dashRibbon: ReturnType<World['fx']['dashTrail']> | null = null
  private dashFromX = 0
  private dashFromY = 0
  private dodgeRewarded = false
  private dodgeCounters = new Set<Actor>()
  /** frames left of the post-extreme-dodge glow */
  extremeT = 0
  private jumps = 0
  private coyote = 0
  private jumping = false
  private stun = 0
  tail: Tail
  /** set by the execution cinematic; suspends normal control */
  cine = false
  /** the cinematic can take the body off screen (its approach is a blink too) */
  hidden = false
  damageTaken = 0
  /** squash & stretch impulse and acceleration lean; both settle in the logic step, so they look the same at any refresh rate */
  squash = 0
  private lean = 0
  private lastVx = 0
  /** playback speed of the locomotion clip, tied to ground speed so the feet do not skate */
  private animRate = 1

  constructor(world: World, x: number) {
    super(world)
    this.team = 0
    this.maxHp = this.hp = 100
    this.x = this.px = x
    this.y = this.py = GROUND_Y
    this.onGround = true
    this.initBody('vanta', DEPTH.player)
    this.tail = new Tail(world.stage, 8, 13, 10, 0xffe2a0, 0xff8a3d, DEPTH.tail)
    this.applyPose(this.an.update(0))
    this.tail.reset(this.x, this.y - this.h)
    this.state = 'free'
  }

  get dashIFrames() {
    return this.state === 'dash'
  }
  /** between leaving and arriving the body is simply not there */
  get blinking() {
    return this.state === 'dash' && this.dashT < this.blinkN
  }
  gainEnergy(n: number) {
    this.energy = clamp(this.energy + n, 0, this.maxEnergy)
  }

  get overloaded() {
    return this.overloadT > 0
  }
  get damageMultiplier() {
    return this.overloaded ? 1.2 : 1
  }
  get heavyScale() {
    return this.overloaded ? 1.25 : 1
  }
  get charging() {
    return this.state === 'charge'
  }
  get chargePower() {
    return 6 + 6 * clamp(this.chargeT / CHARGE_DURATION, 0, 1)
  }
  activateOverload() {
    if (this.dead || this.cine || this.overloaded || this.overloadCd > 0) return false
    this.overloadT = OVERLOAD_DURATION
    this.world.fx.ripple(this.cx, this.cy, 2600, 0.72, 0)
    this.world.fx.overloadEnter(this.cx, this.cy)
    this.world.sfx.play('overload')
    return true
  }
  /** Unscaled seconds of play; pausing is handled by the scene. */
  updateOverload(dt: number) {
    if (this.dead) {
      this.overloadT = this.overloadCd = 0
      this.chargeT = 0
      return
    }
    if (this.charging) {
      this.chargeT = Math.min(CHARGE_DURATION, this.chargeT + Math.min(dt, this.overloadT))
      if (this.chargeT >= CHARGE_DURATION - 1e-7 || this.overloadT <= dt) {
        this.releaseCharge()
        return
      }
    }
    if (this.overloaded) {
      const remaining = this.overloadT - dt
      this.overloadT = remaining > 1e-7 ? remaining : 0
      if (!this.overloaded) this.overloadCd = Math.max(0, OVERLOAD_COOLDOWN + Math.min(0, remaining))
    } else {
      this.overloadCd = Math.max(0, this.overloadCd - dt)
      if (this.overloadCd < 1e-7) this.overloadCd = 0
    }
  }
  private heavyBox(x: number, y: number, w: number, h: number): Box {
    const k = this.heavyScale
    return this.fbox(x * k, y * k, w * k, h * k)
  }

  update() {
    if (this.cine) {
      this.px = this.x
      this.py = this.y
      return
    }
    this.rig.setPos(this.x, this.y, this.facing)
    if (this.invuln > 0) this.invuln--
    if (this.flashT > 0) this.flashT--
    if (this.dashCd > 0) this.dashCd--
    if (this.extremeT > 0) this.extremeT--
    this.st++
    this.gravity = 1
    this.animRate = 1
    if (this.dead) {
      this.vx = approach(this.vx, 0, 30)
      this.an.play(A.die, 6)
    } else
      switch (this.state) {
        case 'free':
          this.free()
          break
        case 'attack':
          this.attack()
          break
        case 'dive':
          this.dive()
          break
        case 'dash':
          this.dash()
          break
        case 'charge':
          this.charge()
          break
        case 'hurt':
          this.vx = approach(this.vx, 0, 26)
          this.an.play(A.hurt, 3)
          if (this.st >= this.stun) this.set('free')
          break
      }
    if (this.cine) return
    this.physics()
    if (this.onGround) {
      this.jumps = 0
      this.airDashed = false
      this.coyote = 6
      this.jumping = false
    } else if (this.coyote > 0) this.coyote--
    // secondary motion: settle the squash, lean into acceleration and air travel
    this.squash *= 0.8
    if (Math.abs(this.squash) < 0.004) this.squash = 0
    const acc = this.vx - this.lastVx
    this.lastVx = this.vx
    const want =
      this.dead || this.state === 'dash'
        ? 0
        : clamp(acc * 0.0016, -0.12, 0.12) + (this.onGround ? 0 : clamp(this.vx / 9000, -0.07, 0.07))
    this.lean += (want - this.lean) * 0.18
    this.applyPose(this.state === 'attack' && this.move ? this.an.update(0, this.mf) : this.an.update(this.animRate))
  }

  /* ------------------------------ free movement ------------------------------ */

  private free() {
    const inp = this.world.ctl,
      ax = inp.axis
    const acc = this.onGround ? 240 : 130
    this.vx = approach(this.vx, ax * RUN, acc)
    if (ax) this.facing = ax
    if (this.tryCommon()) return
    if (inp.take('jump')) this.doJump()
    if (this.jumping && !inp.down.jump && this.vy < -JUMP_CUT) this.vy = -JUMP_CUT
    if (this.onGround) {
      const moving = Math.abs(this.vx) > 60
      this.an.play(moving ? A.run : A.idle, 5)
      if (moving) this.animRate = Math.max(0.45, Math.abs(this.vx) / RUN)
    } else this.an.play(this.vy < 60 ? A.jump : A.fall, 6)
    if (this.onGround && Math.abs(this.vx) > 300 && this.st % 7 === 0)
      this.world.fx.dust(this.x - this.facing * 20, this.y, -this.facing, 1)
  }

  private doJump() {
    const inp = this.world.ctl,
      fx = this.world.fx
    if (this.onGround || this.coyote > 0) {
      if (inp.down.down && this.y < GROUND_Y - 4) {
        this.dropT = 12
        this.coyote = 0
        return
      }
      this.vy = -JUMP
      this.coyote = 0
      this.jumping = true
      this.onGround = false
      this.squash = 0.16
      fx.dust(this.x, this.y, 0, 4)
      this.world.sfx.play('jump')
    } else if (this.jumps < 1) {
      this.jumps++
      this.vy = -JUMP2
      this.jumping = true
      this.squash = 0.14
      fx.ring(this.x, this.y - 6, COL.main, 20, 150, 0.28, 0.3)
      fx.ring(this.x, this.y - 6, 0xffffff, 10, 90, 0.2, 0.3)
      fx.spark(this.x, this.y, Math.PI / 2, 8, COL.main, 0.7, 0.8)
      this.world.sfx.play('jump')
    }
  }

  /** Actions available from the neutral state and from cancel windows. Returns true if one started. */
  private tryCommon(inAttack = false): boolean {
    const inp = this.world.ctl
    if (this.overloaded && inp.down.light && inp.down.heavy) {
      this.startCharge()
      return true
    }
    if (inp.peek('dash') && this.dashCd <= 0 && (this.onGround || !this.airDashed || this.world.anchor)) {
      inp.take('dash')
      this.startDash()
      return true
    }
    if (inp.peek('exec') && this.world.tryExecute()) {
      inp.take('exec')
      return true
    }
    if (inAttack) return false
    if (inp.take('light')) {
      this.startMove(this.onGround ? 'l1' : 'al1')
      return true
    }
    if (inp.take('heavy')) {
      if (!this.onGround) this.startDive()
      else this.startMove(inp.down.up ? 'launcher' : 'h1')
      return true
    }
    return false
  }

  /* ------------------------------ attacks ------------------------------ */

  startMove(name: string) {
    const m = MOVES[name]
    if (!m) return
    const ax = this.world.ctl.axis
    if (ax) this.facing = ax
    this.move = m
    this.mf = 0
    this.win = -1
    this.hitSet.clear()
    this.echoSet.clear()
    this.landedHit = false
    this.state = 'attack'
    this.st = 0
    this.an.play(m.anim, 3, true)
    if (m.air) {
      this.vy = Math.min(this.vy, -120)
    } else if (!ax) {
      // soft lock-on: turn toward a close enemy behind us
      const t = this.nearest(260)
      if (t && Math.sign(t.x - this.x) !== this.facing && Math.abs(t.x - this.x) > 30) this.facing = -this.facing
    }
  }

  private nearest(range: number, frontOnly = false): Actor | null {
    let best: Actor | null = null,
      bd = range
    for (const e of this.world.enemies) {
      if (e.dead || e.state === 'reviving') continue
      const dx = e.x - this.x,
        d = Math.abs(dx) + Math.abs(e.cy - this.cy) * 0.5
      if (frontOnly && Math.sign(dx) !== this.facing) continue
      if (d < bd) {
        bd = d
        best = e
      }
    }
    return best
  }

  private attack() {
    const m = this.move!,
      inp = this.world.ctl,
      fx = this.world.fx,
      scale = m.heavy ? this.heavyScale : 1
    this.mf++
    const f = this.mf
    if (m.air) {
      this.gravity = f < m.len * 0.75 ? 0.22 : 1
      this.vx = approach(this.vx, inp.axis * RUN * 0.5, 40)
      if (this.onGround) {
        this.set('free')
        return
      }
    } else {
      let v = 0
      if (m.step) for (const s of m.step) if (f >= s[0] && f <= s[1]) v = s[2]
      if (v) {
        // don't run through a target that is already in reach
        const t = this.nearest(170, true)
        this.vx = this.facing * (t ? Math.min(v, 120) : v)
      } else this.vx = approach(this.vx, 0, 70)
    }
    for (const e of m.fx)
      if (e.at === f) {
        const x = this.x + e.x * this.facing * scale,
          y = this.y + e.y * scale
        if (e.key === 'cut') fx.cut(x, y, randRange(-0.04, 0.04), 550 * e.scale * scale, COL.main, 0.28, 1.8)
        else {
          const options = { flipY: e.flipY, sy: e.sy, life: (e.life ?? 0.2) * 1.25, core: true }
          fx.attackSlash(x, y, e.key, e.rot, e.scale * scale, this.facing, COL.main, options)
          if (this.overloaded) {
            const curl = e.flipY ? -1 : 1
            // The overload echo is a second cut; each cut still keeps its own shade and light coincident.
            fx.attackSlash(
              x - this.facing * 12 * scale,
              y - curl * 20 * scale,
              e.key,
              e.rot - curl * 0.08,
              e.scale * scale * 0.94,
              this.facing,
              COL.pink,
              options
            )
          }
        }
        fx.spark(x + this.facing * 100, y, e.rot, m.heavy ? 14 : 8, COL.cyan, m.heavy ? 1 : 0.65, 1.2, 0.1)
        if (e.sfx) this.world.sfx.play(e.sfx)
      }
    for (let i = 0; i < m.hits.length; i++) {
      const h = m.hits[i]
      if (f < h.from || f > h.to) continue
      if (this.win !== i) {
        this.win = i
        this.hitSet.clear()
        this.echoSet.clear()
      }
      const b = h.box
      const box = this.fbox(b[0] * scale, b[1] * scale, b[2] * scale, b[3] * scale)
      const hit = m.heavy ? { ...h.hit, heavy: true } : h.hit
      if (this.world.attack(this, box, hit, this.hitSet) > 0) {
        this.landedHit = true
        if (m.air) this.vy = Math.min(this.vy, -260)
      }
      if (m.heavy && this.overloaded && f >= h.from + 2) this.world.attack(this, box, hit, this.echoSet)
    }
    if (m === MOVES.l5 && f === 14) {
      fx.dust(this.x + this.facing * 130, this.y, this.facing, 8)
      fx.ring(this.x + this.facing * 130, this.y, COL.main, 30, 220, 0.3, 0.25)
      this.squash = -0.1
    }
    if (m === MOVES.h3 && f === 18) {
      const gx = this.x + this.facing * 150 * scale
      fx.ring(gx, this.y, COL.main, 40, 380 * scale, 0.4, 0.26)
      if (scale > 1) fx.ring(gx, this.y, COL.pink, 30, 340 * scale, 0.36, 0.26)
      fx.dust(gx, this.y, 1, 8)
      fx.dust(gx, this.y, -1, 8)
      fx.pillar(gx, this.y, COL.main, 520 * scale, 0.28, 0.9)
      fx.spark(gx, this.y, -Math.PI / 2, 14, COL.main, 1, 1.4)
      this.world.shake(12, 0.04)
      this.world.sfx.play('slam')
      this.squash = -0.14
    }
    if (m === MOVES.h2 && f === 13) this.squash = 0.12
    if (f >= 3 && this.tryCommon(true)) return
    if (m.jumpCancel && f >= m.jumpCancel && this.landedHit && inp.take('jump')) {
      this.set('free')
      this.onGround = true
      this.doJump()
      this.vy = -JUMP * 1.05
      return
    }
    if (f >= m.cancel) {
      if (inp.peek('heavy')) {
        inp.take('heavy')
        if (m.air) {
          this.startDive()
          return
        }
        const next = inp.down.up ? 'launcher' : (m.nextH ?? 'h1')
        this.startMove(next)
        return
      }
      if (inp.peek('light') && m.nextL) {
        inp.take('light')
        this.startMove(m.nextL)
        return
      }
      if (inp.peek('jump') && (!m.air || this.jumps < 1)) {
        inp.take('jump')
        this.set('free')
        this.doJump()
        return
      }
      if (f >= m.cancel + 6 && inp.axis && !m.air) {
        this.set('free')
        return
      }
    }
    if (f >= m.len) {
      this.move = null
      this.set('free')
    }
  }

  private startCharge() {
    this.chargeT = 0
    this.move = null
    this.vx *= 0.2
    this.set('charge')
    this.world.ctl.take('light')
    this.world.ctl.take('heavy')
    this.an.play(A.charge, 5, true)
    this.world.sfx.play('exStart')
  }
  private charge() {
    const inp = this.world.ctl,
      fx = this.world.fx
    this.vx = approach(this.vx, 0, 90)
    this.gravity = this.onGround ? 1 : 0
    this.vy = approach(this.vy, 0, 100)
    if (!inp.down.light || !inp.down.heavy) {
      this.releaseCharge()
      return
    }
    if (this.st % 5 === 0) {
      const x = this.rig.wx(this.rig.tip.x),
        y = this.rig.wy(this.rig.tip.y)
      fx.coreCharge(x, y, 0.2)
      fx.flash(x, y, this.st % 10 ? COL.pink : COL.cyan, 0.18 + this.chargePower * 0.08, 0.14)
    }
  }
  private releaseCharge() {
    if (!this.charging) return
    const power = this.chargePower,
      dir = this.facing,
      hit = H(3 * power * MOVES.h1.hits[0].hit.dmg, 720, -240, 48, 9, 0, { heavy: true, multiplier: 1.2 }),
      fx = this.world.fx
    this.world.spawnSurge(hit)
    fx.slash(this.x + this.facing * 60, this.cy, 'slash_wide', -0.25, 1.8, this.facing, COL.cyan, { life: 0.4 })
    fx.weld(this.x + this.facing * 100, this.cy, this.facing > 0 ? 0 : Math.PI, 38, 1.6, GROUND_Y)
    this.world.sfx.play('overload')
    this.overloadT = 0
    this.overloadCd = OVERLOAD_COOLDOWN
    this.chargeT = 0
    this.world.ctl.clear()
    this.startMove('chargeRelease')
    this.facing = dir
  }

  private startDive() {
    this.state = 'dive'
    this.st = 0
    this.mf = 0
    this.hitSet.clear()
    this.echoSet.clear()
    this.move = null
    this.an.play(A.dive, 3, true)
    const ax = this.world.ctl.axis
    if (ax) this.facing = ax
  }
  private dive() {
    this.mf++
    if (this.mf < 9) {
      this.gravity = 0
      this.vy = approach(this.vy, 0, 80)
      this.vx = approach(this.vx, 0, 60)
      if (this.mf === 8) this.world.sfx.play('swingHeavy')
    } else {
      this.gravity = 0
      this.vy = 2500
      this.vx = this.facing * 430
      this.world.attack(this, this.heavyBox(-70, -170, 140, 210), DIVE_FALL, this.hitSet)
      if (this.overloaded && this.mf >= 11)
        this.world.attack(this, this.heavyBox(-70, -170, 140, 210), DIVE_FALL, this.echoSet)
      if (this.overloaded && this.mf % 4 === 1) {
        this.world.fx.cut(this.x, this.cy, Math.PI / 2, 500, COL.main, 0.18, 1.2)
        this.world.fx.cut(this.x + 24 * this.facing, this.cy, Math.PI / 2, 430, COL.pink, 0.18, 0.8)
      }
      if (this.mf % 2 === 0) this.world.fx.ghost(this.rig, COL.main, 0.4, 0.18)
    }
    if (this.onGround) this.diveLand() // touched down during the wind-up hover
  }
  protected onLand(v: number) {
    if (this.state === 'dive' && this.mf >= 9) this.diveLand()
    else if (v > 700 && !this.dead) {
      this.world.fx.dust(this.x, this.y, 0, 4)
      this.world.sfx.play('land')
      this.squash = -0.13
    }
  }
  private diveLand() {
    if (this.state !== 'dive') return
    const fx = this.world.fx,
      k = this.heavyScale
    this.hitSet.clear()
    this.world.attack(this, this.heavyBox(-250, -140, 500, 160), DIVE_LAND, this.hitSet)
    if (this.overloaded) this.world.attack(this, this.heavyBox(-250, -140, 500, 160), DIVE_LAND, new Set())
    fx.ring(this.x, this.y, COL.main, 40, 360 * k, 0.36, 0.26)
    if (this.overloaded) fx.ring(this.x, this.y, COL.pink, 30, 320 * k, 0.32, 0.26)
    fx.dust(this.x, this.y, 1, 7)
    fx.dust(this.x, this.y, -1, 7)
    fx.pillar(this.x, this.y, COL.main, 420 * k, 0.25, 0.8)
    fx.spark(this.x, this.y, -Math.PI / 2, 12, COL.main, 0.9, 1.4)
    this.world.shake(9, 0.03)
    this.world.sfx.play('slam')
    this.vx = 0
    this.move = MOVES.diveLand
    this.mf = 0
    this.win = -1
    this.state = 'attack'
    this.st = 0
    this.an.play(A.diveLand, 2, true)
  }

  /* ------------------------------ dodge ------------------------------ */

  /**
   * Dodge: a continuous light ribbon grows along the travelled path, with afterimages marking the body.
   * Jumps to the active anchor when there is one.
   */
  private startDash() {
    const inp = this.world.ctl,
      b = this.world.bounds
    let dx = inp.axis,
      dy = (inp.down.down ? 1 : 0) - (inp.down.up ? 1 : 0)
    if (this.onGround && dy > 0) dy = 0
    if (!dx && !dy) dx = this.facing
    const th = this.world.threat,
      anchor = this.world.anchor?.target?.anchorUsed ? null : this.world.anchor,
      an = th ? null : anchor
    this.dashTarget = this.overloaded ? (an?.target ?? null) : null
    if (this.dashTarget) {
      if (this.dashTarget.anchorUsed) this.dashTarget = null
      else this.dashTarget.anchorUsed = true
    }
    if (th && !an) {
      const src = th.src
      if (src && !src.dead && Math.abs(src.x - this.x) < 460 && !src.flying) {
        dx = Math.sign(src.x - this.x) || this.facing
        dy = 0
      }
    }
    const n = Math.hypot(dx, dy)
    this.dvx = dx / n
    this.dvy = dy / n
    this.bx0 = this.x
    this.by0 = this.y
    this.dashFromX = this.x
    this.dashFromY = this.y
    this.dodgeRewarded = false
    this.dodgeCounters.clear()
    if (an) {
      this.bx1 = an.x
      this.by1 = an.y
    } else {
      this.bx1 = this.x + this.dvx * DASH_DIST
      this.by1 = Math.min(GROUND_Y, this.y + this.dvy * DASH_DIST)
    }
    this.bx1 = clamp(this.bx1, b.l + this.w / 2, b.r - this.w / 2)
    const dist = Math.hypot(this.bx1 - this.bx0, this.by1 - this.by0)
    this.blinkN = an ? clamp(Math.round(dist / 260), BLINK, 8) : BLINK
    if (Math.abs(this.bx1 - this.bx0) > 4) this.facing = Math.sign(this.bx1 - this.bx0)
    this.state = 'dash'
    this.st = 0
    this.dashT = 0
    this.dashCd = 18
    this.move = null
    if (an) {
      this.airDashed = false
      this.jumps = 0
    } else if (!this.onGround) this.airDashed = true
    this.vx = this.vy = 0
    this.flying = true
    this.onGround = false
    this.world.sfx.play('dash')
    this.dashRibbon = this.blinkTrail(this.bx0, this.by0, this.bx0, this.by0)
    if (th) this.extremeDodge(th)
  }

  /** Cinematic approaches can lay out the whole path; a normal dodge extends this ribbon as it moves. */
  blinkTrail(x0: number, y0: number, x1: number, y1: number) {
    const fx = this.world.fx
    fx.ghost(this.rig, COL.main, 0.8, 0.34)
    return fx.dashTrail(x0, y0 - this.h * 0.55, x1, y1 - this.h * 0.55)
  }
  private dash() {
    this.dashFromX = this.x
    this.dashFromY = this.y
    this.dashT++
    const t = Math.min(1, this.dashT / this.blinkN),
      fx = this.world.fx
    this.x = lerp(this.bx0, this.bx1, t)
    this.y = lerp(this.by0, this.by1, t)
    this.vx = this.vy = 0
    if (this.dashT < this.blinkN) {
      this.dashRibbon?.extend(this.x, this.y - this.h * 0.55)
      this.rig.setPos(this.x, this.y, this.facing)
      fx.ghost(this.rig, this.dashT % 2 ? COL.main : COL.cyan, 0.4, 0.26)
      return
    }
    if (this.dashT === this.blinkN) {
      const target = this.dashTarget
      this.dashTarget = null
      if (this.overloaded && target && !target.dead && !target.gone && target.state !== 'spawn') {
        const dir = Math.sign(target.x - this.bx0) || this.facing
        this.x = clamp(
          target.x - dir * Math.max(90, (this.w + target.w) / 2 + 15),
          this.world.bounds.l + this.w / 2,
          this.world.bounds.r - this.w / 2
        )
        this.y = Math.min(GROUND_Y, target.flying ? target.cy + this.h * 0.55 : target.y)
        this.facing = dir
        this.anchorSlash(target)
        this.bx1 = this.x
        this.by1 = this.y
      }
      this.dashRibbon?.extend(this.x, this.y - this.h * 0.55)
      this.dashRibbon = null
      this.flying = false
      this.squash = 0.1
      this.an.play(target && this.overloaded ? A.exCutA : this.groundBelow() - this.y < 6 ? A.idle : A.fall, 2, true)
      fx.ring(this.x, this.y - this.h * 0.55, 0xffffff, 70, 20, 0.14)
      this.vy = this.groundBelow() - this.y < 6 ? 0 : -160
    }
    const inp = this.world.ctl,
      ground = this.groundBelow() - this.y < 30
    if (inp.peek('exec') && this.world.tryExecute()) {
      inp.take('exec')
      return
    }
    if (inp.take('light')) {
      this.startMove(ground ? 'l3' : 'al1')
      return
    }
    if (inp.take('heavy')) {
      if (ground) this.startMove(inp.down.up ? 'launcher' : 'h1')
      else this.startDive()
      return
    }
    if (inp.peek('jump') || this.dashT >= this.blinkN + 3) this.set('free')
  }

  /** Sweep the whole blink segment, not just the positions drawn at either end. */
  dodgeTouches(box: Box, attackDx = 0, attackDy = 0) {
    return segmentBox(this.dashFromX + attackDx, this.dashFromY - this.h / 2 + attackDy, this.x, this.y - this.h / 2, {
      x: box.x - this.w / 2,
      y: box.y - this.h / 2,
      w: box.w + this.w,
      h: box.h + this.h,
    })
  }

  /** Dodging inside an enemy's attack window: the hit is cancelled and the attacker is cut in passing. */
  private anchorSlash(target: Enemy) {
    const fx = this.world.fx,
      damage = ANCHOR_SLASH.dmg * this.damageMultiplier
    if (!target.takeHit(ANCHOR_SLASH, this, this.facing)) return
    fx.cut(target.cx, target.cy, -0.45 * this.facing, 760, COL.main, 0.24, 1.1)
    fx.cut(target.cx, target.cy, -0.45 * this.facing + 0.08, 680, COL.pink, 0.22, 0.7)
    fx.weld(target.cx, target.cy, -0.45 * this.facing, 30, 1.2, GROUND_Y)
    fx.text(target.x, target.y - target.h - 30, String(Math.round(damage)), '#ff9fe6', 40)
    this.world.hitstop(ANCHOR_SLASH.stop)
    this.world.combo(1)
    this.gainEnergy(5)
    this.world.sfx.play('hitHeavy')
  }

  extremeDodge(th: Threat, counter = true) {
    const fx = this.world.fx,
      src = th.src
    th.negate()
    if (!this.dodgeRewarded) {
      this.dodgeRewarded = true
      this.invuln = Math.max(this.invuln, 70)
      this.extremeT = 70
      this.gainEnergy(30)
      fx.flash(this.cx, this.cy, COL.cyan, 1.4, 0.25)
      fx.coreBurst(this.cx, this.cy, 0.45)
      fx.ghost(this.rig, COL.pink, 0.8, 0.38)
      this.world.sfx.play('perfect')
    }
    if (counter && src && !src.dead && !src.gone && !this.dodgeCounters.has(src)) {
      this.dodgeCounters.add(src)
      const hit = { ...RIPOSTE, multiplier: this.damageMultiplier }
      if (this.world.tryCounter(src, hit)) return
      const dir = Math.sign(src.x - this.bx0) || this.facing
      const ang = Math.atan2(src.cy - this.cy, src.x - this.x)
      fx.slash(src.cx, src.cy, 'slash_wide', ang + randRange(-0.6, 0.5), 1.35, dir, COL.cyan, { life: 0.34 })
      fx.cut(src.cx + randRange(-24, 24), src.cy, ang + 0.5 * dir, 880, COL.pink, 0.3, 1.3)
      fx.weld(src.cx, src.cy, ang, 48, 1.6, GROUND_Y)
      fx.seam(src.cx, src.cy, ang + 0.5 * dir, 230)
      const damage = RIPOSTE.dmg * this.damageMultiplier
      if (src.takeHit(RIPOSTE, this, dir)) {
        fx.text(src.x, src.y - src.h - 30, String(Math.round(damage)), '#ff9fe6', 40)
        this.world.combo(1)
        this.world.shake(8, 0.02)
        this.world.sfx.play('exCut')
        this.world.sfx.play('hitHeavy')
      }
    }
  }

  /* ------------------------------ damage ------------------------------ */

  takeHit(hit: HitDef, src: Actor | null, dir: number): boolean {
    if (this.dead || this.cine) return false
    if (this.state === 'dash') {
      this.extremeDodge({ src, negate() {} })
      return false
    }
    if (this.invuln > 0) return false
    const fx = this.world.fx
    if (hit.dmg > 0 && this.energy >= SHIELD_COST) {
      this.gainEnergy(-SHIELD_COST)
      fx.guard(this.cx, this.cy, dir)
      // Count this attack as consumed so a lingering hitbox cannot spend another cell next frame.
      return true
    }
    this.hp -= hit.dmg
    this.damageTaken += hit.dmg
    this.move = null
    this.chargeT = 0
    this.state = 'hurt'
    this.st = 0
    this.stun = clamp(hit.stun, 14, 30)
    this.vx = dir * Math.min(hit.kx, 560)
    if (hit.ky < 0) {
      this.vy = Math.max(hit.ky * 0.55, -620)
      this.onGround = false
    }
    this.invuln = 60
    this.flashT = 5
    this.world.hitstop(7)
    this.world.shake(11, 0.03)
    fx.spark(this.cx, this.cy, dir > 0 ? 0 : Math.PI, 12, COL.hostile, 1)
    fx.weld(this.cx, this.cy, dir > 0 ? 0 : Math.PI, 14, 0.9, GROUND_Y)
    fx.screenFlash(0xff2040, 0.22, 0.25)
    this.world.sfx.play('hurt')
    this.world.combo(0)
    if (this.hp <= 0) {
      this.hp = 0
      this.dead = true
      this.overloadT = this.overloadCd = 0
      this.state = 'dead'
      this.vy = -500
      this.vx = dir * 420
      this.onGround = false
      this.world.slowmo(0.25, 70)
    }
    return true
  }

  render(alpha: number, time: number) {
    this.rig.squash = this.cine ? 0 : this.squash
    this.rig.extraRot = this.cine ? 0 : this.lean
    super.render(alpha, time)
    const blink =
      this.invuln > 0 &&
      this.state !== 'dash' &&
      !this.cine &&
      this.extremeT <= 0 &&
      !this.dead &&
      Math.floor(time * 30) % 2 === 0
    const gone = this.cine ? this.hidden : this.blinking
    this.rig.setAlpha(gone ? 0 : blink ? 0.45 : 1)
    this.tail.setVisible(!gone)
    this.shadow.setVisible(!gone)
    this.tail.update(
      this.rig.wx(this.rig.neck.x - 5 * this.facing),
      this.rig.wy(this.rig.neck.y + 8),
      this.facing + this.vx / 700,
      time
    )
  }
  protected applyTint() {
    if (this.overloaded) this.rig.setTintMul(0xe6d4ff)
    else if (this.extremeT > 0) this.rig.setTintMul(0xd8ecff)
    else this.rig.setFlash(null)
  }
}
