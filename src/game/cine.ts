import type { HitDef } from './actor'
import type { Enemy } from './enemies'
import type { Fx } from './fx'
import { ImpactSlowdown } from './impact'
import type { Player } from './player'

import { A, Anim } from '../art/anims'
import type { Sfx } from '../audio/sfx'
import { COL, GROUND_Y } from '../config'
import { clamp, lerp, rand, smooth } from '../core/util'

export interface CamShot {
  x: number
  y: number
  zoom: number
  rot: number
}
export interface CineHost {
  fx: Fx
  sfx: Sfx
  player: Player
  bounds: { l: number; r: number }
  cam: CamShot // written by the cinematic every frame
  cineAmt: number // 0..1, drives letterbox + backdrop dim
  shake(amp: number, zoomPunch?: number): void
  slowmo(scale: number, realFrames: number): void
  /** Full-screen radial motion blur centred on a world point; 0 switches it off. */
  blur(strength: number, x: number, y: number): void
  onExecuted(target: Enemy): void
  onCountered(target: Enemy, hit: HitDef, dir: number): void
}

type Style = 'core' | 'sunder' | 'storm'
/** A small target's execution after its slow motion: the rate it plays out at, and how many frames that lasts. */
const CORE_TAIL_RATE = 0.5,
  CORE_TAIL = 10
/** How far each pixel smears toward the target: a light pass while the strike travels, a heavy one in the slow motion. */
const BLUR_LIGHT = 0.06
export const BLUR_HEAVY = 0.21
/** the ripple that spreads from an execution's strike, and from anything given the same treatment */
export const STRIKE_RIPPLE = { reach: 2200, life: 0.9 }
/** How large the execution's bloom is on this body: bigger frames are shot wider, so theirs is scaled up. */
export function execBloomPower(target: Enemy) {
  return (STYLE[target.kind] ?? 'core') === 'core' ? 1.3 : target.h > 250 ? 1.9 : 1.55
}
const STYLE: Record<string, Style> = {
  grunt: 'core',
  gunner: 'core',
  heavy: 'sunder',
  titan: 'storm',
  warden: 'storm',
  arbiter: 'storm',
  drone: 'core',
}

/**
 * Execution set piece; the rest of the world is frozen while it plays.
 *
 *   (approach blink, only when far away) -> lock-on -> opening beat + single ripple -> wide hold -> detonation
 *
 * The opening differs per enemy type:
 *   core   (small targets) launch, leap, then cut once as the core bursts into sharp rays
 *   sunder (heavy)          a leap above the target and a single vertical cleave into the floor
 *   storm  (titan, warden)  a flurry from both sides, finished by the vertical cleave
 *
 * The camera never cuts and never tilts: every shot is a fast glide to a new position and zoom. Every style ends
 * in the same bloom: the strike and the bloom's opening play at their own speed, and the deep slow motion begins
 * only once the bloom reports its visual peak.
 *
 * Motion blur comes in two passes. A light one rides each fast beat of the strike, before any slow motion; the
 * heavy one starts with the slow motion at the bloom's peak and clears as the slow motion runs out.
 */
export class ExecCine {
  t = 0
  done = false
  /** playback speed; also applied to effects by the host */
  rate = 1
  private clock = 0
  private dir: number
  private tx: number
  private ty: number
  private gy: number
  private ty0: number
  private flash = 0
  private goal: CamShot
  private ev: (() => void)[][] = []
  private lines: [number, number][] = []
  private boom = 0
  private end = 0
  private holdAt = 0
  // approach blink
  private pre = 0
  private fx0 = 0
  private fy0 = 0
  private style: Style
  private rippleStarted = false
  private liftAt = -1
  private leapAt = -1
  private airStrike = -1
  private lift = 240
  private impact = new ImpactSlowdown()
  private passFrom = 0
  /** 1 on a fast beat, decaying each cinematic frame: drives the light blur pass */
  private kick = 0
  /** Started under overload: every light in the set piece is doubled in saturated blue and pink. */
  private hot: boolean

  constructor(
    private w: CineHost,
    private target: Enemy,
    public quick: boolean
  ) {
    const p = w.player
    this.dir = Math.sign(target.x - p.x) || p.facing
    this.tx = target.x
    this.ty = target.coreY
    this.ty0 = target.y
    this.gy = target.flying ? Math.min(GROUND_Y, target.y + 40) : target.y
    this.style = STYLE[target.kind] ?? 'core'
    this.goal = { ...w.cam }
    this.hot = p.overloaded
    p.cine = true
    p.vx = p.vy = 0
    p.flying = false
    p.invuln = 999
    p.move = null
    this.fx0 = p.x
    this.fy0 = p.y
    const far = Math.abs(target.x - p.x) > 330 || Math.abs(this.gy - p.y) > 150
    this.pre = far ? (quick ? 6 : 9) : 0
    w.sfx.play('exStart')
    w.fx.ring(this.tx, this.ty, COL.main, 420, 50, 0.22)
    if (this.hot) w.fx.ring(this.tx, this.ty, COL.pinkDeep, 520, 70, 0.26)
    if (far) {
      // same language as the dodge: the body is gone, hairlines mark where it went
      const b = w.bounds,
        ex = clamp(this.tx - this.dir * 130 * (target.h > 250 ? 1.5 : 1), b.l + 40, b.r - 40)
      p.blinkTrail(p.x, p.y, ex, this.gy)
      p.hidden = true
      w.sfx.play('dash')
    }
    this.build(this.pre)
  }

  /* ----------------------------- helpers ----------------------------- */

  private at(t: number, fn: () => void) {
    ;(this.ev[t] ??= []).push(fn)
  }
  /** Aim the camera; it stays upright in every shot, only position and zoom move. */
  private cam(x: number, y: number, zoom: number) {
    const g = this.goal
    g.x = x
    g.y = y
    g.zoom = zoom
    g.rot = 0
  }
  private place(offset: number, facing: number, lift = 0, anim?: Anim) {
    const p = this.w.player,
      b = this.w.bounds
    this.w.fx.ghost(p.rig, COL.main, 0.9, 0.38)
    p.x = p.px = clamp(this.tx + this.dir * offset, b.l + 40, b.r - 40)
    p.y = p.py = this.gy - lift
    p.facing = facing
    p.hidden = false
    if (anim) p.an.play(anim, 1, true)
  }
  private startRipple() {
    if (!this.rippleStarted) {
      this.rippleStarted = true
      this.w.fx.ripple(this.tx, this.ty, 2600, 0.72, 1.1)
    }
  }
  private cut(ang: number, len: number, thick: number, shake = 10) {
    const fx = this.w.fx
    this.startRipple()
    if (this.hot) {
      // the overload edge: each cut is a blue and a pink line a hair apart
      const first = this.lines.length % 2 ? COL.pinkDeep : COL.main
      fx.cut(this.tx, this.ty, ang, len, first, 0.3, thick)
      fx.cut(this.tx, this.ty, ang + 0.045, len * 0.92, first === COL.main ? COL.pinkDeep : COL.main, 0.3, thick * 0.7)
    } else fx.cut(this.tx, this.ty, ang, len, COL.main, 0.3, thick)
    fx.weld(this.tx, this.ty, ang, 30, 1.3, this.gy, 0.3)
    fx.weld(this.tx, this.ty, ang + Math.PI, 30, 1.3, this.gy, 0.3)
    fx.seam(this.tx, this.ty, ang, 240, 1.2)
    fx.glint(this.tx, this.ty, 0xffffff, 0.5, 0.16)
    fx.screenFlash(0xffffff, 0.12, 0.06)
    this.lines.push([ang, len])
    this.flash = 4
    this.kick = 1
    this.target.x = this.tx + (rand() < 0.5 ? -9 : 9)
    this.w.shake(shake, 0.018)
    this.w.sfx.play('exCut')
  }
  private glint() {
    const p = this.w.player,
      fx = this.w.fx
    fx.glint(p.rig.wx(p.rig.hand.x), p.rig.wy(p.rig.hand.y), COL.main, 0.55, 0.3)
    this.w.sfx.play('exGlint')
  }

  /* ----------------------------- timeline ----------------------------- */

  private build(t0: number) {
    const d = this.dir,
      fx = this.w.fx,
      q = this.quick,
      big = this.target.h > 250,
      core = this.style === 'core'
    const R = big ? 1.5 : 1 // stand further from big bodies
    const Z = big ? 0.72 : 1 // and frame them wider
    // lock-on
    this.at(t0, () => {
      this.place(-130 * R, d, 0, A.exDraw)
      fx.ring(this.tx, this.ty, 0xffffff, 260, 30, 0.18)
      fx.screenFlash(COL.main, 0.08, 0.15)
      this.cam(lerp(this.w.player.x, this.tx, 0.5), this.ty - 20, (q ? 1.7 : 1.5) * Z)
    })
    if (!q && !core) this.at(t0 + 4, () => this.glint())
    let t = t0 + (q ? 5 : 10)

    const cleave = (at: number) => {
      // from above, straight down through the target
      this.at(at, () => {
        this.place(-20, d, 250 * R, A.leapUp)
        this.cam(this.tx, this.ty - 130 * R, 1.9 * Z)
      })
      this.at(at + 3, () => this.glint())
      this.at(at + 8, () => {
        this.place(50 * R, d, 0, A.exSlam)
        this.cam(this.tx + d * 20, this.ty + 10, 2.3 * Z)
        this.kick = 1
      })
      this.at(at + 10, () => {
        this.cut(Math.PI / 2, 1500, 1.6, 16)
        fx.pillar(this.tx, this.gy, COL.main, 900, 0.3, 0.3)
        fx.ring(this.tx, this.gy, COL.main, 40, 360, 0.36, 0.26)
        fx.weld(this.tx, this.gy, -Math.PI / 2, 40, 1.4, this.gy, 1.2)
        fx.dust(this.tx, this.gy, 1, 8)
        fx.dust(this.tx, this.gy, -1, 8)
        this.w.sfx.play('slam')
      })
      return at + 18
    }

    if (core) {
      this.liftAt = t
      this.leapAt = t + 4
      this.airStrike = this.boom = t + 12
      this.holdAt = this.boom
      this.end = Infinity // The effect's peak determines the slowdown and recovery window.
      this.at(t, () => {
        this.place(-100, d, 0, A.launcher)
        this.target.an.play(A.launched, 2, true)
        fx.slash(this.tx - d * 30, this.ty, 'slash', -0.65, 1.05, d, COL.main, { life: 0.22 })
        if (this.hot) fx.slash(this.tx - d * 30, this.ty, 'slash', -0.5, 1.12, d, COL.pink, { life: 0.22 })
        this.w.sfx.play('swingHeavy')
        this.kick = 1
      })
      this.at(t + 3, () => this.startRipple())
      this.at(this.leapAt, () => {
        this.w.player.an.play(A.leapUp, 2, true)
        fx.dust(this.w.player.x, this.gy, d, 5)
        this.w.sfx.play('jump')
        this.cam(this.tx - d * 30, this.ty - 150, 1.65)
      })
      this.at(this.boom, () => {
        this.ty = this.target.cy
        this.w.player.an.play(A.passCut, 1, true)
        fx.slash(this.tx, this.ty, 'slash_wide', -0.45, 1.35, d, COL.main, { life: 0.3 })
        if (this.hot) fx.slash(this.tx, this.ty, 'slash_wide', -0.3, 1.45, d, COL.pink, { life: 0.3 })
        this.cut(-0.45 * d, 1000, 1.3, 12)
        this.detonate()
      })
      this.at(this.boom + 4, () => this.cam((this.tx + this.w.player.x) / 2, this.ty, 1.4))
      return
    } else if (this.style === 'sunder') {
      t = cleave(t)
    } else {
      // Storm: alternate sides with restrained camera impulses.
      const n = q ? 3 : 6
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? -1 : 1,
          a = [-0.5, 0.65, -1.2, 0.2, 1.25, -0.15][i] * d
        this.at(t + i * 3, () => {
          this.place(170 * R * side, d * side, i % 3 === 1 ? 90 : 0, i % 2 ? A.exCutB : A.exCutA)
          this.cam(this.tx + side * 26, this.ty - 10 + (i % 3) * 14, (2.0 + i * 0.05) * Z)
        })
        this.at(t + i * 3 + 1, () => this.cut(a + (side < 0 ? Math.PI : 0), 1200, 1.1, 8))
      }
      t += n * 3 + 2
      if (!q) t = cleave(t)
    }

    // Heavy targets keep the finishing cut and its recovery.
    this.holdAt = t
    this.at(t, () => {
      const p = this.w.player,
        from = p.x
      this.place(220 * R, d, 0, A.exEnd)
      this.cam(lerp(this.tx, p.x, 0.5), this.ty - 30, (q ? 1.6 : 1.42) * Z)
      fx.cut((from + p.x) / 2, this.ty + 6, 0, Math.abs(p.x - from) + 500, COL.main, 0.4, 1.1)
      fx.screenFlash(0xffffff, 0.1, 0.06)
      this.w.sfx.play('exCut')
      this.flash = 3
      this.kick = 1
      this.w.shake(8, 0.015)
      const hold = 0.5
      for (const [a, l] of this.lines) fx.cut(this.tx, this.ty, a, l * 0.45, COL.pink, hold, 0.5)
    })
    this.at(t + 4, () => this.glint())
    this.boom = t + (q ? 7 : 10)
    this.end = this.boom + 16
    this.at(this.boom, () => this.detonate())
    this.at(this.boom + 10, () => this.w.player.an.play(A.exRecover, 4, true))
  }

  private detonate() {
    const fx = this.w.fx,
      tg = this.target,
      boss = tg.isBoss,
      big = tg.h > 250,
      core = this.style === 'core'
    if (!core) {
      for (const [a, l] of this.lines) {
        fx.cut(this.tx, this.ty, a, l * 1.4, COL.main, 0.4, 0.7)
        fx.weld(this.tx, this.ty, a, 22, 1.5, this.gy, 0.35)
        fx.weld(this.tx, this.ty, a + Math.PI, 22, 1.5, this.gy, 0.35)
      }
      fx.pillar(this.tx, this.gy, COL.main, 1100, 0.45, 0.2)
      fx.pillar(this.tx - 60, this.gy, COL.pinkDeep, 800, 0.32, 0.08)
      fx.pillar(this.tx + 60, this.gy, COL.pinkDeep, 800, 0.32, 0.08)
      fx.shards(this.tx, this.ty, big ? 44 : 24, COL.main, 1.5)
      fx.weld(this.tx, this.ty, -Math.PI / 2, big ? 110 : 70, 1.6, this.gy, 3.2)
    }
    // Bigger frames are shot wider, so their bloom is scaled up to fill the same share of the screen.
    this.impact.arm(fx.bloomBurst(this.tx, this.ty, execBloomPower(tg), this.hot))
    this.kick = 1
    // The wave that clears bullets has been travelling since the opening beat; this one is the strike's own,
    // spreading through the picture as the bloom fades. It is only seen: it sweeps nothing.
    fx.ripple(this.tx, this.ty, STRIKE_RIPPLE.reach, STRIKE_RIPPLE.life, 1, 0, false)
    this.w.shake(boss || big ? 26 : 20, 0.035)
    this.w.sfx.play('exBoom')
    tg.x = this.tx
    if (!core) tg.y = this.ty0
    tg.flashT = 0
    tg.executed(this.dir)
    this.w.onExecuted(tg)
  }

  /* ----------------------------- per logic frame ----------------------------- */

  update() {
    const w = this.w,
      c = w.cam,
      g = this.goal,
      d = this.dir
    // camera whips to its goal in about four frames, then keeps drifting in
    const k = 0.3
    c.x = lerp(c.x, g.x, k)
    c.y = lerp(c.y, g.y, k)
    c.zoom = lerp(c.zoom, g.zoom, k)
    c.rot = lerp(c.rot, g.rot, k)
    g.zoom *= 1 + 0.0035 * this.rate
    g.x += d * 0.5 * this.rate
    const phase = this.t - 1 + this.clock
    if (this.style === 'core') {
      const pending = this.impact.at < 0
      this.rate = this.impact.rateAt(phase)
      // A small target's set piece does not snap back to full speed after the slowed crossing: the bloom and
      // the hero's follow-through play out at half speed, so the burst is seen fading instead of vanishing.
      if (this.impact.at >= 0 && phase >= this.impact.at + this.impact.duration) this.rate = CORE_TAIL_RATE
      if (pending && this.impact.at >= 0) {
        this.passFrom = w.player.x
        this.end = Math.ceil(this.impact.at + this.impact.duration) + 3 + CORE_TAIL
      }
    } else {
      const pace =
        this.t > this.boom
          ? lerp(0.6, 1, clamp((this.t - this.boom) / 10, 0, 1))
          : this.t >= this.holdAt && this.holdAt > 0
            ? 0.5
            : this.t < this.pre
              ? 1
              : 0.7
      this.rate = Math.min(pace, this.impact.rateAt(phase))
    }
    const slowed = this.impact.at >= 0 ? clamp((phase - this.impact.at) / this.impact.duration, 0, 1) : 1
    // The blur stays locked on the body until it is struck, then on the point of impact.
    const struck = this.t > this.boom,
      tg = this.target
    w.blur(
      Math.max(BLUR_LIGHT * this.kick, this.impact.at >= 0 ? BLUR_HEAVY * (1 - slowed * slowed) : 0),
      struck ? this.tx : tg.coreX,
      struck ? this.ty : tg.coreY
    )
    w.cineAmt =
      this.t >= this.boom + 2 ? Math.max(0, w.cineAmt - 0.14) : Math.min(1, w.cineAmt + (this.quick ? 0.25 : 0.14))
    this.clock += this.rate
    while (this.clock >= 1 && !this.done) {
      this.clock -= 1
      this.frame()
    }
    if (!this.done && this.style === 'core') {
      this.poseCore(this.t - 1 + this.clock)
      w.player.applyPose(w.player.an.update(this.rate))
    }
  }

  /** Fractional poses keep the deeply slowed crossing smooth between timeline events. */
  private poseCore(t: number) {
    const p = this.w.player,
      tg = this.target
    if (t >= this.liftAt && t <= this.airStrike) {
      const rise = smooth(clamp((t - this.liftAt) / 6, 0, 1))
      tg.y = tg.py = this.ty0 - this.lift * rise
      tg.onGround = false
    }
    if (t >= this.leapAt && t < this.airStrike - 2) {
      const jump = smooth(clamp((t - this.leapAt) / (this.airStrike - 2 - this.leapAt), 0, 1))
      p.x = p.px = this.tx - this.dir * lerp(100, 80, jump)
      p.y = p.py = this.gy - (this.lift - 20) * jump
      p.onGround = false
    } else if (t >= this.airStrike - 2) {
      const offset =
        t < this.airStrike
          ? lerp(-80, 0, smooth(clamp((t - this.airStrike + 2) / 2, 0, 1)))
          : lerp(0, 45, smooth(clamp((t - this.airStrike) / 3, 0, 1)))
      // through the target during the slowed crossing, then drifting on while the bloom fades
      const x =
        this.impact.at >= 0 && t >= this.impact.at
          ? lerp(
              this.passFrom,
              this.tx + this.dir * 210,
              smooth(clamp((t - this.impact.at) / this.impact.duration, 0, 1))
            ) +
            this.dir * Math.max(0, t - this.impact.at - this.impact.duration) * 4
          : this.tx + this.dir * offset
      p.x = p.px = clamp(x, this.w.bounds.l + p.w / 2, this.w.bounds.r - p.w / 2)
      p.y = p.py = this.gy - this.lift + 20
      p.onGround = false
    }
  }

  private frame() {
    const w = this.w,
      p = w.player,
      tg = this.target,
      t = this.t
    if (this.flash > 0) {
      this.flash--
      tg.flashT = this.flash > 0 ? 2 : 0
      if (!this.flash) tg.x = this.tx
    }
    if (t < this.pre) {
      // approach: the camera travels; the body only reappears at the target
      const e = smooth((t + 1) / this.pre),
        b = w.bounds
      const ex = clamp(this.tx - this.dir * 130 * (tg.h > 250 ? 1.5 : 1), b.l + 40, b.r - 40)
      const nx = lerp(this.fx0, ex, e),
        ny = lerp(this.fy0, this.gy, e)
      p.x = p.px = nx
      p.y = p.py = ny
      p.facing = this.dir
      if (t % 3 === 1) {
        p.rig.setPos(nx, ny, this.dir)
        w.fx.ghost(p.rig, t % 2 ? COL.main : COL.pinkDeep, 0.3, 0.24)
      }
      this.cam(lerp(nx, this.tx, 0.6), lerp(ny, this.ty, 0.5) - 20, 1.25)
    }
    this.kick *= 0.86
    if (this.liftAt >= 0) {
      this.poseCore(t)
      if (t >= this.leapAt && t <= this.airStrike) this.kick = 1
      if (t >= this.liftAt && t <= this.airStrike) {
        tg.applyPose(tg.an.update(1))
      }
      if (t >= this.airStrike - 2 && t < this.end - 3 - CORE_TAIL) {
        if (t % 2 === 0) {
          p.rig.setPos(p.x, p.y, this.dir)
          w.fx.ghost(p.rig, this.hot && t % 4 === 0 ? COL.pink : COL.cyan, 0.55, 0.2)
        }
      }
    }
    for (const fn of this.ev[t] ?? []) fn()
    if ((tg.dead || tg.state === 'reviving') && !tg.gone) tg.update()
    if (this.style !== 'core') p.applyPose(p.an.update(1))
    this.t++
    if (this.t >= this.end) {
      p.cine = false
      p.hidden = false
      p.invuln = 55
      p.state = 'free'
      p.st = 0
      p.flying = false
      p.onGround = p.groundBelow() - p.y < 2
      p.vx = this.liftAt >= 0 ? this.dir * 260 : 0
      p.vy = this.liftAt >= 0 ? -90 : 0
      p.an.play(p.onGround ? A.idle : A.fall, 5)
      w.cineAmt = 0
      w.blur(0, 0, 0)
      this.done = true
      if (this.style !== 'core') w.slowmo(0.75, 8)
    }
  }
}
