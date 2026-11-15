import * as Phaser from 'phaser'

import { Actor, HitDef, Threat, World } from './actor'
import type { Enemy } from './enemies'

import { A, Anim } from '../art/anims'
import type { SfxName } from '../audio/sfx'
import { COL, DEPTH, GROUND_Y } from '../config'
import { Box, approach, clamp, lerp, randRange, segmentBox, smooth } from '../core/util'
import { Stage3D } from '../three/stage3d'

const RUN = 1110,
  // At 60 Hz these reach 468 / 368 units, 1.5× the previous 312 / 245.3 peaks.
  JUMP = 1757.5,
  JUMP2 = 1561.4,
  // releasing the button early still carries her about 300 up: enough to step onto any platform's first tier
  JUMP_CUT = 1420,
  DASH_DIST = 360,
  BLINK = 5
export const SHIELD_COST = 20
export const OVERLOAD_DURATION = 15
export const OVERLOAD_COOLDOWN = 5
export const CHARGE_DURATION = 1.5
/** Outside overload a charge is paid for in energy cells: one to begin, one more per second, three at most. */
export const CELL_CHARGE_DURATION = 2,
  CELL_CHARGE_MIN = 2,
  CELL_CHARGE_MAX = 3,
  CHARGE_COOLDOWN = 5

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
  sfx?: SfxName
}
interface Move {
  anim: Anim
  len: number
  /** from this frame the move can be left for anything else: a light attack, a jump, or simply walking */
  cancel: number
  /**
   * From this frame the next heavy stage may begin (default: `cancel`). The gap between the two is the stage's
   * recovery: it sets the pace of the heavy chain without ever locking the hero in place.
   */
  chain?: number
  air?: boolean
  heavy?: boolean
  hits: { from: number; to: number; box: [number, number, number, number]; hit: HitDef }[]
  fx: MoveFx[]
  step?: [from: number, to: number, v: number][]
  nextL?: string
  nextH?: string
  jumpCancel?: number
}

/** the third heavy stage: the frame the body comes back on, once the last afterimage has cut */
const H3_BACK = 22,
  /** how long after a heavy stage is left (or runs out) a heavy press still continues the chain */
  CHAIN_MEMORY = 14

export const MOVES: Record<string, Move> = {
  l1: {
    anim: A.l1,
    len: 24,
    cancel: 10,
    nextL: 'l2',
    nextH: 'launcher',
    step: [[1, 7, 300]],
    hits: [{ from: 6, to: 10, box: [-17, -225, 217, 233], hit: H(10, 170, 0, 22, 6, 6) }],
    fx: [{ at: 6, key: 'slash', x: 22, y: -140, rot: 0.1, scale: 0.7, sfx: 'swing' }],
  },
  l2: {
    anim: A.l2,
    len: 24,
    cancel: 10,
    nextL: 'l3',
    nextH: 'launcher',
    step: [[1, 6, 280]],
    hits: [{ from: 5, to: 9, box: [-17, -242, 217, 250], hit: H(10, 150, -140, 22, 6, 6) }],
    fx: [{ at: 5, key: 'slash', x: 22, y: -133, rot: -0.1, scale: 0.7, flipY: true, sfx: 'swing' }],
  },
  l3: {
    anim: A.l3,
    len: 26,
    cancel: 12,
    nextL: 'l4',
    nextH: 'whirl',
    step: [[4, 9, 980]],
    hits: [{ from: 7, to: 12, box: [8, -150, 250, 83], hit: H(12.5, 420, 0, 26, 7, 7) }],
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
      { from: 4, to: 7, box: [-167, -167, 358, 150], hit: H(7.5, 60, -80, 20, 5, 6) },
      { from: 10, to: 14, box: [-167, -167, 358, 150], hit: H(10, 240, -120, 24, 7, 7) },
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
    nextH: 'h2',
    step: [[8, 13, 420]],
    hits: [
      {
        from: 12,
        to: 17,
        box: [-25, -275, 250, 283],
        hit: H(22.5, 560, -520, 34, 12, 14, { knock: true, heavy: true }),
      },
    ],
    fx: [{ at: 12, key: 'slash_wide', x: 25, y: -158, rot: 0.5, scale: 0.83, life: 0.26, sfx: 'swingHeavy' }],
  },
  // The heavy chain reaches far: a straight rising cleave, a turning reverse-grip cut (the workhorse),
  // a flurry by afterimages while the body is gone, and the falling wheel (which is its own state).
  h1: {
    heavy: true,
    anim: A.h1,
    len: 48,
    cancel: 22,
    chain: 32,
    nextL: 'l1',
    nextH: 'h2',
    step: [[11, 17, 560]],
    hits: [{ from: 15, to: 20, box: [-60, -200, 560, 220], hit: H(25, 480, -200, 34, 13, 14, { heavy: true }) }],
    fx: [{ at: 15, key: 'slash_wide', x: 60, y: -100, rot: 0, scale: 1.9, sy: 0.34, life: 0.26, sfx: 'swingHeavy' }],
  },
  h2: {
    heavy: true,
    anim: A.h2,
    len: 42,
    cancel: 15,
    chain: 26,
    nextL: 'l1',
    nextH: 'h3',
    step: [[4, 10, 600]],
    // the workhorse: a long pause on contact, a lesser execution bloom on the body, and small frames left reeling
    hits: [
      {
        from: 9,
        to: 14,
        box: [-90, -240, 660, 260],
        hit: H(30, 440, -160, 34, 16, 14, { heavy: true, pause: true, bloom: 0.8, stagger: 48 }),
      },
    ],
    // a flattened crescent in front: it falls diagonally, but the cut itself is level with the body
    fx: [{ at: 9, key: 'slash', x: 70, y: -165, rot: 0.3, scale: 1.9, sy: 0.6, life: 0.26, sfx: 'swingHeavy' }],
  },
  h3: {
    heavy: true,
    anim: A.h3,
    len: 40,
    cancel: H3_BACK,
    chain: H3_BACK + 9,
    nextL: 'l1',
    nextH: 'h4',
    hits: [5, 11, 17].map((from) => ({
      from,
      to: from + 2,
      box: [-40, -240, 740, 260] as [number, number, number, number],
      hit: H(12, 120, -60, 26, 5, 8, { heavy: true }),
    })),
    fx: [],
  },
  // the landing is the chain's heaviest recovery: other actions are open at once, another heavy is a long wait
  gearLand: {
    heavy: true,
    anim: A.gearLand,
    len: 44,
    cancel: 14,
    chain: 30,
    nextL: 'l1',
    nextH: 'h1',
    hits: [],
    fx: [],
  },
  launcher: {
    heavy: true,
    anim: A.launcher,
    len: 30,
    cancel: 14,
    jumpCancel: 10,
    nextL: 'l1',
    nextH: 'h2',
    step: [[3, 8, 240]],
    hits: [{ from: 8, to: 13, box: [-8, -283, 183, 292], hit: H(15, 30, -1280, 40, 10, 10, { heavy: true }) }],
    fx: [{ at: 8, key: 'slash', x: 17, y: -133, rot: -0.55, scale: 0.9, flipY: true, life: 0.24, sfx: 'swingHeavy' }],
  },
  whirl: {
    heavy: true,
    anim: A.whirl,
    len: 42,
    cancel: 30,
    nextL: 'l1',
    nextH: 'h2',
    step: [[1, 26, 380]],
    hits: [
      { from: 4, to: 8, box: [-183, -167, 367, 150], hit: H(7.5, 40, -60, 20, 5, 6) },
      { from: 12, to: 16, box: [-183, -167, 367, 150], hit: H(7.5, 40, -60, 20, 5, 6) },
      {
        from: 20,
        to: 26,
        box: [-200, -183, 400, 175],
        hit: H(18.75, 600, -420, 34, 12, 14, { knock: true, heavy: true }),
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
    hits: [{ from: 5, to: 9, box: [-17, -225, 217, 242], hit: H(8.75, 60, -340, 24, 6, 6) }],
    fx: [{ at: 5, key: 'slash', x: 25, y: -125, rot: 0.15, scale: 0.79, sfx: 'swing' }],
  },
  al2: {
    anim: A.al2,
    len: 20,
    cancel: 9,
    air: true,
    nextL: 'al3',
    nextH: 'dive',
    hits: [{ from: 5, to: 9, box: [-17, -242, 217, 258], hit: H(8.75, 60, -340, 24, 6, 6) }],
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
        hit: H(17.5, 320, 950, 30, 11, 12, { knock: true, spike: true, heavy: true }),
      },
    ],
    fx: [{ at: 9, key: 'slash_wide', x: 17, y: -125, rot: 0.5, scale: 0.92, life: 0.24, sfx: 'swingHeavy' }],
  },
  diveLand: { anim: A.diveLand, len: 22, cancel: 12, nextL: 'l1', nextH: 'h1', hits: [], fx: [] },
  chargeRelease: { anim: A.chargeRelease, len: 28, cancel: 20, nextL: 'l1', nextH: 'h1', hits: [], fx: [] },
}
const DIVE_FALL = H(10, 80, 700, 24, 6, 7, { spike: true, heavy: true })
const DIVE_LAND = H(20, 340, -760, 36, 12, 16, { heavy: true, knock: true })
/** the light plunge: quicker, narrower and without the shockwave */
const PLUNGE_FALL = H(8.75, 60, 600, 22, 4, 5, { spike: true })
const PLUNGE_LAND = H(10, 220, -320, 26, 6, 8, {})
/** the wheel: a tooth every few frames on the way down, and one heavy bite on landing */
const GEAR_TOOTH = H(7, 60, 120, 20, 3, 5, { heavy: true })
const GEAR_LAND = H(32, 520, -620, 40, 20, 18, { heavy: true, knock: true, bloom: 1, stagger: 64 })
// The wheel's rim reaches a body standing against her from the first frame, and the fall leaves room for five teeth.
/** radians the wheel turns each frame: about 0.38 of a turn, 23 turns a second */
const GEAR_SPIN = 2.39996
const GEAR_RISE = 300,
  GEAR_FALL = 900,
  GEAR_RUN = 600,
  GEAR_REACH = 225
/** how many moves in a row hang in the air before gravity takes over again */
const AIR_HOLDS = 6
/** how long an air dodge holds her up afterwards: longer than the dodge's cooldown, so they chain */
const AIR_HANG = 26
/** frames taken to ease from the end of an action back into the standing pose */
const SETTLE = 20
/** Holding the heavy button this many frames into the first stage turns it into a dash that ends in that stage. */
const LUNGE_HOLD = 10,
  LUNGE_DIST = DASH_DIST * 1.25
/** how high the overload charge carries the body */
export const VERDICT_LEAP = 300
/** An extreme dodge opens with this much slow motion (speed, then real frames) before its counter. */
const EXTREME_SLOW = 0.12,
  EXTREME_SLOW_FRAMES = 26
/** The charged surge keeps its own base, independent of the light and heavy attack tables. */
const SURGE_BASE = 20
/** What an extreme dodge does to the attacker. Slashes delivered through a dodge finish a target they empty. */
const RIPOSTE = H(72, 380, -420, 54, 14, 16, { heavy: true, finish: true })
const ANCHOR_SLASH = H(75, 320, -180, 34, 10, 0, { heavy: true, finish: true })

export class Player extends Actor {
  overloadT = 0
  overloadCd = 0
  chargeT = 0
  /** seconds until an energy-paid charge can be started again */
  chargeCd = 0
  /** cells paid into the current charge; 0 while the charge is the free overload one */
  chargeCells = 0
  /** Both buttons are still down from the last charge: they must be let go before another can begin. */
  private chargeLatch = false
  /** a heavy press made during a stage or its recovery, waiting for the recovery to end */
  private heavyQueued = false
  /** frames before another heavy stage may begin, carried out of a stage that was left early */
  private heavyLock = 0
  /** the stage a heavy press continues with for a moment after the last one was left or ran out */
  private chainNext: string | null = null
  private chainT = 0
  /** 0..1 in real time: how far the overload charge has lifted the body off the floor */
  chargeLift = 0
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
  /** frames left of the hang that follows an air dodge */
  private hangT = 0
  private bx0 = 0
  private by0 = 0
  private bx1 = 0
  private by1 = 0
  private blinkN = BLINK
  private dashTarget: Enemy | null = null
  private dashRibbon: ReturnType<World['fx']['dashTrail']> | null = null
  private dashFromX = 0
  private dashFromY = 0
  /** how the ghosted lunge is tipped along a rising or falling dodge */
  private dashTilt = 0
  /** the current move was started in the air and is played hovering */
  private moveAir = false
  /** moves begun since leaving the floor; only the first few hold her up, so no chain can climb forever */
  private airMoves = 0
  /** the dash into the first heavy stage has been spent on this press */
  private lunged = false
  private lungeT = 0
  private lungeN = 1
  private diveHeavy = true
  private gearRot = 0
  private dodgeRewarded = false
  private dodgeCounters = new Set<Actor>()
  /** frames left of the post-extreme-dodge glow */
  extremeT = 0
  /** The counter waits out the slow-motion beat that marks the extreme dodge. */
  private counterPending: { src: Actor; hit: HitDef; wait: number } | null = null
  private jumps = 0
  private coyote = 0
  private jumping = false
  private stun = 0
  /** The light under the hero: a wide spill and a brighter centre on the floor, and a haze around her legs. */
  private footLight: Phaser.GameObjects.Image[]
  private wheel: Phaser.GameObjects.Image[]
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
    this.footLight = [DEPTH.floor + 6, DEPTH.floor + 6.01, DEPTH.tail].map((depth) =>
      world.stage.add.image(0, 0, 'glow').setDepth(depth).setBlendMode(Phaser.BlendModes.ADD)
    )
    // the wheel of the fourth heavy stage: three discs of blade light turning against each other
    this.wheel = [0, 1, 2].map((i) =>
      world.stage.add
        .image(0, 0, 'gear_wheel')
        .setDepth(DEPTH.frontFx + 1 + i * 0.01)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false)
    )
    this.applyPose(this.an.update(0))
    this.state = 'free'
  }

  /** An extreme dodge has just triggered and is being held in slow motion before its counter. */
  get dodgeBeat() {
    return !!this.counterPending && !this.dead
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
  /** how long the current kind of charge takes to fill */
  get chargeSpan() {
    return this.chargeCells > 0 ? CELL_CHARGE_DURATION : CHARGE_DURATION
  }
  get chargePower() {
    return 6 + 6 * clamp(this.chargeT / this.chargeSpan, 0, 1)
  }
  /** The overload charge: free, held aloft, with the world slowed around it. */
  get overCharging() {
    return this.charging && this.chargeCells === 0
  }
  /** Overload charges freely; otherwise it takes two full cells and no cooldown. */
  get canCharge() {
    return this.overloaded || (this.chargeCd <= 0 && this.energy >= CELL_CHARGE_MIN * SHIELD_COST)
  }
  activateOverload() {
    if (this.dead || this.cine || this.overloaded || this.overloadCd > 0) return false
    this.overloadT = OVERLOAD_DURATION
    // the wave that clears the air of bullets is seen again: the whole view ripples outward from her
    this.world.fx.ripple(this.cx, this.cy, 2600, 0.72, 1)
    this.world.fx.overloadEnter(this.cx, this.cy)
    this.world.sfx.play('overload')
    return true
  }
  /** Unscaled seconds of play; pausing is handled by the scene. */
  updateOverload(dt: number) {
    if (this.dead) {
      this.overloadT = this.overloadCd = 0
      this.chargeT = this.chargeCd = 0
      return
    }
    this.chargeCd = Math.max(0, this.chargeCd - dt)
    if (this.chargeCd < 1e-7) this.chargeCd = 0
    // the leap runs on the wall clock: the hero is the one thing the slowed world does not hold back
    this.chargeLift = this.overCharging
      ? Math.min(1, this.chargeLift + dt / 0.3)
      : Math.max(0, this.chargeLift - dt / 0.15)
    if (this.charging && this.chargeCells > 0) {
      // One cell is paid on starting and one at each full second; running dry lets the charge go early.
      this.chargeT = Math.min(CELL_CHARGE_DURATION, this.chargeT + dt)
      const due = Math.min(CELL_CHARGE_MAX, 1 + Math.floor(this.chargeT + 1e-7))
      while (this.chargeCells < due && this.energy >= SHIELD_COST) {
        this.gainEnergy(-SHIELD_COST)
        this.chargeCells++
      }
      const dry = this.energy < SHIELD_COST && this.chargeCells < CELL_CHARGE_MAX
      if (this.chargeCells < due || dry || this.chargeT >= CELL_CHARGE_DURATION - 1e-7) {
        this.releaseCharge()
        return
      }
    } else if (this.charging) {
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
    // Letting go of either button re-arms the charge whatever she is doing, so a hold that outlived its release
    // cannot start another one, while a fresh press made during the release swing is not lost.
    if (!this.world.ctl.down.light || !this.world.ctl.down.heavy) this.chargeLatch = false
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
    if (this.heavyLock > 0) this.heavyLock--
    // the hang belongs to the dodge and the drift after it; any other action gives it up
    if (this.state !== 'free' && this.state !== 'dash') this.hangT = 0
    // the chain is only remembered across walking and jumping; any other action starts it over
    if (this.state !== 'free' && this.state !== 'attack') this.chainT = 0
    if (this.chainT > 0) this.chainT--
    if (this.chainT <= 0) this.chainNext = null
    if (this.counterPending && !this.dead && --this.counterPending.wait <= 0) {
      this.counter()
      // the counter cinematic owns the body from here
      if (this.cine) return
    }
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
        case 'gear':
          this.gear()
          break
        case 'lunge':
          this.lunge()
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
      this.airMoves = 0
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
    // the second heavy stage is cut with the other hand, blade down from the fist
    this.rig.mirror = this.rig.reverseGrip = this.state === 'attack' && this.move === MOVES.h2
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
    this.hang()
    if (inp.take('jump')) {
      this.hangT = 0
      this.doJump()
    }
    if (this.jumping && !inp.down.jump && this.vy < -JUMP_CUT) this.vy = -JUMP_CUT
    if (this.onGround) {
      const moving = Math.abs(this.vx) > 60,
        // coming out of an action she settles back into her stance unhurriedly; breaking into a run stays quick
        settling = !moving && ![A.idle, A.run, A.jump, A.fall].includes(this.an.anim)
      this.an.play(moving ? A.run : A.idle, settling ? SETTLE : 5)
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
    if (inp.down.light && inp.down.heavy && !this.chargeLatch && this.canCharge) {
      this.startCharge()
      return true
    }
    // in the air as on the floor: a dodge is always there once its cooldown has run
    if (inp.peek('dash') && this.dashCd <= 0) {
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
      if (!this.onGround && inp.down.down) this.startDive(false)
      else this.startMove(this.onGround ? 'l1' : 'al1')
      return true
    }
    // a press made inside the last stage's recovery stays buffered and comes out when the recovery is over
    if (this.heavyLock <= 0 && inp.take('heavy')) {
      // in the air the whole heavy chain is available; only down + heavy is the plunge
      if (!this.onGround && inp.down.down) this.startDive(true)
      else if (this.onGround && inp.down.up) this.startMove('launcher')
      else if (this.chainNext === 'h4') this.startGear()
      else this.startMove(this.chainNext ?? 'h1')
      return true
    }
    return false
  }

  /** Leaving a heavy stage for free movement keeps its place in the chain for a moment, and its recovery. */
  private leaveHeavy(m: Move, f: number) {
    this.heavyQueued = false
    if (!m.heavy || !m.nextH) return
    const wait = Math.max(0, (m.chain ?? m.cancel) - f)
    this.heavyLock = wait
    this.chainNext = m.nextH
    this.chainT = wait + CHAIN_MEMORY
  }

  /* ------------------------------ attacks ------------------------------ */

  startMove(name: string, lunged = false) {
    // off the floor the light chain is always the aerial one
    if (!this.onGround && /^l[1-5]$/.test(name)) name = 'al1'
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
    this.lunged = lunged
    this.heavyQueued = false
    this.chainNext = null
    this.chainT = 0
    this.state = 'attack'
    this.st = 0
    this.an.play(m.anim, 3, true)
    this.moveAir = !!m.air || !this.onGround
    if (this.moveAir) {
      if (this.airMoves++ < AIR_HOLDS) this.vy = Math.min(this.vy, -120)
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
    if (m === MOVES.h1 && f === LUNGE_HOLD && inp.down.heavy && !this.lunged) {
      this.startLunge()
      return
    }
    if (this.moveAir) {
      this.gravity = f < m.len * 0.75 && this.airMoves <= AIR_HOLDS ? (m.air ? 0.22 : 0.1) : 1
      this.vx = approach(this.vx, inp.axis * RUN * 0.5, 40)
      if (this.onGround) {
        if (m.air) {
          this.set('free')
          return
        }
        // a heavy stage begun in the air carries on from the floor
        this.moveAir = false
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
        if (m.air && this.airMoves <= AIR_HOLDS) this.vy = Math.min(this.vy, -260)
      }
      // the overload's second cut repeats the damage, not the bloom
      if (m.heavy && this.overloaded && f >= h.from + 2)
        this.world.attack(this, box, hit.bloom ? { ...hit, bloom: undefined } : hit, this.echoSet)
    }
    if (m === MOVES.l5 && f === 14) {
      fx.dust(this.x + this.facing * 130, this.y, this.facing, 8)
      fx.ring(this.x + this.facing * 130, this.y, COL.main, 30, 220, 0.3, 0.25)
      this.squash = -0.1
    }
    if (m === MOVES.h3) this.phantom(f, scale)
    if (f >= 3 && this.tryCommon(true)) return
    if (m.jumpCancel && f >= m.jumpCancel && this.landedHit && inp.take('jump')) {
      this.set('free')
      this.onGround = true
      this.doJump()
      this.vy = -JUMP * 1.05
      return
    }
    const chainAt = m.chain ?? m.cancel
    // A heavy press made once the blade is out is kept through the recovery, so mashing still walks the chain.
    if (m.chain && f < chainAt && f >= (m.hits[0]?.from ?? 0) && inp.peek('heavy')) {
      inp.take('heavy')
      this.heavyQueued = true
    }
    if (f >= m.cancel) {
      if (f >= chainAt && (this.heavyQueued || inp.peek('heavy'))) {
        inp.take('heavy')
        this.heavyQueued = false
        if (!this.onGround && inp.down.down) this.startDive(true)
        else if (m.nextH === 'h4') this.startGear()
        else this.startMove(this.onGround && inp.down.up ? 'launcher' : m.air ? 'h1' : (m.nextH ?? 'h1'))
        return
      }
      if (m.air && inp.peek('light') && inp.down.down) {
        inp.take('light')
        this.startDive(false)
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
      // Walking out: at once from a stage that has a recovery (unless the next stage is already asked for),
      // after a short beat from the others.
      if (f >= m.cancel + (m.chain ? 0 : 6) && inp.axis && !m.air && !this.heavyQueued) {
        this.leaveHeavy(m, f)
        this.set('free')
        return
      }
    }
    if (f >= m.len) {
      this.leaveHeavy(m, f)
      this.move = null
      this.set('free')
    }
  }

  private startCharge() {
    this.chargeT = 0
    this.chargeCells = 0
    if (!this.overloaded) {
      this.gainEnergy(-SHIELD_COST)
      this.chargeCells = 1
    }
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
    // seen from overhead the gathering light is carried by the body itself, not by sprites in the side view
    if (this.st % 5 === 0 && !this.overCharging) {
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
      paid = this.chargeCells > 0,
      fx = this.world.fx
    if (paid) {
      this.world.spawnSurge(H(3 * power * SURGE_BASE, 720, -240, 48, 9, 0, { heavy: true, multiplier: 1 }))
      fx.slash(this.x + this.facing * 60, this.cy, 'slash_wide', -0.25, 1.8, this.facing, COL.cyan, { life: 0.4 })
      fx.weld(this.x + this.facing * 100, this.cy, this.facing > 0 ? 0 : Math.PI, 38, 1.6, GROUND_Y)
      this.chargeCd = CHARGE_COOLDOWN
    } else {
      // She is where the leap carried her: turn, and cut straight down on everything below.
      this.y = this.py = this.y - VERDICT_LEAP * smooth(this.chargeLift)
      this.chargeLift = 0
      this.onGround = false
      this.vy = 0
      this.world.spawnVerdict(H(MOVES.h1.hits[0].hit.dmg, 40, -40, 16, 0, 0, { heavy: true, multiplier: 1.2 }))
      fx.slash(this.x, this.cy, 'slash_wide', 1.4, 2.1, -dir, COL.pink, { life: 0.4 })
      fx.screenFlash(0xffd0f0, 0.22, 0.16)
      this.overloadT = 0
      this.overloadCd = OVERLOAD_COOLDOWN
    }
    this.world.sfx.play('overload')
    this.chargeT = 0
    this.chargeCells = 0
    this.chargeLatch = true
    this.world.ctl.clear()
    this.startMove('chargeRelease')
    this.facing = paid ? dir : -dir
  }

  /** Down + attack in the air. The heavy plunge ends in a shockwave; the light one is quicker and narrower. */
  private startDive(heavy = true) {
    this.diveHeavy = heavy
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
    const heavy = this.diveHeavy,
      wind = heavy ? 9 : 5
    if (this.mf < wind) {
      this.gravity = 0
      this.vy = approach(this.vy, 0, 80)
      this.vx = approach(this.vx, 0, 60)
      if (this.mf === wind - 1) this.world.sfx.play(heavy ? 'swingHeavy' : 'swing')
    } else if (!heavy) {
      this.gravity = 0
      this.vy = 2300
      this.vx = this.facing * 260
      this.world.attack(this, this.fbox(-60, -160, 120, 200), PLUNGE_FALL, this.hitSet)
      if (this.mf === wind)
        this.world.fx.attackSlash(this.x, this.y - 90, 'slash', 1.2, 0.8, this.facing, COL.main, { life: 0.22 })
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
    if (this.state === 'dive' && this.mf >= (this.diveHeavy ? 9 : 5)) this.diveLand()
    else if (this.state === 'gear') this.gearLand()
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
    if (!this.diveHeavy) {
      this.world.attack(this, this.fbox(-150, -130, 300, 150), PLUNGE_LAND, this.hitSet)
      fx.ring(this.x, this.y, COL.main, 30, 200, 0.26, 0.26)
      fx.dust(this.x, this.y, 1, 4)
      fx.dust(this.x, this.y, -1, 4)
      fx.spark(this.x, this.y, -Math.PI / 2, 6, COL.main, 0.7, 1.4)
      this.world.sfx.play('land')
      this.vx = 0
      this.move = MOVES.diveLand
      this.mf = 6
      this.win = -1
      this.moveAir = false
      this.state = 'attack'
      this.st = 0
      this.an.play(A.diveLand, 2, true)
      return
    }
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
    this.moveAir = false
    this.state = 'attack'
    this.st = 0
    this.an.play(A.diveLand, 2, true)
  }

  /* ------------------------------ heavy chain: flurry and wheel ------------------------------ */

  /** While the third heavy stage plays the body is simply not there: it cannot be hit and is not drawn. */
  get phased() {
    return this.state === 'attack' && this.move === MOVES.h3 && this.mf >= 2 && this.mf < MOVES.h3.len - 2
  }

  /**
   * Third heavy stage. The body drops out like a lost signal and three afterimages cut through the space ahead,
   * each from a different place. The body never moves: it comes back where it left unless the wheel follows.
   */
  private phantom(f: number, scale: number) {
    const fx = this.world.fx,
      d = this.facing,
      cy = this.y - this.h * 0.55
    if (f === 2 || f === MOVES.h3.len - 2) {
      fx.glitch(this.x, this.y, this.w * 1.6, this.h)
      this.world.sfx.play('dash')
    }
    if (this.phased) this.invuln = Math.max(this.invuln, 2)
    // [frame, how far ahead, which way it faces, pose, slash tilt, flipped]
    const cuts: [number, number, number, string, number, number, boolean][] = [
      [5, 250, 1, 'Sword_Regular_A', 0.27, -0.4, false],
      [11, 560, -1, 'Sword_Regular_B', 0.3, 0.35, true],
      [17, 130, 1, 'Sword_Dash', 0.38, 0, false],
    ]
    for (const [at, ahead, turn, clip, time, tilt, flipY] of cuts) {
      if (f !== at) continue
      const x = this.x + d * ahead * scale,
        face = d * turn,
        pose = { clip, time, prev: null, prevTime: 0, w: 1 }
      this.rig.ghostAt(pose, x, this.y, face, COL.cyan, 0.6, 0.3)
      if (this.overloaded) this.rig.ghostAt(pose, x - face * 36, this.y, face, COL.pink, 0.45, 0.3)
      // two short crescents and a level sweep, each crossed by one long straight cut
      const sx = x + face * 70 * scale,
        key = tilt ? 'slash' : 'slash_wide',
        size = (tilt ? 1.25 : 1.5) * scale,
        options = { life: 0.22, sy: tilt ? 0.75 : 0.28, flipY }
      fx.attackSlash(sx, cy, key, tilt, size, face, COL.main, options)
      if (this.overloaded)
        fx.attackSlash(sx - face * 14, cy - 18, key, tilt - 0.08, size * 0.94, face, COL.pink, options)
      fx.cut(this.x + d * 360 * scale, cy + randRange(-40, 40), tilt * face, 900 * scale, COL.main, 0.2, 0.9)
      this.world.sfx.play('swing')
    }
  }

  /** Fourth heavy stage: reappear above where the third began and fall on the target as a spinning wheel. */
  private startGear() {
    const fx = this.world.fx,
      ax = this.world.ctl.axis
    if (ax) this.facing = ax
    this.state = 'gear'
    this.st = 0
    this.mf = 0
    this.move = null
    this.hitSet.clear()
    this.echoSet.clear()
    this.gearRot = 0
    // high enough that five teeth land before the floor does
    this.y = this.py = Math.min(this.y - 120, this.groundBelow() - GEAR_RISE)
    this.px = this.x
    this.onGround = false
    this.vx = this.vy = 0
    this.invuln = Math.max(this.invuln, 6)
    this.an.play(A.gear, 1, true)
    fx.glitch(this.x, this.y, this.w * 1.6, this.h)
    fx.ring(this.x, this.y - this.h * 0.5, COL.main, 30, 240, 0.28)
    this.world.sfx.play('swingHeavy')
  }
  private gear() {
    const fx = this.world.fx,
      k = this.heavyScale,
      d = this.facing,
      cy = this.y - this.h * 0.5,
      reach = GEAR_REACH * k
    this.mf++
    this.gravity = 0
    this.vy = GEAR_FALL
    this.vx = d * GEAR_RUN
    // She turns so fast that no two frames show the same figure: what is seen is the wheel, not the body. The
    // step per frame is far from any simple fraction of a turn, so the spin never appears to stand still.
    this.gearRot += d * GEAR_SPIN
    const box = { x: this.x - reach, y: cy - reach, w: reach * 2, h: reach * 2 }
    if (this.mf % 4 === 1) {
      // The cut is continuous; damage is still counted in bites, and each sheds a few sparks off the rim.
      this.hitSet.clear()
      const a = this.gearRot
      fx.spark(
        this.x + Math.cos(a) * reach * 0.9,
        cy + Math.sin(a) * reach * 0.9,
        a + (d * Math.PI) / 2,
        6,
        COL.cyan,
        0.9,
        0.5
      )
      this.world.sfx.play('swing')
    }
    if (this.mf % 4 === 3) this.echoSet.clear()
    this.world.attack(this, box, GEAR_TOOTH, this.hitSet)
    if (this.overloaded && this.mf % 4 >= 2) this.world.attack(this, box, GEAR_TOOTH, this.echoSet)
    // the turns between this frame and the last, left behind as a smear of bodies
    const pose = this.an.pose
    for (const part of [0.33, 0.66]) {
      this.rig.spin = this.gearRot - d * GEAR_SPIN * part
      this.rig.ghostAt(pose, this.x, this.y, d, part < 0.5 ? COL.main : COL.cyan, 0.3, 0.07)
    }
    this.rig.spin = this.gearRot
    if (this.onGround) this.gearLand() // already on the floor: nothing to fall through
  }
  /** The wheel bites into the floor: the last and heaviest cut of the chain. */
  private gearLand() {
    if (this.state !== 'gear') return
    const fx = this.world.fx,
      k = this.heavyScale,
      d = this.facing,
      cy = this.y - this.h * 0.5
    this.hitSet.clear()
    const box = this.heavyBox(-240, -230, 600, 250)
    this.world.attack(this, box, GEAR_LAND, this.hitSet)
    if (this.overloaded) this.world.attack(this, box, { ...GEAR_LAND, bloom: undefined }, new Set())
    // one deep cut across everything, crossed by two more, over a ring and a column of light
    fx.cut(this.x + d * 60, cy + 40, 0.5 * d, 1500 * k, 0xffffff, 0.34, 2.2)
    fx.cut(this.x + d * 60, cy + 40, 0.5 * d, 1700 * k, COL.main, 0.4, 3.4)
    fx.cut(this.x + d * 80, cy, -0.25 * d, 1100 * k, this.overloaded ? COL.pink : COL.cyan, 0.3, 1.4)
    fx.attackSlash(this.x + d * 70, cy + 20, 'slash_wide', 0.6, 2.1 * k, d, COL.main, { life: 0.32 })
    if (this.overloaded) fx.attackSlash(this.x + d * 56, cy, 'slash_wide', 0.5, 2 * k, d, COL.pink, { life: 0.32 })
    fx.ring(this.x + d * 80, this.y, COL.main, 40, 460 * k, 0.4, 0.26)
    fx.ring(this.x + d * 80, this.y, 0xffffff, 20, 300 * k, 0.26, 0.26)
    fx.pillar(this.x + d * 80, this.y, COL.main, 640 * k, 0.3, 1.1)
    fx.weld(this.x + d * 80, this.y, -Math.PI / 2, 60, 1.7, this.y, 1.6)
    fx.glint(this.x + d * 80, cy + 40, 0xffffff, 1.3, 0.24)
    fx.dust(this.x, this.y, 1, 9)
    fx.dust(this.x, this.y, -1, 9)
    fx.screenFlash(0xdfeeff, 0.16, 0.1)
    this.world.sfx.play('slam')
    this.squash = -0.16
    this.vx = 0
    this.gearRot = 0
    this.move = MOVES.gearLand
    this.mf = 0
    this.win = -1
    this.moveAir = false
    this.state = 'attack'
    this.st = 0
    this.an.play(A.gearLand, 2, true)
  }

  /* ------------------------------ dash into the first heavy stage ------------------------------ */

  /**
   * Holding heavy: dash forward until an enemy is in the way (or the dash runs out), then deliver the first heavy
   * stage from there. It is a dodge while it travels.
   */
  private startLunge() {
    const d = this.facing,
      b = this.world.bounds
    let stop = this.x + d * LUNGE_DIST
    for (const e of this.world.enemies) {
      if (e.dead || e.gone || e.state === 'spawn' || e.state === 'reviving') continue
      const ahead = (e.x - this.x) * d,
        gap = (e.w + this.w) / 2 + 30
      if (ahead <= 0 || ahead - gap > LUNGE_DIST || Math.abs(e.cy - this.cy) > 220) continue
      const at = e.x - d * gap
      if ((at - stop) * d < 0) stop = (at - this.x) * d < 0 ? this.x : at
    }
    this.bx0 = this.x
    this.by0 = this.y
    this.bx1 = clamp(stop, b.l + this.w / 2, b.r - this.w / 2)
    this.by1 = this.y
    this.lungeN = clamp(Math.round(Math.abs(this.bx1 - this.bx0) / 90), 1, BLINK)
    this.lungeT = 0
    this.dashTilt = 0
    this.state = 'lunge'
    this.st = 0
    this.move = null
    this.vx = this.vy = 0
    this.flying = true
    this.invuln = Math.max(this.invuln, this.lungeN + 2)
    this.an.play(A.dashLunge, 1, true)
    this.dashRibbon = this.blinkTrail(this.bx0, this.by0, this.bx0, this.by0, false)
    this.world.sfx.play('dash')
  }
  private lunge() {
    this.lungeT++
    const t = Math.min(1, this.lungeT / this.lungeN)
    this.x = lerp(this.bx0, this.bx1, t)
    this.vx = this.vy = 0
    this.dashRibbon?.extend(this.x, this.y - this.h * 0.55)
    if (this.lungeT < this.lungeN) return
    this.dashRibbon = null
    this.flying = false
    // the wind-up was spent travelling: the cut comes out almost at once
    this.startMove('h1', true)
    this.mf = LUNGE_HOLD + 1
    this.facing = Math.sign(this.bx1 - this.bx0) || this.facing
  }

  /* ------------------------------ dodge ------------------------------ */

  /**
   * Dodge: the body crosses the distance as a single ghosted lunge while long thin lines draw the path behind it.
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
    if (an) this.jumps = 0
    this.vx = this.vy = 0
    this.flying = true
    this.onGround = false
    this.world.sfx.play('dash')
    // lean the lunge along a rising or falling dodge
    this.dashTilt = Math.atan2(this.by1 - this.by0, Math.abs(this.bx1 - this.bx0) + 1e-3) * this.facing * 0.7
    this.an.play(A.dashLunge, 1, true)
    this.dashRibbon = this.blinkTrail(this.bx0, this.by0, this.bx0, this.by0, false)
    if (th) this.extremeDodge(th)
  }

  /** Cinematic approaches can lay out the whole path; a normal dodge extends this ribbon as it moves. */
  blinkTrail(x0: number, y0: number, x1: number, y1: number, ghost = true) {
    const fx = this.world.fx
    // cinematic approaches leave one afterimage where they set off; the dodge itself is the afterimage
    if (ghost) fx.ghost(this.rig, COL.main, 0.8, 0.34)
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
      // An air dodge leaves her hanging where it ended, long enough for the next one: dodges can be strung
      // together across the air without losing height.
      if (this.groundBelow() - this.y >= 6) this.hangT = AIR_HANG
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
      if (!ground && inp.down.down) this.startDive(false)
      else this.startMove(ground ? 'l3' : 'al1')
      return
    }
    if (inp.take('heavy')) {
      if (!ground && inp.down.down) this.startDive(true)
      else this.startMove(ground && inp.down.up ? 'launcher' : 'h1')
      return
    }
    this.hang()
    if (inp.peek('jump') || this.dashT >= this.blinkN + 3) this.set('free')
  }

  /** The hang after an air dodge: no fall until it runs out, she lands, or the player lets her drop. */
  private hang() {
    if (this.hangT <= 0) return
    if (this.onGround || this.world.ctl.down.down) {
      this.hangT = 0
      return
    }
    this.hangT--
    this.gravity = 0
    this.vy = approach(this.vy, 0, 60)
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
    const fx = this.world.fx
    if (!target.takeHit(ANCHOR_SLASH, this, this.facing)) return
    fx.cut(target.cx, target.cy, -0.45 * this.facing, 760, COL.main, 0.24, 1.1)
    fx.cut(target.cx, target.cy, -0.45 * this.facing + 0.08, 680, COL.pink, 0.22, 0.7)
    fx.weld(target.cx, target.cy, -0.45 * this.facing, 30, 1.2, GROUND_Y)
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
      fx.ring(this.cx, this.cy, 0xffffff, 40, 520, 0.4)
      this.world.sfx.play('perfect')
      // The moment itself is held: the world crawls for a beat before anything answers.
      this.world.slowmo(EXTREME_SLOW, EXTREME_SLOW_FRAMES)
    }
    if (counter && src && !src.dead && !src.gone && !this.dodgeCounters.has(src)) {
      this.dodgeCounters.add(src)
      this.counterPending = {
        src,
        hit: { ...RIPOSTE, multiplier: this.damageMultiplier },
        wait: Math.ceil(EXTREME_SLOW * EXTREME_SLOW_FRAMES),
      }
    }
  }

  /** The answer to an extreme dodge: the passing-cut cinematic where it can play, a plain cut where it cannot. */
  private counter() {
    const pending = this.counterPending!,
      src = pending.src,
      fx = this.world.fx
    this.counterPending = null
    if (!src.dead && !src.gone) {
      if (this.world.tryCounter(src, pending.hit)) return
      const dir = Math.sign(src.x - this.bx0) || this.facing
      const ang = Math.atan2(src.cy - this.cy, src.x - this.x)
      fx.slash(src.cx, src.cy, 'slash_wide', ang + randRange(-0.6, 0.5), 1.35, dir, COL.cyan, { life: 0.34 })
      fx.cut(src.cx + randRange(-24, 24), src.cy, ang + 0.5 * dir, 880, COL.pink, 0.3, 1.3)
      fx.weld(src.cx, src.cy, ang, 48, 1.6, GROUND_Y)
      fx.seam(src.cx, src.cy, ang + 0.5 * dir, 230)
      if (src.takeHit(RIPOSTE, this, dir)) {
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
    // The dodge and the dash into a heavy cut show the body as a translucent lunge.
    const ghosted = !this.cine && (this.blinking || this.state === 'lunge')
    this.rig.squash = this.cine ? 0 : this.squash
    this.rig.extraRot = this.cine ? 0 : ghosted ? this.dashTilt : this.state === 'gear' ? 0 : this.lean
    this.rig.spin = !this.cine && this.state === 'gear' ? this.gearRot : 0
    super.render(alpha, time)
    const blink =
      this.invuln > 0 &&
      this.state !== 'dash' &&
      !this.cine &&
      this.extremeT <= 0 &&
      !this.dead &&
      Math.floor(time * 30) % 2 === 0
    // the overload charge holds her above the floor; the logic position stays on it until she lets go
    if (this.chargeLift > 0) this.rig.setPos(this.rx, this.ry - VERDICT_LEAP * smooth(this.chargeLift), this.facing)
    const gone = this.cine ? this.hidden : this.phased
    const wheeling = !this.cine && this.state === 'gear'
    this.rig.setAlpha(gone ? 0 : wheeling ? 0.3 : ghosted ? 0.5 : blink ? 0.45 : 1)
    // The wheel: discs of blade light turning at different rates, one of them backwards, so the streaks never
    // line up into a still picture.
    const reach = (GEAR_REACH * this.heavyScale * 2) / 480
    this.wheel.forEach((im, i) => {
      im.setVisible(wheeling)
      if (!wheeling) return
      im.setPosition(this.rx, this.ry - this.h * 0.5)
        .setRotation(this.gearRot * [0.61, -0.43, 0.27][i] + time * [31, -23, 17][i])
        .setScale(reach * [1, 0.86, 1.08][i])
        .setTint([this.overloaded ? COL.pink : COL.main, 0xffffff, COL.cyan][i])
        .setAlpha([0.95, 0.8, 0.5][i] * (0.85 + 0.15 * Math.sin(time * 90 + i)))
    })
    this.shadow.setVisible(!gone)
    // The light stays on the floor: it spreads and dims as she leaves it, and turns violet under overload.
    const floor = this.groundBelow(),
      near = clamp(1 - (floor - this.ry) / 460, 0, 1),
      hot = this.overloaded,
      breathe = 0.93 + 0.07 * Math.sin(time * 3.1),
      power = gone ? 0 : (0.45 + 0.55 * near) * breathe * this.rig.alpha,
      [spill, centre, haze] = this.footLight
    spill
      .setVisible(power > 0)
      .setPosition(this.rx, floor + 8)
      .setScale(4.6 - 0.9 * near, 0.66)
      .setAlpha(0.9 * power)
      .setTint(hot ? 0x9a5cff : COL.main)
    centre
      .setVisible(power > 0)
      .setPosition(this.rx, floor + 5)
      .setScale(2.3, 0.25)
      .setAlpha(0.95 * power * near)
      .setTint(hot ? COL.pink : 0xa6dcff)
    // what the light catches in the air around her legs
    haze
      .setVisible(power > 0)
      .setPosition(this.rx, floor - this.h * 0.3)
      .setScale(1.5, 2.1)
      .setAlpha(0.2 * power * near)
      .setTint(hot ? 0x9a5cff : COL.main)
    Stage3D.I.setFootLight(this.rx, floor, (hot ? 3.4 : 2.6) * power, hot ? 0xb884ff : 0x66b4ff)
  }
  /** Her outline always carries a light of its own; states brighten and recolour it. */
  protected applyTint() {
    if (!this.cine && (this.blinking || this.state === 'lunge')) {
      // the dodging body is all light
      this.rig.setTintMul(this.overloaded ? 0xff9be8 : 0x8fdcff, 0.7)
      this.rig.setRim(0xffffff, 2.4)
    } else if (this.overloaded) {
      this.rig.setTintMul(0xe6d4ff, 0.06)
      this.rig.setRim(0xff86e0, 1.1)
    } else if (this.extremeT > 0) {
      this.rig.setTintMul(0xd8ecff, 0.08)
      this.rig.setRim(0x9fe2ff, 1.3)
    } else {
      this.rig.setFlash(null)
      this.rig.setRim(0x58aaff, 0.85)
    }
  }

  destroy() {
    for (const im of [...this.footLight, ...this.wheel]) im.destroy()
    super.destroy()
  }
}
