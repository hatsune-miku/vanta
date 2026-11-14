import type { HitDef } from './actor'
import type { CineHost } from './cine'
import type { Enemy } from './enemies'
import type { Fx } from './fx'
import { ImpactSlowdown } from './impact'

import { A } from '../art/anims'
import { COL, GROUND_Y } from '../config'
import { clamp, lerp, smooth } from '../core/util'

/** A single passing countercut for every enemy size; no execution timeline or finishing blow. */
export class CounterCine {
  t = 0
  done = false
  rate = 1
  private dir: number
  private startX: number
  private endX: number
  private fromX: number
  private fromY: number
  private strikeY: number
  private struck = false
  private impact = new ImpactSlowdown()
  private passFrom = 0
  private lastGhost = -Infinity
  private endAt = Infinity
  private targetClock = 0
  private trail: ReturnType<Fx['dashTrail']> | null = null

  constructor(
    private w: CineHost,
    private target: Enemy,
    public readonly counterHit: HitDef
  ) {
    const p = w.player,
      margin = p.w / 2,
      reach = target.w / 2 + margin + 80
    this.dir = Math.sign(target.x - p.x) || p.facing
    this.fromX = p.x
    this.fromY = p.y
    this.startX = clamp(target.x - this.dir * reach, w.bounds.l + margin, w.bounds.r - margin)
    this.endX = clamp(target.x + this.dir * (reach + 40), w.bounds.l + margin, w.bounds.r - margin)
    this.strikeY = Math.min(GROUND_Y, target.cy + p.h * 0.55)
    p.cine = true
    p.hidden = false
    p.flying = true
    p.vx = p.vy = 0
    p.move = null
    p.invuln = 999
    p.facing = this.dir
    p.an.play(A.exDraw, 2, true)
    w.fx.ghost(p.rig, COL.cyan, 0.65, 0.24)
    p.blinkTrail(p.x, p.y, this.startX, this.strikeY)
  }

  update() {
    const w = this.w,
      p = w.player,
      target = this.target,
      before = this.t
    const pending = this.impact.at < 0
    this.rate = this.impact.rateAt(this.t)
    if (pending && this.impact.at >= 0) {
      this.passFrom = p.x
      this.endAt = this.impact.at + this.impact.duration + 3
    }
    this.t = Math.min(this.endAt, this.t + this.rate)
    if (this.t < 4) {
      const approach = smooth(this.t / 4)
      p.x = p.px = lerp(this.fromX, this.startX, approach)
      p.y = p.py = lerp(this.fromY, this.strikeY, approach)
    } else {
      if (before < 4) {
        p.an.play(A.passCut, 2, true)
        this.trail = w.fx.dashTrail(this.startX, target.cy, this.startX, target.cy)
      }
      const afterPeak = this.impact.at >= 0 && this.t >= this.impact.at,
        pass = smooth(clamp((this.t - this.impact.at) / this.impact.duration, 0, 1))
      p.x = p.px = afterPeak
        ? lerp(this.passFrom, this.endX, pass)
        : this.t < 8
          ? lerp(this.startX, target.x, smooth((this.t - 4) / 4))
          : target.x + this.dir * lerp(0, 35, smooth(clamp((this.t - 8) / 3, 0, 1)))
      p.y = p.py = this.strikeY - (afterPeak ? 1 - pass : smooth(clamp((this.t - 4) / 4, 0, 1))) * 24
      this.trail?.extend(p.x, p.cy)
      if (this.t - this.lastGhost >= 2 && this.t < this.endAt - 3) {
        this.lastGhost = this.t
        p.rig.setPos(p.x, p.y, this.dir)
        w.fx.ghost(p.rig, COL.cyan, 0.42, 0.24)
      }
    }
    p.onGround = false
    p.applyPose(p.an.update(this.rate))
    if (!this.struck && this.t >= 8) {
      this.struck = true
      w.fx.slash(target.x, target.cy, 'slash_thin', -0.3, 1.15, this.dir, COL.cyan, { life: 0.2 })
      w.fx.cut(target.x, target.cy, -0.3 * this.dir, 560, COL.main, 0.22, 0.9)
      w.fx.glint(target.x, target.cy, COL.cyan, 0.5, 0.16)
      this.impact.arm(w.fx.coreBurst(target.x, target.cy, 0.55))
      w.onCountered(target, this.counterHit, this.dir)
    }
    this.targetClock += this.rate
    while (this.targetClock >= 1) {
      this.targetClock--
      if ((target.dead || target.state === 'reviving') && !target.gone) target.update()
    }
    w.cam.x = lerp(w.cam.x, (p.x + target.x) / 2, 0.2)
    w.cam.y = lerp(w.cam.y, target.cy - 60, 0.12)
    w.cam.zoom = lerp(w.cam.zoom, 1.08, 0.12)
    w.cam.rot = 0
    w.cineAmt = this.t < this.endAt - 3 ? Math.min(0.12, w.cineAmt + 0.025) : Math.max(0, w.cineAmt - 0.05)
    if (this.t >= this.endAt) {
      this.done = true
      p.cine = false
      p.hidden = false
      p.flying = false
      p.invuln = 40
      p.state = 'free'
      p.st = 0
      p.onGround = p.groundBelow() - p.y < 2
      p.vx = this.dir * 200
      p.vy = p.onGround ? 0 : -80
      p.an.play(p.onGround ? A.idle : A.fall, 4)
      w.cineAmt = 0
    }
  }
}
