import * as Phaser from 'phaser'

import type { Enemy } from './enemies'
import type { Fx } from './fx'
import type { Player } from './player'

import { Animator, type PoseRef } from '../art/anims'
import type { Sfx } from '../audio/sfx'
import { DEPTH, GRAVITY, GROUND_Y, STEP } from '../config'
import type { Input } from '../core/input'
import { Box, lerp } from '../core/util'
import { SpritePuppet } from '../three/sprite'
import { Body3D, Puppet } from '../three/stage3d'

export interface HitDef {
  dmg: number
  kx: number
  ky: number // knockback (px/s); ky < 0 launches
  stun: number // hitstun frames
  stop: number // hitstop frames
  shake: number
  /** A projectile can retain the damage bonus it had when released. */
  multiplier?: number
  knock?: boolean // knockdown on landing
  heavy?: boolean
  spike?: boolean // drives airborne targets down
}

export interface Plat {
  x: number
  y: number
  w: number
}

export interface Proj {
  kind: 'bolt' | 'surge' | 'shock' | 'rain'
  x: number
  y: number
  vx: number
  vy: number
  life: number
  dmg: number
  team: number
  w: number
  h: number
  im: Phaser.GameObjects.Image
  owner: Actor | null
  hitSet: Set<Actor>
  delay: number
  dead: boolean
  hit?: HitDef
  /** Horizontal screen coordinate for the slow, camera-aligned overload blade. */
  screenX?: number
}

/** An attack about to land on the player: the chance for an extreme dodge. */
export interface Threat {
  src: Actor | null
  negate(): void
}
export interface Anchor {
  x: number
  y: number
  target?: Enemy
}

/** What actors need from the battle scene. */
export interface World {
  stage: Phaser.Scene
  fx: Fx
  sfx: Sfx
  ctl: Input
  player: Player
  enemies: Enemy[]
  projs: Proj[]
  plats: Plat[]
  bounds: { l: number; r: number }
  frame: number
  hitstop(n: number): void
  shake(amp: number, zoomPunch?: number): void
  slowmo(scale: number, realFrames: number): void
  /** Resolve an attack box against the opposing team. Returns number of targets hit. */
  attack(src: Actor, box: Box, hit: HitDef, hitSet: Set<Actor>): number
  spawnProj(p: Partial<Proj> & { kind: Proj['kind']; x: number; y: number; team: number }): Proj
  spawnSurge(hit: HitDef): Proj
  takeToken(a: Actor, ranged: boolean): boolean
  releaseToken(a: Actor): void
  onEnemyDead(a: Actor, executed: boolean): void
  combo(n: number): void
  /** Start an execution on a dying enemy that is on screen; false if there is none. */
  tryExecute(): boolean
  /** A universal passing slash that counters with ordinary damage. */
  tryCounter(source: Actor, hit: HitDef): boolean
  readonly executionTarget: Enemy | null
  /** current dodge window, recomputed every logic frame */
  threat: Threat | null
  /** the anchor a dodge would currently jump to, if any */
  anchor: Anchor | null
}

let NEXT_ID = 1

export abstract class Actor {
  id = NEXT_ID++
  x = 0
  y = 0
  px = 0
  py = 0
  vx = 0
  vy = 0
  facing = 1
  onGround = false
  hp = 1
  maxHp = 1
  w = 60
  h = 170
  team = 0
  rig!: Puppet
  /** where the body was last drawn (interpolated) */
  rx = 0
  ry = 0
  an = new Animator()
  state = 'idle'
  st = 0
  invuln = 0
  flashT = 0
  dead = false
  gone = false
  gravity = 1
  flying = false
  dropT = 0
  isBoss = false
  shadow!: Phaser.GameObjects.Image

  constructor(public world: World) {}

  /** Create the visible body. For 3D bodies the hurtbox is derived from the model's size. */
  protected initBody(skin: string, depth: number) {
    if (skin === 'drone') this.rig = new SpritePuppet(this.world.stage, 'drone_body', 0.58, depth)
    else {
      const b = (this.rig = new Body3D(skin, depth))
      this.h = Math.round(b.heightPx * 0.93)
      this.w = Math.round(b.widthPx)
    }
    this.shadow = this.world.stage.add.image(0, 0, 'shadow').setDepth(DEPTH.floor + 5)
  }

  get box(): Box {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h }
  }
  get cx() {
    return this.x
  }
  get cy() {
    return this.y - this.h * 0.55
  }

  set(state: string) {
    this.state = state
    this.st = 0
  }

  /** Box in front of the actor: fx = forward offset of the near edge, top = offset above feet. */
  fbox(fx: number, top: number, w: number, h: number): Box {
    return { x: this.facing > 0 ? this.x + fx : this.x - fx - w, y: this.y + top, w, h }
  }

  physics() {
    this.px = this.x
    this.py = this.y
    if (!this.flying) this.vy += GRAVITY * this.gravity * STEP
    this.x += this.vx * STEP
    const b = this.world.bounds,
      m = this.w * 0.5
    if (this.x < b.l + m) {
      this.x = b.l + m
      if (this.vx < 0) this.vx = 0
    }
    if (this.x > b.r - m) {
      this.x = b.r - m
      if (this.vx > 0) this.vx = 0
    }
    const y0 = this.y
    this.y += this.vy * STEP
    const was = this.onGround
    this.onGround = false
    if (this.flying) return
    if (this.y >= GROUND_Y) {
      this.y = GROUND_Y
      this.land(was)
      return
    }
    if (this.dropT > 0) {
      this.dropT--
      return
    }
    if (this.vy >= 0) {
      for (const p of this.world.plats) {
        if (this.x > p.x - 6 && this.x < p.x + p.w + 6 && y0 <= p.y + 1 && this.y >= p.y) {
          this.y = p.y
          this.land(was)
          return
        }
      }
    }
  }
  private land(was: boolean) {
    const v = this.vy
    this.vy = 0
    this.onGround = true
    if (!was) this.onLand(v)
  }
  protected onLand(_v: number) {}

  abstract update(): void
  /** Returns true if the hit connected. dir = +1 pushes right. */
  abstract takeHit(hit: HitDef, src: Actor | null, dir: number): boolean

  /** Logic also needs current bone positions when several ticks run between draws. */
  applyPose(pose: PoseRef) {
    this.rig.setPos(this.x, this.y, this.facing)
    this.rig.apply(pose)
  }

  render(alpha: number, _time: number) {
    const x = lerp(this.px, this.x, alpha),
      y = lerp(this.py, this.y, alpha)
    this.rx = x
    this.ry = y
    this.rig.setPos(x, y, this.facing)
    if (this.flashT > 0) this.rig.setFlash(0xffffff)
    else this.applyTint()
    const gy = this.groundBelow()
    // contact shadow: shrinks and fades with height above the surface below
    const k = Math.max(0.25, 1 - (gy - y) / 500),
      s = this.w / 62
    this.shadow
      .setPosition(x, gy + 3)
      .setAlpha(0.8 * k * this.rig.alpha)
      .setScale(s * k, s)
  }
  protected applyTint() {
    this.rig.setFlash(null)
  }

  groundBelow() {
    let gy = GROUND_Y
    for (const p of this.world.plats) if (this.x > p.x && this.x < p.x + p.w && this.y <= p.y + 2 && p.y < gy) gy = p.y
    return gy
  }

  destroy() {
    this.rig.destroy()
    this.shadow.destroy()
    this.gone = true
  }
}
