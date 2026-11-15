import * as Phaser from 'phaser'

import { ORIGIN } from '../art/textures'
import { COL, DEPTH, VIEW_H, VIEW_W } from '../config'
import { rand, randRange } from '../core/util'
import type { Puppet } from '../three/stage3d'

const ADD = Phaser.BlendModes.ADD

export interface FxPeak {
  readonly reached: boolean
}

/** Three effect frames to fully open the impact before the cinematic may slow it down. */
const IMPACT_PEAK_TIME = 3 / 60

interface P {
  im: Phaser.GameObjects.Image
  life: number
  max: number
  vx: number
  vy: number
  g: number
  drag: number
  sx0: number
  sx1: number
  sy0: number
  sy1: number
  a0: number
  rotV: number
  align: boolean
  ease: number
  delay: number
  /** A deliberate rise to full size and brightness, followed by decay. Zero uses the ordinary fade. */
  peakAt: number
  /** incandescent: colour cools from white-hot through amber to dull red over its life */
  heat: boolean
  /** y of a floor to bounce on (0 = none) */
  floor: number
}

const HEAT = [0xffffff, 0xfff0b0, 0xffb040, 0xff6a18, 0xa02808]
function heatColor(t: number) {
  const f = Math.min(0.999, Math.max(0, t)) * (HEAT.length - 1),
    i = Math.floor(f),
    k = f - i,
    a = HEAT[i],
    b = HEAT[i + 1]
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * k)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
interface Txt {
  t: Phaser.GameObjects.Text
  life: number
  max: number
  vy: number
}
interface Rip {
  x: number
  y: number
  t: number
  life: number
  r1: number
  amp: number
  /** whether its front carries enemy bullets away; a ripple that is only there to be seen does not */
  sweeps: boolean
}

const RIP_W = 480,
  RIP_H = 270

/** Pooled sprite effects, afterimages, damage text and the screen ripple. Runs on render time, not logic time. */
export class Fx {
  private pool: Phaser.GameObjects.Image[] = []
  private live: P[] = []
  private texts: Txt[] = []
  private textPool: Phaser.GameObjects.Text[] = []
  private rips: Rip[] = []
  private ripTex!: Phaser.Textures.DynamicTexture
  private ripFilter: any
  private overlay: Phaser.GameObjects.Rectangle
  private overlayLife = 0
  private overlayMax = 1
  private overlayRise = 0
  private overlayA = 0
  private bloomCore: P | null = null

  constructor(private scene: Phaser.Scene) {
    this.overlay = scene.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W + 1000, VIEW_H + 1000, 0xffffff)
      .setScrollFactor(0)
      .setDepth(DEPTH.fore + 20)
      .setAlpha(0)
      .setBlendMode(ADD)
    this.buildRipple()
  }

  /** 0..1: how overexposed the frame is by the execution bloom right now. */
  get glare() {
    const core = this.bloomCore
    return core && core.life < core.max ? core.im.alpha : 0
  }

  /** Whether all finite particles, text and waves have cleared. */
  get settled() {
    return !this.live.length && !this.texts.length && !this.rips.length && this.overlayLife <= 0
  }

  /* ----------------------------- sprites ----------------------------- */

  private spawn(key: string, x: number, y: number, depth = DEPTH.frontFx, blend: number = ADD): P {
    const im = this.pool.pop() ?? this.scene.add.image(0, 0, key)
    im.setTexture(key)
      .setPosition(x, y)
      .setDepth(depth)
      .setBlendMode(blend)
      .setVisible(true)
      .setActive(true)
      .setRotation(0)
      .setScale(1)
      .setAlpha(1)
      .setFlip(false, false)
      .setScrollFactor(1)
      .clearTint()
    const o = ORIGIN[key]
    im.setOrigin(o ? o[0] : 0.5, o ? o[1] : 0.5)
    const p: P = {
      im,
      life: 0,
      max: 0.3,
      vx: 0,
      vy: 0,
      g: 0,
      drag: 0,
      sx0: 1,
      sx1: 1,
      sy0: 1,
      sy1: 1,
      a0: 1,
      rotV: 0,
      align: false,
      ease: 1,
      delay: 0,
      peakAt: 0,
      heat: false,
      floor: 0,
    }
    this.live.push(p)
    return p
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      if (p.delay > 0) {
        p.delay -= dt
        p.im.setVisible(p.delay <= 0)
        continue
      }
      // Render the exact peak once even if a long render frame would otherwise skip past it.
      p.life = p.life < p.peakAt && p.life + dt >= p.peakAt ? p.peakAt : p.life + dt
      const t = p.life / p.max
      if (t >= 1) {
        p.im.setVisible(false).setActive(false)
        this.pool.push(p.im)
        this.live[i] = this.live[this.live.length - 1]
        this.live.pop()
        continue
      }
      p.vy += p.g * dt
      if (p.drag) {
        const d = Math.exp(-p.drag * dt)
        p.vx *= d
        p.vy *= d
      }
      p.im.x += p.vx * dt
      p.im.y += p.vy * dt
      if (p.floor && p.im.y > p.floor && p.vy > 0) {
        p.im.y = p.floor
        p.vy *= -0.38
        p.vx *= 0.6
      }
      if (p.heat) p.im.setTint(heatColor(t))
      if (p.peakAt > 0) {
        const rise = Math.min(1, p.life / p.peakAt),
          open = rise * rise * (3 - 2 * rise),
          fade = 1 - Math.max(0, (p.life - p.peakAt) / (p.max - p.peakAt))
        p.im.setScale(
          (p.sx0 + (p.sx1 - p.sx0) * open) * (0.4 + 0.6 * fade),
          (p.sy0 + (p.sy1 - p.sy0) * open) * (0.12 + 0.88 * fade)
        )
        p.im.setAlpha(p.a0 * open * Math.pow(fade, 1.5))
      } else {
        const e = 1 - Math.pow(1 - t, p.ease)
        p.im.setScale(p.sx0 + (p.sx1 - p.sx0) * e, p.sy0 + (p.sy1 - p.sy0) * e)
        p.im.setAlpha(p.a0 * (1 - t * t))
      }
      if (p.align) p.im.rotation = Math.atan2(p.vy, p.vx)
      else p.im.rotation += p.rotV * dt
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const x = this.texts[i]
      x.life += dt
      const t = x.life / x.max
      if (t >= 1) {
        x.t.setVisible(false)
        this.textPool.push(x.t)
        this.texts.splice(i, 1)
        continue
      }
      x.t.y += x.vy * dt
      x.vy *= Math.exp(-5 * dt)
      x.t.setAlpha(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3).setScale(t < 0.12 ? 1.5 - t * 4 : 1)
    }
    if (this.overlayLife > 0) {
      this.overlayLife -= dt
      const decay = Math.max(0, Math.min(1, this.overlayLife / this.overlayMax)),
        rise = this.overlayRise > 0 ? Math.min(1, 1 - (this.overlayLife - this.overlayMax) / this.overlayRise) : 1
      this.overlay.setAlpha(this.overlayA * rise * rise * (3 - 2 * rise) * decay)
    }
    this.updateRipple(dt)
  }

  /** Crescent / line slash. rot in radians for a right-facing attacker; dir mirrors it. */
  slash(
    x: number,
    y: number,
    key: string,
    rot: number,
    scale: number,
    dir: number,
    color: number,
    o: {
      flipY?: boolean
      sy?: number
      life?: number
      grow?: number
      depth?: number
      delay?: number
      core?: boolean
      intense?: boolean
      shade?: boolean
      opacity?: number
    } = {}
  ) {
    // a sweep drawn squashed (seen edge-on) needs the thin band, or its near and far sides merge into a blob
    if (key === 'slash_wide' && o.sy !== undefined && o.sy < 0.7) key = 'slash_flat'
    const volume = color === COL.main || color === COL.cyan || color === COL.pink || color === COL.pinkDeep
    const bladeKey = volume ? `blade_${key}` : key
    const sy = (o.sy ?? 1) * (o.flipY ? -1 : 1),
      grow = o.grow ?? 1.18
    const layers = o.shade ? 1 : volume ? (o.core === false ? 2 : o.intense ? 4 : 3) : o.core === false ? 1 : 2
    const pink = color === COL.pink || color === COL.pinkDeep
    const tint = o.shade
      ? pink
        ? 0x610744
        : 0x072774
      : pink
        ? 0xff1bb6
        : color === COL.cyan || o.intense
          ? 0x00bfff
          : 0x168bff
    for (let k = 0; k < layers; k++) {
      const highlight = volume ? k === 2 : k === 1
      const p = this.spawn(
        volume && !o.shade
          ? k === 0
            ? `${bladeKey}_glow`
            : k === 2
              ? `${bladeKey}_${o.intense ? 'hot' : 'core'}`
              : k === 3
                ? `${bladeKey}_hot_glow`
                : bladeKey
          : bladeKey,
        x,
        y,
        // Pooled images keep their original display-list order, so shade must always sit below emission.
        (o.depth ?? DEPTH.frontFx) + (o.shade ? 0 : k + 1) * 0.01,
        o.shade ? Phaser.BlendModes.NORMAL : volume && k === 1 && !o.intense ? Phaser.BlendModes.SCREEN : ADD
      )
      p.max = (o.life ?? 0.2) * (highlight && !volume ? 0.8 : 1)
      p.delay = o.delay ?? 0
      const s = scale * (highlight && !volume ? 0.9 : 1)
      p.sx0 = s * dir
      p.sx1 = s * grow * dir
      p.sy0 = s * sy
      p.sy1 = s * grow * sy
      p.ease = 3
      p.im.rotation = rot * dir
      p.im.setTint(
        volume
          ? highlight
            ? pink
              ? 0xffc3ef
              : o.intense
                ? 0xe1ffff
                : 0x8eeaff
            : o.intense && k === 0
              ? pink
                ? 0xff009d
                : 0x0064ff
              : tint
          : k
            ? 0xffffff
            : color
      )
      p.a0 = (o.opacity ?? 1) * (volume ? (k === 0 && !o.intense ? 0.85 : 1) : k ? 0.6 : 1)
      p.im.setScale(p.sx0, p.sy0).setAlpha(p.a0)
      if (p.delay > 0) p.im.setVisible(false)
    }
  }

  /** Coincident shade, saturated light and a hot edge form one blade silhouette. */
  attackSlash(
    x: number,
    y: number,
    key: string,
    rot: number,
    scale: number,
    dir: number,
    color: number,
    options: Parameters<Fx['slash']>[7] = {}
  ) {
    this.slash(x, y, key, rot, scale, dir, color, { ...options, shade: true, opacity: 0.7 })
    for (let i = 0; i < 3; i++)
      this.slash(x, y, key, rot, scale, dir, color, { ...options, intense: true, core: i === 0 })
  }

  /**
   * The path of a dodge: a soft band of light with streaks torn along it, following the segment actually travelled
   * and gone almost as soon as she has arrived. No two dodges draw the same set: each streak has its own place
   * across the path, its own thickness, length, starting point, slight slant and lifetime.
   */
  dashTrail(x0: number, y0: number, x1: number, y1: number) {
    const palette = [0xeafaff, 0x4fd6ff, 0x2f9bff, 0x4fd6ff, 0xbff6ff, 0x2f9bff, 0x168bff],
      streaks = 6 + Math.floor(rand() * 4),
      // the band first, then the one bright streak down the middle, then the ragged rest
      specs = [{ offset: 0, width: 0, reach: 0, short: 0, tilt: 0, color: 0x168bff, alpha: 0.2, life: 0.2 }]
    for (let i = 0; i < streaks; i++) {
      const centre = i === 0
      specs.push({
        offset: centre ? randRange(-8, 8) : randRange(-125, 125) * (0.3 + 0.7 * rand()),
        width: centre ? 6 : randRange(1.6, 4.8),
        // how far back past the start it reaches, and how far short of her it stops
        reach: randRange(0, 0.8),
        short: centre ? 0 : randRange(0, 0.42),
        tilt: centre ? 0 : randRange(-0.045, 0.045),
        color: palette[i % palette.length],
        alpha: centre ? 1 : randRange(0.5, 0.95),
        life: randRange(0.13, 0.26),
      })
    }
    const lines = specs.map((spec) => {
      const p = this.spawn(spec.width ? 'dash_line' : 'dash_trail', x0, y0, DEPTH.tail)
      p.max = spec.life
      p.sy0 = spec.width ? spec.width / 4.5 : 70 / 128
      p.sy1 = p.sy0 * 0.3
      p.a0 = spec.alpha
      p.im.setTint(spec.color)
      return { p, ...spec }
    })
    function extend(x: number, y: number) {
      const distance = Math.hypot(x - x0, y - y0),
        angle = Math.atan2(y - y0, x - x0),
        ux = Math.cos(angle),
        uy = Math.sin(angle)
      for (const { p, offset, reach, short, tilt } of lines) {
        const length = Math.max(8, distance * (1 + reach - short)),
          back = distance * short + length / 2,
          cx = x - ux * back - uy * offset,
          cy = y - uy * back + ux * offset
        p.life = 0
        p.sx0 = p.sx1 = length / 512
        p.im
          .setPosition(cx, cy)
          .setRotation(angle + tilt)
          .setScale(p.sx0, p.sy0)
          .setAlpha(p.a0)
      }
    }
    extend(x1, y1)
    return { extend }
  }

  /** A body dropping out like a lost signal: thin slices of it jump sideways and blink out. */
  glitch(x: number, y: number, w: number, h: number) {
    for (let i = 0; i < 12; i++) {
      const p = this.spawn('px', x + randRange(-0.7, 0.7) * w, y - rand() * h)
      p.max = randRange(0.06, 0.2)
      p.delay = rand() * 0.07
      p.vx = randRange(-900, 900)
      p.drag = 9
      p.sx0 = randRange(0.3, 1.1) * (w / 4)
      p.sx1 = p.sx0 * 1.6
      p.sy0 = randRange(0.5, 2.2)
      p.sy1 = 0.3
      p.im.setTint(i % 3 === 0 ? COL.pink : i % 3 === 1 ? COL.cyan : 0xffffff)
      if (p.delay > 0) p.im.setVisible(false)
    }
  }

  overloadEnter(x: number, y: number) {
    this.screenFlash(0xf4fdff, 0.8, 0.18)
    this.flash(x, y, COL.cyan, 2.4, 0.36)
    this.glint(x, y, 0xffffff, 2, 0.32)
    this.pillar(x, y + 300, COL.cyan, 1600, 0.3, 1.4)
    this.ring(x, y, COL.pink, 40, 900, 0.38, 0.7)
    this.coreBurst(x, y, 1.8)
  }

  guard(x: number, y: number, dir: number) {
    this.ring(x, y, COL.cyan, 90, 140, 0.2)
    this.glint(x - dir * 48, y, 0xe3fbff, 0.8, 0.18)
    this.spark(x - dir * 48, y, dir > 0 ? Math.PI : 0, 18, COL.cyan, 0.8, 1.1, 0.16)
  }

  /** Straight cut line through a point, at any angle. */
  cut(x: number, y: number, ang: number, len: number, color: number, life = 0.22, thick = 1, delay = 0) {
    for (let k = 0; k < 2; k++) {
      const p = this.spawn('cut', x, y)
      p.max = life
      p.delay = delay
      p.im.rotation = ang
      p.im.setTint(k ? 0xffffff : color)
      p.sx0 = (len / 500) * 0.5
      p.sx1 = (len / 500) * 1.25
      p.sy0 = thick * (k ? 0.7 : 1.6)
      p.sy1 = 0.05
      p.ease = 4
      p.a0 = 1
      if (delay > 0) p.im.setVisible(false)
    }
  }

  spark(x: number, y: number, ang: number, n: number, color: number, power = 1, spread = 0.9, thickness = 1) {
    for (let i = 0; i < n; i++) {
      const p = this.spawn('streak', x, y)
      const a = ang + (rand() - 0.5) * spread * 2,
        v = (500 + rand() * 1100) * power
      p.vx = Math.cos(a) * v
      p.vy = Math.sin(a) * v
      p.g = 1400
      p.drag = 3.5
      p.align = true
      p.max = 0.16 + rand() * 0.26
      p.sx0 = (0.5 + rand() * 0.7) * power
      p.sx1 = 0.1
      p.sy0 = 0.9 * thickness
      p.sy1 = 0.3 * thickness
      const r = rand()
      p.im.setTint(r < 0.25 ? 0xffffff : color === COL.main && r < 0.55 ? COL.pinkDeep : color)
    }
  }

  /**
   * Cutting-torch contact: a tight spray of fine incandescent sparks that arc under gravity, bounce off the
   * floor and cool as they fly, around a tiny flickering arc point.
   */
  weld(x: number, y: number, ang: number, n: number, power = 1, floor = 0, spread = 0.55) {
    for (let i = 0; i < n; i++) {
      const fine = rand() < 0.7
      const p = this.spawn(fine ? 'streak' : 'dot', x, y)
      const a = ang + (rand() - 0.5) * 2 * spread * (rand() < 0.2 ? 2.2 : 1),
        v = (350 + rand() * rand() * 1900) * power
      p.vx = Math.cos(a) * v
      p.vy = Math.sin(a) * v - 120
      p.g = 2600
      p.drag = 1.1
      p.align = fine
      p.heat = true
      p.floor = floor
      p.max = 0.25 + rand() * 0.6
      if (fine) {
        p.sx0 = 0.1 + rand() * 0.2
        p.sx1 = 0.04
        p.sy0 = 0.34
        p.sy1 = 0.18
      } else {
        p.sx0 = p.sy0 = 0.1 + rand() * 0.12
        p.sx1 = p.sy1 = 0.04
      }
    }
    // the arc itself: small, blue-white, flickering
    for (let k = 0; k < 3; k++) {
      const c = this.spawn('glow', x + randRange(-4, 4), y + randRange(-4, 4))
      c.delay = k * 0.03
      c.max = 0.05
      c.sx0 = c.sy0 = 0.34 * power
      c.sx1 = c.sy1 = 0.12
      c.im.setTint(k === 1 ? 0xffffff : 0xa8d4ff)
      if (c.delay > 0) c.im.setVisible(false)
    }
  }

  /** A cut that stays glowing on the surface and cools. */
  seam(x: number, y: number, ang: number, len: number, life = 0.55) {
    const p = this.spawn('cut', x, y)
    p.im.rotation = ang
    p.max = life
    p.heat = true
    p.sx0 = p.sx1 = len / 500
    p.sy0 = 0.42
    p.sy1 = 0.16
    p.ease = 1
  }

  flash(x: number, y: number, color: number, scale = 1.6, life = 0.14, depth = DEPTH.frontFx) {
    const p = this.spawn('glow', x, y, depth)
    p.max = life
    p.sx0 = p.sy0 = scale
    p.sx1 = p.sy1 = scale * 1.7
    p.im.setTint(color)
    p.a0 = 1
    const q = this.spawn('glow', x, y, depth)
    q.max = life * 0.7
    q.sx0 = q.sy0 = scale * 0.45
    q.sx1 = q.sy1 = scale * 0.6
  }

  /** Anamorphic lens glint: a hot core with long horizontal and short vertical streaks. */
  glint(x: number, y: number, color: number, scale = 1, life = 0.3) {
    this.flash(x, y, color, 0.9 * scale, life)
    const h = this.spawn('cut', x, y)
    h.max = life
    h.sx0 = 0.3 * scale
    h.sx1 = 1.5 * scale
    h.sy0 = 1.3
    h.sy1 = 0.1
    h.ease = 3
    h.im.setTint(color)
    const h2 = this.spawn('cut', x, y)
    h2.max = life * 0.8
    h2.sx0 = 0.2 * scale
    h2.sx1 = 0.9 * scale
    h2.sy0 = 0.7
    h2.sy1 = 0.05
    h2.ease = 3
    const v = this.spawn('cut', x, y)
    v.max = life * 0.7
    v.im.rotation = Math.PI / 2
    v.sx0 = 0.12 * scale
    v.sx1 = 0.42 * scale
    v.sy0 = 0.9
    v.sy1 = 0.05
    v.ease = 3
    for (const a of [0.6, -0.6]) {
      const d = this.spawn('cut', x, y)
      d.max = life * 0.6
      d.im.rotation = a
      d.sx0 = 0.1 * scale
      d.sx1 = 0.3 * scale
      d.sy0 = 0.5
      d.sy1 = 0.05
      d.im.setTint(color)
    }
  }

  ring(x: number, y: number, color: number, r0: number, r1: number, life = 0.35, squash = 1, depth = DEPTH.frontFx) {
    const p = this.spawn('ring', x, y, depth)
    p.max = life
    p.ease = 2.5
    p.sx0 = r0 / 112
    p.sx1 = r1 / 112
    p.sy0 = (r0 / 112) * squash
    p.sy1 = (r1 / 112) * squash
    p.im.setTint(color)
  }

  dust(x: number, y: number, dir: number, n = 5, color = 0x9fc6d8) {
    for (let i = 0; i < n; i++) {
      const p = this.spawn(
        'smoke',
        x + randRange(-14, 14),
        y - randRange(0, 10),
        DEPTH.backFx,
        Phaser.BlendModes.NORMAL
      )
      p.vx = dir * randRange(60, 320) + randRange(-60, 60)
      p.vy = -randRange(20, 140)
      p.drag = 3
      p.max = randRange(0.3, 0.6)
      p.sx0 = p.sy0 = randRange(0.2, 0.4)
      p.sx1 = p.sy1 = randRange(0.7, 1.2)
      p.a0 = 0.5
      p.im.setTint(color)
    }
  }

  shards(x: number, y: number, n: number, color: number, power = 1) {
    for (let i = 0; i < n; i++) {
      const p = this.spawn(
        'shard',
        x + randRange(-30, 30),
        y + randRange(-60, 60),
        DEPTH.frontFx,
        rand() < 0.5 ? ADD : Phaser.BlendModes.NORMAL
      )
      const a = rand() * Math.PI * 2,
        v = randRange(200, 1100) * power
      p.vx = Math.cos(a) * v
      p.vy = Math.sin(a) * v - 300
      p.g = 1800
      p.drag = 1.6
      p.rotV = randRange(-14, 14)
      p.max = randRange(0.4, 0.95)
      p.sx0 = p.sy0 = randRange(0.22, 0.7)
      p.sx1 = p.sy1 = 0.08
      p.im.setTint(rand() < 0.4 ? 0xffffff : color)
    }
  }

  /** Light pulls inward as the core is compressed in the hero's hand. */
  coreCharge(x: number, y: number, life = 0.25) {
    const core = this.spawn('glow', x, y)
    core.max = life
    core.sx0 = core.sy0 = 0.24
    core.sx1 = core.sy1 = 0.025
    core.im.setTint(COL.cyan)
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2,
        r = randRange(90, 180)
      const p = this.spawn('streak', x + Math.cos(a) * r, y + Math.sin(a) * r)
      p.vx = (-Math.cos(a) * r) / life
      p.vy = (-Math.sin(a) * r) / life
      p.align = true
      p.max = life
      p.sx0 = 0.5
      p.sx1 = 0.05
      p.sy0 = 0.09
      p.sy1 = 0.015
      p.im.setTint(i % 3 ? COL.cyan : COL.pink)
    }
  }

  /** A crushed core bursts into uneven, straight rays and hot fragments. */
  coreBurst(x: number, y: number, power = 1): FxPeak {
    const bloom = this.spawn('glow', x, y)
    bloom.peakAt = IMPACT_PEAK_TIME
    bloom.max = 0.3
    bloom.sx0 = bloom.sy0 = 0.02
    bloom.sx1 = bloom.sy1 = 0.35 * power
    bloom.im.setScale(0.02).setAlpha(0).setTint(COL.cyan)
    this.needles(x, y, power, Math.round(96 * power), [COL.pink, COL.cyan, 0xffffff, COL.cyan, COL.cyan])
    return {
      get reached() {
        return bloom.life >= bloom.peakAt
      },
    }
  }

  /** Random angles and speeds leave uneven gaps: each bright fragment draws its own needle-thin trail. */
  private needles(x: number, y: number, power: number, count: number, palette: number[]) {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2,
        speed = randRange(280, 2000) * power,
        color = palette[i % palette.length],
        p = this.spawn('streak', x + randRange(-3, 3), y + randRange(-3, 3))
      p.vx = Math.cos(a) * speed
      p.vy = Math.sin(a) * speed
      p.drag = randRange(0.4, 1.6)
      p.max = randRange(0.35, 1.05)
      p.peakAt = IMPACT_PEAK_TIME
      p.sx0 = randRange(0.08, 0.3)
      p.sx1 = randRange(0.6, 3) * power
      p.sy0 = 0.008
      p.sy1 = randRange(0.06, 0.17)
      p.ease = 2
      p.align = true
      p.a0 = randRange(0.5, 0.95)
      p.im.setTint(color).setScale(p.sx0, p.sy0).setAlpha(0).setRotation(a)
      if (i % 4 === 0) {
        const head = this.spawn('dot', p.im.x, p.im.y)
        head.vx = p.vx
        head.vy = p.vy
        head.drag = p.drag
        head.max = p.max * 0.8
        head.peakAt = IMPACT_PEAK_TIME
        head.sx0 = head.sy0 = 0.01
        head.sx1 = head.sy1 = randRange(0.07, 0.18)
        head.im.setTint(color).setScale(0.01).setAlpha(0)
      }
    }
  }

  /**
   * The execution bloom. Overexposed blades of light open from the struck core until they reach past the
   * edges of the frame, under a veil that washes out the whole screen; then they thin, shorten and close.
   * Everything shares one envelope, so the returned peak is the moment the bloom is at its largest and brightest.
   * `hot` is the overload version: the same shape, but every ray wears a wide, saturated blue or pink edge.
   */
  /**
   * The execution's bloom. `flash` scales the wash it throws over the whole screen (0 for none), for the lesser
   * blooms that mark a heavy hit rather than a kill.
   */
  bloomBurst(x: number, y: number, power = 1, hot = false, flash = 1): FxPeak {
    const peak = IMPACT_PEAK_TIME,
      BLUE = 0x2f6bff,
      PINK = 0xff38b0
    const glow = (scale: number, color: number, alpha: number, life: number, dx = 0) => {
      const p = this.spawn('glow', x + dx, y)
      p.peakAt = peak
      p.max = life
      p.sx0 = p.sy0 = scale * 0.1
      p.sx1 = p.sy1 = scale * power
      p.a0 = alpha
      p.im.setTint(color).setScale(p.sx0).setAlpha(0)
      return p
    }
    // The core burns out to white: stacked glows saturate a compact disc inside a faint coloured falloff.
    if (hot) {
      glow(4.6, BLUE, 0.6, 0.42, -70 * power)
      glow(4.6, PINK, 0.6, 0.42, 70 * power)
    } else glow(4.8, BLUE, 0.42, 0.4)
    glow(2.2, 0xffffff, 1, 0.38)
    glow(2.2, 0xffffff, 1, 0.34)
    const core = glow(1.2, 0xffffff, 1, 0.34)
    this.bloomCore = core
    const petal = (angle: number, length: number, width: number, color: number, alpha: number, life: number) => {
      const p = this.spawn('petal', x, y)
      p.peakAt = peak
      p.max = life
      p.sx0 = (length / 512) * 0.14
      p.sx1 = length / 512
      p.sy0 = (width / 96) * 0.5
      p.sy1 = width / 96
      p.a0 = alpha
      p.rotV = randRange(-0.3, 0.3)
      p.im.setTint(color).setRotation(angle).setScale(p.sx0, p.sy0).setAlpha(0)
    }
    // Main blades are spread around the circle but never evenly: each has its own length, width and timing.
    const spin = rand() * Math.PI * 2,
      blades = 13
    for (let i = 0; i < blades; i++) {
      const angle = spin + ((i + randRange(-0.36, 0.36)) / blades) * Math.PI * 2,
        length = randRange(300, 660) * power,
        width = randRange(22, 64) * power,
        life = randRange(0.3, 0.44)
      if (hot) {
        petal(angle, length, width * 2.5, i % 2 ? PINK : BLUE, 0.85, life)
        petal(angle, length * 0.94, width * 0.8, 0xffffff, 1, life)
      } else {
        petal(angle, length, width * 1.7, i % 4 === 3 ? 0xff4fc8 : 0x3a6dff, 0.5, life)
        petal(angle, length * 0.96, width, 0xffffff, 1, life)
      }
    }
    // thinner rays fill the gaps between them
    for (let i = 0; i < 20; i++) {
      petal(
        rand() * Math.PI * 2,
        randRange(160, 430) * power,
        randRange(6, 16) * power,
        hot ? [0xff8fe0, 0x7fb4ff, 0xffffff][i % 3] : rand() < 0.45 ? 0xffffff : 0x9fd0ff,
        randRange(0.55, 0.9),
        randRange(0.26, 0.4)
      )
    }
    this.needles(
      x,
      y,
      power,
      Math.round(64 * power),
      hot ? [COL.pinkDeep, COL.main, 0xffffff, COL.pink] : [COL.pink, COL.cyan, 0xffffff, COL.cyan, COL.cyan]
    )
    if (flash > 0) this.screenFlash(hot ? 0xe0c4ff : 0xcfe2ff, (hot ? 0.17 : 0.14) * flash, 0.26, peak)
    return {
      get reached() {
        return core.life >= core.peakAt
      },
    }
  }

  /** A short electrical discharge crawling over a failing frame. */
  arc(x: number, y: number, size = 1, color: number = COL.pink) {
    for (let k = 0; k < 2; k++) {
      const p = this.spawn('arc', x + randRange(-12, 12) * size, y + randRange(-12, 12) * size)
      p.max = randRange(0.05, 0.1)
      p.delay = k * 0.045
      p.sx0 = p.sx1 = size * randRange(0.55, 1.1) * (rand() < 0.5 ? -1 : 1)
      p.sy0 = p.sy1 = size * randRange(0.6, 1.2) * (rand() < 0.5 ? -1 : 1)
      p.im.rotation = randRange(-1.5, 1.5)
      p.im.setTint(k ? 0xffffff : color)
      if (p.delay > 0) p.im.setVisible(false)
    }
  }

  /** Vertical light pillar. */
  pillar(x: number, y: number, color: number, h = 900, life = 0.4, w = 1) {
    const p = this.spawn('cut', x, y - h / 2)
    p.im.rotation = Math.PI / 2
    p.max = life
    p.ease = 3
    p.sx0 = h / 500
    p.sx1 = (h / 500) * 1.2
    p.sy0 = 4 * w
    p.sy1 = 0.1
    p.im.setTint(color)
    const q = this.spawn('cut', x, y - h / 2)
    q.im.rotation = Math.PI / 2
    q.max = life * 0.7
    q.ease = 3
    q.sx0 = h / 500
    q.sx1 = h / 500
    q.sy0 = 1.6 * w
    q.sy1 = 0.05
  }

  motes(x: number, y: number, n: number, color: number, radius = 120) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2,
        d = rand() * radius
      const p = this.spawn('glow', x + Math.cos(a) * d, y + Math.sin(a) * d)
      p.vx = Math.cos(a) * randRange(20, 160)
      p.vy = -randRange(60, 320)
      p.drag = 1.2
      p.max = randRange(0.5, 1.2)
      p.sx0 = p.sy0 = randRange(0.06, 0.2)
      p.sx1 = p.sy1 = 0.01
      p.im.setTint(color)
    }
  }

  /** Telegraph line (returns nothing; lives for `life`). */
  beam(x0: number, y0: number, x1: number, y1: number, color: number, life: number, thick = 0.35) {
    const p = this.spawn('cut', (x0 + x1) / 2, (y0 + y1) / 2, DEPTH.backFx)
    p.im.rotation = Math.atan2(y1 - y0, x1 - x0)
    p.max = life
    p.im.setTint(color)
    p.sx0 = p.sx1 = (Math.hypot(x1 - x0, y1 - y0) / 500) * 1.2
    p.sy0 = thick * 0.3
    p.sy1 = thick * 1.6
    p.ease = 1
    p.a0 = 0.9
  }

  icon(key: string, x: number, y: number, life: number, scale = 0.6, color = 0xffffff) {
    const p = this.spawn(key, x, y)
    p.max = life
    p.sx0 = p.sy0 = scale * 1.6
    p.sx1 = p.sy1 = scale
    p.ease = 6
    p.im.setTint(color)
  }

  ghost(src: Puppet, color: number, alpha = 0.6, life = 0.25) {
    src.ghost(color, alpha, life)
  }

  text(x: number, y: number, str: string, color: string, size = 34) {
    const t =
      this.textPool.pop() ??
      this.scene.add
        .text(0, 0, '', { fontFamily: 'Impact, "Arial Black", "Segoe UI", sans-serif', fontStyle: 'italic' })
        .setOrigin(0.5)
        .setDepth(DEPTH.frontFx + 5)
    t.setText(str)
      .setFontSize(size)
      .setColor(color)
      .setStroke('#0a0d16', 6)
      .setPosition(x + randRange(-18, 18), y)
      .setVisible(true)
      .setAlpha(1)
    this.texts.push({ t, life: 0, max: 0.7, vy: -260 })
  }

  /** A full-screen veil of light. With `rise` it opens to full strength first, then decays over `life`. */
  screenFlash(color: number, alpha = 0.6, life = 0.12, rise = 0) {
    this.overlay.setFillStyle(color)
    this.overlayA = alpha
    this.overlayMax = life
    this.overlayRise = rise
    this.overlayLife = life + rise
    this.overlay.setAlpha(rise > 0 ? 0 : alpha)
  }

  /* ----------------------------- ripple ----------------------------- */

  private buildRipple() {
    const S = 256,
      c = document.createElement('canvas')
    c.width = c.height = S
    const g = c.getContext('2d', { willReadFrequently: true })!
    const img = g.createImageData(S, S),
      d = img.data
    const sm = (a: number, b: number, v: number) => {
      const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - S / 2) / (S / 2),
          dy = (y + 0.5 - S / 2) / (S / 2),
          r = Math.hypot(dx, dy) || 1e-4
        // One narrow radial crest: no oscillation or secondary concentric rings.
        const env = sm(0.58, 0.7, r) * (1 - sm(0.9, 1, r))
        const wave = Math.exp(-0.5 * Math.pow((r - 0.8) / 0.065, 2)) * env
        const i = (y * S + x) * 4
        d[i] = 128 + 127 * (dx / r) * wave
        d[i + 1] = 128 + 127 * (dy / r) * wave
        d[i + 2] = 128
        d[i + 3] = 255 * Math.min(1, env * 1.4)
      }
    g.putImageData(img, 0, 0)
    const tm = this.scene.textures
    if (!tm.exists('ripple')) tm.addCanvas('ripple', c)
    this.ripTex = (
      tm.exists('ripmap') ? tm.get('ripmap') : tm.addDynamicTexture('ripmap', RIP_W, RIP_H)
    ) as Phaser.Textures.DynamicTexture
    this.ripTex.fill(0x808080)
    this.ripTex.render()
    // neutral-grey frame so the displacement fades out before it can pull in pixels from beyond the screen edge
    if (!tm.exists('ripedge')) {
      const e = document.createElement('canvas')
      e.width = RIP_W
      e.height = RIP_H
      const eg = e.getContext('2d', { willReadFrequently: true })!
      const ed = eg.createImageData(RIP_W, RIP_H),
        B = 34
      for (let y = 0; y < RIP_H; y++)
        for (let x = 0; x < RIP_W; x++) {
          const m = Math.min(x, y, RIP_W - 1 - x, RIP_H - 1 - y),
            i = (y * RIP_W + x) * 4
          ed.data[i] = ed.data[i + 1] = ed.data[i + 2] = 128
          ed.data[i + 3] = 255 * (1 - sm(0, B, m))
        }
      eg.putImageData(ed, 0, 0)
      tm.addCanvas('ripedge', e)
    }
    const amt = 0.042
    this.ripFilter = this.scene.cameras.main.filters.external.addDisplacement('ripmap', amt, (amt * VIEW_W) / VIEW_H)
    this.ripFilter.setActive(false)
  }

  /** Screen-space water ripple expanding from a world point. */
  ripple(x: number, y: number, r1 = 1500, life = 1.1, amp = 1, delay = 0, sweeps = true) {
    // A new visible wave takes over the picture from the fading one, which carries on unseen: whatever it was
    // still sweeping away, it goes on sweeping.
    if (amp > 0) for (const r of this.rips) r.amp = 0
    this.rips.push({ x, y, t: -delay, life, r1, amp, sweeps })
  }
  /** World-space radius each live ripple has reached (used to sweep away projectiles). */
  ripFronts(): { x: number; y: number; r: number }[] {
    return this.rips.filter((r) => r.t > 0 && r.sweeps).map((r) => ({ x: r.x, y: r.y, r: Fx.ripRadius(r) * 0.8 }))
  }
  // Immediate, steady travel makes the front readable during the close-up cuts.
  private static ripRadius(r: Rip) {
    const t = Math.min(1, Math.max(0, r.t / r.life))
    return 30 + (r.r1 - 30) * t
  }

  private updateRipple(dt: number) {
    if (!this.rips.length) {
      if (this.ripFilter.active) this.ripFilter.setActive(false)
      return
    }
    const cam = this.scene.cameras.main
    let visible = false
    this.ripTex.clear()
    this.ripTex.fill(0x808080)
    for (let i = this.rips.length - 1; i >= 0; i--) {
      const r = this.rips[i]
      r.t += dt
      if (r.t < 0) continue
      const t = r.t / r.life
      if (t >= 1) {
        this.rips.splice(i, 1)
        continue
      }
      if (r.amp === 0) continue
      visible = true
      const rad = Fx.ripRadius(r) * cam.zoom
      // world -> screen -> ripple-map pixels
      const sx = (r.x - cam.midPoint.x) * cam.zoom + VIEW_W / 2,
        sy = (r.y - cam.midPoint.y) * cam.zoom + VIEW_H / 2
      this.ripTex.stamp('ripple', undefined, (sx / VIEW_W) * RIP_W, (sy / VIEW_H) * RIP_H, {
        scale: (rad / 128) * (RIP_W / VIEW_W),
        alpha: Math.min(1, r.amp * Math.min(1, t * 12) * Math.pow(1 - t, 0.9) * 1.25),
      })
    }
    if (visible) {
      this.ripTex.stamp('ripedge', undefined, RIP_W / 2, RIP_H / 2)
      this.ripTex.render()
    }
    this.ripFilter.setActive(visible)
  }
}
