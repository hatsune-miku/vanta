import * as Phaser from 'phaser'

import { Backdrop, makePlatform } from '../art/stage'
import { ORIGIN } from '../art/textures'
import { Sfx } from '../audio/sfx'
import {
  ANCHOR_RANGE,
  BASE_ZOOM,
  CAM_REST_Y,
  COL,
  DEPTH,
  GROUND_Y,
  START_ARENA,
  STEP,
  TEST_MODE,
  VIEW_H,
  VIEW_W,
  WORLD_W,
} from '../config'
import { Input } from '../core/input'
import { Box, clamp, damp, lerp, overlap, rand, randRange, reseed, segmentBox } from '../core/util'
import { Actor, Anchor, HitDef, Plat, Proj, Threat, World } from '../game/actor'
import { CamShot, CineHost, ExecCine } from '../game/cine'
import { CounterCine } from '../game/counter'
import { Enemy, spawnEnemy } from '../game/enemies'
import { Fx } from '../game/fx'
import { KeyHint } from '../game/keyHint'
import { Player } from '../game/player'
import { Stage3D } from '../three/stage3d'

interface Arena {
  l: number
  r: number
  plats: Plat[]
  waves: [kind: string, at: number][][]
  boss?: boolean
}

const ARENAS: Arena[] = [
  {
    l: 700,
    r: 3000,
    plats: [],
    waves: [
      [
        ['grunt', 0.7],
        ['grunt', 0.88],
      ],
      [
        ['grunt', 0.12],
        ['grunt', 0.8],
        ['gunner', 0.94],
      ],
      [
        ['grunt', 0.2],
        ['grunt', 0.75],
        ['gunner', 0.06],
        ['gunner', 0.94],
      ],
    ],
  },
  {
    l: 3700,
    r: 6100,
    plats: [
      { x: 4250, y: 650, w: 420 },
      { x: 5130, y: 650, w: 420 },
      { x: 4690, y: 430, w: 420 },
    ],
    waves: [
      [
        ['drone', 0.3],
        ['drone', 0.7],
        ['grunt', 0.82],
        ['grunt', 0.18],
      ],
      [
        ['heavy', 0.8],
        ['gunner', 0.08],
        ['gunner', 0.92],
      ],
      [
        ['titan', 0.8],
        ['grunt', 0.15],
        ['drone', 0.5],
      ],
    ],
  },
  {
    l: 6800,
    r: 9200,
    plats: [
      { x: 7400, y: 630, w: 480 },
      { x: 8120, y: 630, w: 480 },
    ],
    waves: [
      [
        ['heavy', 0.78],
        ['heavy', 0.22],
        ['drone', 0.5],
      ],
      [
        ['grunt', 0.12],
        ['grunt', 0.28],
        ['grunt', 0.72],
        ['grunt', 0.88],
        ['gunner', 0.04],
        ['gunner', 0.96],
      ],
      [
        ['titan', 0.25],
        ['heavy', 0.8],
        ['drone', 0.5],
        ['gunner', 0.95],
      ],
    ],
  },
  { l: 9900, r: 12120, plats: [], waves: [[['warden', 0.74]]], boss: true },
]

const ALL_PLATS = ARENAS.flatMap((a) => a.plats)

/** Traversal anchors live in the corridors between arenas, never where enemies spawn. */
const ANCHORS: [number, number][] = [
  [330, 560],
  [620, 400],
  [3140, 520],
  [3400, 330],
  [3640, 560],
  [6240, 520],
  [6500, 330],
  [6740, 560],
  [9340, 520],
  [9600, 330],
  [9840, 560],
]

const sfx = new Sfx()
const input = new Input()
export const shared = { sfx, input }

export class Battle extends Phaser.Scene implements World, CineHost {
  stage: Phaser.Scene = this
  fx!: Fx
  sfx = sfx
  ctl = input
  player!: Player
  enemies: Enemy[] = []
  projs: Proj[] = []
  plats: Plat[] = []
  bounds = { l: 0, r: WORLD_W }
  frame = 0
  threat: Threat | null = null
  anchor: Anchor | null = null
  private anchors: {
    x: number
    y: number
    im: Phaser.GameObjects.Image
    halo: Phaser.GameObjects.Image
    key: KeyHint
    k: number
    rot: number
  }[] = []

  // time
  private acc = 0
  private stop = 0
  private slowT = 0
  private slowScale = 1
  private visualTime = 0
  // camera
  cam: CamShot = { x: 960, y: 540, zoom: 1, rot: 0 }
  private shakeAmp = 0
  private punch = 0
  /** smoothed look-ahead, so a turn swings the view round instead of snapping it */
  private lead = 0
  cineAmt = 0
  cine: ExecCine | CounterCine | null = null
  private lastExec = -9999
  private parryBoxes: Box[] = []
  private backdrop!: Backdrop
  private layer3d!: Phaser.GameObjects.Image
  // director
  arenaIdx = 0
  wave = -1
  locked = false
  cleared: boolean[] = []
  private waveDelay = 0
  private gates: Phaser.GameObjects.Image[] = []
  private melee = new Set<Actor>()
  private ranged = new Set<Actor>()
  // stats / hud feed
  comboN = 0
  comboT = 0
  maxCombo = 0
  execs = 0
  kills = 0
  clock = 0
  banner: { text: string; sub: string; t: number } | null = null
  over: '' | 'dead' | 'win' = ''
  private overT = 0
  paused = false
  boss: Enemy | null = null
  private startArena = 0
  private restarting = false

  constructor() {
    super('Battle')
  }
  init(data: { arena?: number }) {
    this.startArena = data?.arena ?? START_ARENA
  }

  create() {
    this.restarting = false
    this.ctl.reset()
    reseed(20261113)
    this.enemies = []
    this.projs = []
    this.plats = []
    this.gates = []
    this.melee.clear()
    this.ranged.clear()
    this.frame = 0
    this.acc = 0
    this.stop = 0
    this.slowT = 0
    this.cine = null
    this.cineAmt = 0
    this.visualTime = 0
    this.comboN = this.comboT = this.maxCombo = this.execs = this.kills = 0
    this.clock = 0
    this.banner = null
    this.over = ''
    this.overT = 0
    this.paused = false
    this.boss = null
    this.locked = false
    this.wave = -1
    this.waveDelay = 0
    this.lastExec = -9999
    this.parryBoxes = []
    this.arenaIdx = Math.trunc(clamp(this.startArena, 0, ARENAS.length - 1))
    this.cleared = ARENAS.map((_, i) => i < this.arenaIdx)
    this.bounds = { l: 0, r: WORLD_W }

    this.backdrop = new Backdrop(this, WORLD_W)
    Stage3D.I.reset()
    // every 3D body is drawn into this one camera-fixed layer
    this.layer3d = this.add
      .image(VIEW_W / 2, VIEW_H / 2, 'actors3d')
      .setScrollFactor(0)
      .setDepth(DEPTH.enemy + 5)
    for (const a of ARENAS) {
      for (const p of a.plats) {
        const key = makePlatform(this, p.w)
        this.add.image(p.x, p.y, key).setOrigin(ORIGIN[key][0], ORIGIN[key][1]).setScale(0.5).setDepth(DEPTH.props)
      }
      for (const x of [a.l, a.r])
        this.gates.push(
          this.add
            .image(x, 0, 'gate')
            .setOrigin(0.5, 0)
            .setScale(1.2, GROUND_Y / 512)
            .setDepth(DEPTH.frontFx)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0)
        )
    }
    this.anchors = ANCHORS.map(([x, y]) => ({
      x,
      y,
      k: 0,
      rot: 0,
      key: new KeyHint(this, 'O', COL.cyan),
      im: this.add
        .image(x, y - 80, 'anchor')
        .setDepth(DEPTH.props + 8)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.5),
      halo: this.add
        .image(x, y - 80, 'ring')
        .setDepth(DEPTH.props + 7)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(COL.main)
        .setAlpha(0),
    }))
    this.anchor = null
    this.threat = null
    this.fx = new Fx(this)
    const a = ARENAS[this.arenaIdx]
    this.player = new Player(this, this.arenaIdx === 0 ? 260 : a.l - 260)
    this.cam.x = clamp(this.player.x, VIEW_W / 2, WORLD_W - VIEW_W / 2)
    this.cam.y = CAM_REST_Y
    this.cam.zoom = BASE_ZOOM
    this.cam.rot = 0
    this.lead = 0
    this.shakeAmp = this.punch = 0

    // post: bloom on the world camera, vignette in screen space
    const cam = this.cameras.main
    const pf = cam.filters.internal.addParallelFilters()
    pf.top.addThreshold(0.74, 1)
    pf.top.addBlur(1, 2.5, 2.5, 1.25, 0xffffff, 4)
    pf.blend.blendMode = Phaser.BlendModes.ADD
    pf.blend.amount = 0.45
    cam.filters.external.addVignette(0.5, 0.5, 0.92, 0.42)

    if (!this.scene.isActive('Hud')) this.scene.launch('Hud')
    this.scene.bringToTop('Hud')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      cam.filters.internal.clear()
      cam.filters.external.clear()
      Stage3D.I.reset()
    })
    this.sfx.startMusic()
    if (TEST_MODE) this.installTestHooks()
    this.draw(1, 0)
  }

  /* ----------------------------------- loop ----------------------------------- */

  update(_t: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000
    if (!TEST_MODE) {
      if (this.paused) {
        this.pollPause()
        if (this.paused) return
      }
      // Skill time follows elapsed play time, even when rendering is below 20 Hz.
      // Phaser smooths deltaMs and the physics cap above deliberately drops time.
      if (!this.over) this.player.updateOverload(this.game.loop.rawDelta / 1000)
      const scale = this.slowT > 0 ? this.slowScale : 1
      if (this.slowT > 0) this.slowT -= dt
      this.acc += dt * scale
      let n = 0
      while (!this.paused && this.acc >= STEP && n++ < 5) {
        this.acc -= STEP
        this.tick()
      }
      if (this.paused) {
        this.acc = 0
        return
      }
      if (n >= 5) this.acc = 0
      const fdt = dt * (this.cine ? this.cine.rate : this.slowT > 0 ? Math.max(0.4, this.slowScale) : 1)
      if (!this.paused) {
        this.fx.update(fdt)
        Stage3D.I.update(fdt)
      }
      this.sweepProjs()
    }
    if (this.paused || this.restarting) return
    this.visualTime += dt
    // scripted runs render rarely and far apart: snap rather than smooth
    this.draw(TEST_MODE ? 1 : this.acc / STEP, TEST_MODE ? 1 : dt)
  }

  private pollPause() {
    this.ctl.poll()
    if (this.ctl.take('pause')) {
      this.paused = false
      this.sfx.play('ui')
    }
    this.ctl.clear()
  }

  /** One fixed logic step. */
  tick() {
    if (this.restarting) return
    this.ctl.poll(this.stop > 0)
    if (this.ctl.anyPressed) this.sfx.unlock()
    if (this.paused) {
      if (this.ctl.take('pause')) {
        this.paused = false
        this.sfx.play('ui')
      }
      this.ctl.clear()
      return
    }
    if (TEST_MODE) {
      const fdt = STEP * (this.cine ? this.cine.rate : 1)
      this.fx.update(fdt)
      Stage3D.I.update(fdt)
      this.sweepProjs()
    }
    if (this.over) {
      this.overT++
      if (this.overT > 70 && this.ctl.anyPressed) {
        this.restart()
        return
      }
      if (this.over === 'win') return
    } else if (this.ctl.take('pause')) {
      this.paused = true
      this.ctl.clear()
      this.sfx.play('ui')
      return
    }
    if (TEST_MODE && !this.over) this.player.updateOverload(STEP)
    if (this.ctl.take('overload') && !this.over && !this.cine) this.player.activateOverload()
    if (this.cine) {
      this.cine.update()
      if (this.cine.done) {
        this.cine = null
        this.shakeAmp = this.punch = 0
      }
      this.ctl.clear()
      return
    }
    if (this.stop > 0) {
      this.stop--
      // A hit freezes the contact pose, including render interpolation. Without
      // snapping history, the last movement step would replay during the stop.
      this.player.px = this.player.x
      this.player.py = this.player.y
      for (const e of this.enemies) {
        e.px = e.x
        e.py = e.y
      }
      return
    }
    this.frame++
    if (!this.over) this.clock += STEP
    if (this.comboT > 0 && --this.comboT === 0) this.comboN = 0
    if (this.banner && --this.banner.t <= 0) this.banner = null
    this.threat = this.findThreat()
    this.anchor = this.findAnchor()
    this.parryBoxes = []
    this.player.update()
    if (this.cine) return
    for (const e of this.enemies) {
      if (!e.gone) e.update()
      if (this.cine) return
    }
    this.enemies = this.enemies.filter((e) => !e.gone)
    this.updateProjs()
    if (this.cine) return
    this.direct()
    if (this.player.dead && !this.over && this.player.onGround && this.player.st > 50) {
      this.over = 'dead'
      this.overT = 0
    }
  }

  private restart() {
    this.restarting = true
    this.sfx.play('ui')
    this.scene.restart({ arena: this.over === 'win' ? 0 : this.arenaIdx })
  }

  /* ----------------------------------- director ----------------------------------- */

  private direct() {
    const a = ARENAS[this.arenaIdx]
    if (!a || this.over) return
    if (!this.locked) {
      if (!this.cleared[this.arenaIdx] && this.player.x > a.l + 420) {
        this.locked = true
        this.wave = -1
        this.waveDelay = 30
        this.bounds = { l: a.l, r: a.r }
        this.plats = a.plats
        this.banner = {
          text: a.boss ? '典狱者 · WARDEN' : `封锁区 0${this.arenaIdx + 1}`,
          sub: '清除所有敌对单位',
          t: 130,
        }
        this.sfx.play('gate')
      } else {
        // free roam between arenas: every platform is solid
        this.plats = ALL_PLATS
      }
      return
    }
    if (this.enemies.length > 0) return
    if (this.waveDelay > 0) {
      this.waveDelay--
      return
    }
    if (this.wave + 1 < a.waves.length) {
      this.wave++
      for (const [kind, at] of a.waves[this.wave]) {
        const e = spawnEnemy(this, kind, lerp(a.l + 120, a.r - 120, at))
        this.enemies.push(e)
        if (e.isBoss) this.boss = e
      }
      this.waveDelay = 40
    } else {
      this.locked = false
      this.cleared[this.arenaIdx] = true
      this.bounds = { l: 0, r: WORLD_W }
      this.sfx.play('clear')
      if (a.boss) {
        this.over = 'win'
        this.overT = 0
        this.sfx.stopMusic()
        return
      }
      this.banner = { text: '区域肃清', sub: '继续前进 ▶', t: 150 }
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30)
      this.arenaIdx++
    }
  }

  get waveInfo() {
    const a = ARENAS[this.arenaIdx]
    return this.locked && a && !a.boss ? `${Math.max(1, this.wave + 1)} / ${a.waves.length}` : ''
  }
  get goHint() {
    return !this.locked && !this.over && this.arenaIdx < ARENAS.length && !this.cleared[this.arenaIdx]
  }

  /* ----------------------------------- combat services ----------------------------------- */

  hitstop(n: number) {
    this.stop = Math.max(this.stop, n)
  }
  shake(amp: number, zoomPunch = 0) {
    // All non-cinematic attacks, damage and landings leave the camera steady.
    if (!this.cine) return
    this.shakeAmp = Math.max(this.shakeAmp, amp)
    this.punch = Math.max(this.punch, zoomPunch)
  }
  slowmo(scale: number, realFrames: number) {
    this.slowScale = scale
    this.slowT = realFrames / 60
  }
  combo(n: number) {
    if (n <= 0) {
      this.comboN = 0
      this.comboT = 0
      return
    }
    this.comboN += n
    this.comboT = 170
    this.maxCombo = Math.max(this.maxCombo, this.comboN)
  }
  takeToken(a: Actor, isRanged: boolean) {
    const s = isRanged ? this.ranged : this.melee
    if (s.has(a)) return true
    if (s.size >= 2) return false
    s.add(a)
    return true
  }
  releaseToken(a: Actor) {
    this.melee.delete(a)
    this.ranged.delete(a)
  }

  attack(src: Actor, box: Box, hit: HitDef, hitSet: Set<Actor>): number {
    let n = 0
    if (src.team === 0) {
      if (hit.heavy) this.parryBoxes.push(box)
      let heavy = false
      for (const e of this.enemies) {
        if (e.dead || hitSet.has(e) || !overlap(box, e.box)) continue
        const dir = Math.abs(e.x - src.x) < 20 ? src.facing : Math.sign(e.x - src.x)
        const damage = hit.dmg * (hit.multiplier ?? this.player.damageMultiplier)
        if (!e.takeHit(hit, src, dir)) continue
        hitSet.add(e)
        n++
        this.hitFx(e, box, hit, dir, damage)
        heavy ||= !!hit.heavy
      }
      for (const p of this.projs) {
        if (
          p.team === 1 &&
          (hit.heavy || p.kind === 'bolt') &&
          p.delay <= 0 &&
          !p.dead &&
          overlap(box, this.projBox(p))
        ) {
          this.parryProj(p)
        }
      }
      if (n > 0) {
        this.hitstop(hit.stop)
        this.shake(hit.shake, heavy ? 0.045 : 0.015)
        this.sfx.play(heavy ? 'hitHeavy' : 'hit')
        this.combo(n)
        this.player.gainEnergy(n * (heavy ? 5 : 3))
      }
    } else {
      const p = this.player
      if (!hitSet.has(p) && !p.dead && (overlap(box, p.box) || (p.dashIFrames && p.dodgeTouches(box)))) {
        const dir = Math.abs(p.x - src.x) < 20 ? src.facing : Math.sign(p.x - src.x)
        const wasDodging = p.dashIFrames
        if (p.takeHit(hit, src, dir)) {
          hitSet.add(p)
          n++
        } else if (wasDodging) hitSet.add(p)
      }
    }
    return n
  }

  private hitFx(e: Actor, box: Box, hit: HitDef, dir: number, damage: number) {
    const fx = this.fx,
      eb = e.box
    const x = clamp(e.x, box.x, box.x + box.w) + randRange(-14, 14)
    const y = clamp(e.cy, Math.max(box.y, eb.y), Math.min(box.y + box.h, eb.y + eb.h)) + randRange(-24, 24)
    const ang = (dir > 0 ? 0 : Math.PI) + (hit.ky < -400 ? -dir * 1.1 : hit.spike ? dir * 1.0 : randRange(-0.3, 0.3))
    // blade on armour: a shower of hot sparks thrown along the cut, and a seam left glowing on the plate
    fx.weld(x, y, ang - dir * 0.25, hit.heavy ? 42 : 22, hit.heavy ? 1.45 : 1.1, GROUND_Y)
    fx.seam(x, y, ang + randRange(-0.7, 0.7), hit.heavy ? 190 : 120, hit.heavy ? 0.7 : 0.45)
    fx.cut(x, y, ang + randRange(-0.25, 0.25), hit.heavy ? 460 : 300, COL.main, 0.14, hit.heavy ? 0.85 : 0.55)
    fx.glint(x, y, 0xe9f7ff, hit.heavy ? 0.52 : 0.3, hit.heavy ? 0.15 : 0.1)
    fx.text(e.x, eb.y - 20, String(Math.round(damage)), hit.heavy ? '#ff9fe6' : '#ffffff', hit.heavy ? 40 : 30)
  }

  spawnProj(o: Partial<Proj> & { kind: Proj['kind']; x: number; y: number; team: number }): Proj {
    const key = o.kind === 'bolt' ? 'bolt' : o.kind === 'surge' ? 'surge_blade' : 'glow'
    const im = this.add.image(o.x, o.y, key).setDepth(DEPTH.frontFx).setBlendMode(Phaser.BlendModes.ADD)
    if (o.kind === 'bolt') im.setScale(0.6).setRotation(Math.atan2(o.vy ?? 0, o.vx ?? 1))
    if (o.kind === 'surge') im.setOrigin(0.5).setRotation(0)
    if (o.kind === 'shock') im.setScale(0.9, 0.45).setTint(COL.hostile).setOrigin(0.5, 0.8)
    if (o.kind === 'rain') im.setVisible(false)
    const p: Proj = {
      vx: 0,
      vy: 0,
      life: 100,
      dmg: 5,
      w: 20,
      h: 20,
      owner: null,
      delay: 0,
      dead: false,
      ...o,
      im,
      hitSet: new Set(),
    }
    if (p.kind === 'rain') this.fx.beam(p.x, 0, p.x, GROUND_Y, COL.hostile, p.delay / 60, 0.9)
    this.projs.push(p)
    if (p.screenX !== undefined) this.syncSurge(p)
    return p
  }

  spawnSurge(hit: HitDef) {
    return this.spawnProj({
      kind: 'surge',
      x: 0,
      y: 0,
      screenX: -160,
      vx: 400,
      vy: 0,
      team: 0,
      dmg: hit.dmg,
      hit,
      w: 100,
      h: VIEW_H,
      life: 600,
      owner: this.player,
    })
  }

  private syncSurge(p: Proj) {
    const zoom = this.cam.zoom
    p.x = this.cam.x + (p.screenX! - VIEW_W / 2) / zoom
    p.y = this.cam.y
    p.w = 100 / zoom
    p.h = (VIEW_H + 120) / zoom
    p.im
      .setPosition(p.x, p.y)
      .setDisplaySize(180 / zoom, p.h)
      .setRotation(0)
  }

  private projBox(p: Proj): Box {
    return { x: p.x - p.w / 2, y: p.y - (p.kind === 'shock' || p.kind === 'rain' ? p.h : p.h / 2), w: p.w, h: p.h }
  }
  private parryProj(p: Proj) {
    p.dead = true
    p.im.setVisible(false)
    this.fx.weld(p.x, p.y, rand() * 6.28, 16, 1, GROUND_Y, 2)
    this.sfx.play('clang')
    this.player.gainEnergy(2)
  }

  /** Resolve swept contacts before hostile bullets can hit the player, regardless of spawn order. */
  private absorbSurgeBullets() {
    for (const blade of this.projs) {
      if (blade.kind !== 'surge' || blade.dead) continue
      this.syncSurge(blade)
      const box = this.projBox(blade),
        dx = (blade.vx * STEP) / this.cam.zoom
      for (const bullet of this.projs) {
        if (bullet.team !== 1 || bullet.kind !== 'bolt' || bullet.dead || bullet.delay > 1) continue
        if (
          !segmentBox(bullet.x, bullet.y, bullet.x + bullet.vx * STEP - dx, bullet.y + bullet.vy * STEP, {
            x: box.x - bullet.w / 2,
            y: box.y - bullet.h / 2,
            w: box.w + bullet.w,
            h: box.h + bullet.h,
          })
        )
          continue
        bullet.dead = true
        bullet.im.setVisible(false)
        this.fx.glint(blade.x, bullet.y, COL.cyan, 0.24, 0.12)
        this.fx.spark(blade.x, bullet.y, 0, 6, COL.cyan, 0.35, 2)
      }
    }
  }

  private updateProjs() {
    const pl = this.player,
      fx = this.fx
    this.absorbSurgeBullets()
    for (const p of this.projs) {
      if (p.dead) continue
      if (p.delay > 0) {
        if (--p.delay === 0 && p.kind === 'rain') {
          fx.pillar(p.x, GROUND_Y, COL.hostile, 1000, 0.3, 0.7)
          fx.ring(p.x, GROUND_Y, COL.hostile, 30, 220, 0.3, 0.25)
          fx.weld(p.x, GROUND_Y, -Math.PI / 2, 24, 1.2, GROUND_Y, 1.3)
          this.shake(6)
          this.sfx.play('hitHeavy')
        }
        if (p.delay > 0) continue
      }
      if (p.screenX !== undefined) {
        p.screenX += p.vx * STEP
        this.syncSurge(p)
      } else {
        p.x += p.vx * STEP
        p.y += p.vy * STEP
      }
      p.im.setPosition(p.x, p.y)
      const box = this.projBox(p)
      if (p.team === 1) {
        if (
          this.parryBoxes.some((area) =>
            segmentBox(p.x - p.vx * STEP, box.y + box.h / 2 - p.vy * STEP, p.x, box.y + box.h / 2, {
              x: area.x - p.w / 2,
              y: area.y - p.h / 2,
              w: area.w + p.w,
              h: area.h + p.h,
            })
          )
        ) {
          this.parryProj(p)
          continue
        }
        if (
          !p.hitSet.has(pl) &&
          !pl.dead &&
          (overlap(box, pl.box) || (pl.dashIFrames && pl.dodgeTouches(box, p.vx * STEP, p.vy * STEP)))
        ) {
          const dodge = pl.dashIFrames
          const hit = { dmg: p.dmg, kx: 320, ky: p.kind === 'bolt' ? 0 : -420, stun: 18, stop: 5, shake: 7 }
          if (dodge) {
            pl.extremeDodge({
              src: p.owner,
              negate: () => {
                p.hitSet.add(pl)
                p.dead = true
                p.im.setVisible(false)
              },
            })
          } else if (pl.takeHit(hit, p.owner, Math.sign(p.vx) || Math.sign(pl.x - p.x) || 1)) {
            if (p.kind === 'bolt') p.dead = true
            else p.hitSet.add(pl)
          }
          if (this.cine) break
        }
        if (p.kind === 'shock' && this.frame % 2 === 0) {
          fx.spark(p.x, p.y, -Math.PI / 2, 2, COL.hostile, 0.6, 0.6)
          fx.dust(p.x, p.y, 0, 1, 0xd08090)
        }
        if (p.kind === 'bolt' && p.y > GROUND_Y) {
          p.dead = true
          fx.spark(p.x, GROUND_Y, -Math.PI / 2, 5, COL.hostile, 0.6, 1.2)
        }
      } else {
        for (const e of this.enemies) {
          if (e.dead || p.hitSet.has(e) || !overlap(box, e.box)) continue
          const dir = Math.sign(p.vx) || 1
          if (!p.hit) continue
          const hit = p.hit,
            damage = hit.dmg * (hit.multiplier ?? pl.damageMultiplier)
          if (e.takeHit(hit, pl, dir)) {
            p.hitSet.add(e)
            this.hitFx(e, box, hit, dir, damage)
            this.combo(1)
            this.hitstop(hit.stop)
            this.shake(hit.shake, 0.025)
            this.sfx.play('hitHeavy')
          }
        }
        if (this.frame % 2 === 0)
          fx.spark(p.x, p.y + randRange(-90, 90), Math.PI + (p.vx > 0 ? 0 : Math.PI), 1, COL.main, 0.5, 0.2)
        if (p.kind === 'surge' && this.frame % 3 === 0) {
          // Keep one travelling blade; uneven particles trail it instead of a row of repeated arcs.
          fx.spark(
            p.x - Math.sign(p.vx) * randRange(15, 75),
            p.y + randRange(-220, 220),
            p.vx > 0 ? Math.PI : 0,
            3,
            rand() < 0.4 ? COL.pink : COL.cyan,
            randRange(0.7, 1.4),
            0.65,
            0.1
          )
          fx.weld(p.x, p.y + randRange(-180, 180), p.vx > 0 ? Math.PI : 0, 5, 0.8, 0)
        }
        p.im.setAlpha(Math.min(1, p.life / 12))
      }
      const outside =
        p.screenX !== undefined ? p.screenX > VIEW_W + 160 : p.x < this.bounds.l - 300 || p.x > this.bounds.r + 300
      if (--p.life <= 0 || outside) p.dead = true
    }
    for (const p of this.projs) if (p.dead) p.im.destroy()
    this.projs = this.projs.filter((p) => !p.dead)
  }

  onEnemyDead(a: Actor, executed: boolean) {
    this.kills++
    this.releaseToken(a)
    if (!executed) this.player.gainEnergy(6)
    if ((a as Enemy).isBoss) {
      if (!executed) this.slowmo(0.2, 90)
      for (const p of this.projs) p.dead = true
    }
  }

  /* ----------------------------------- execution ----------------------------------- */

  /** Called by the player on the execute button. */
  tryExecute(): boolean {
    const best = this.executionTarget
    if (!best) return false
    const quick = this.frame - this.lastExec < 200 && !best.isBoss && best.kind !== 'titan'
    this.stop = 0
    this.slowT = 0
    for (const e of this.enemies) e.flashT = 0
    this.cine = new ExecCine(this, best, quick)
    return true
  }

  tryCounter(source: Actor, hit: HitDef): boolean {
    if (this.cine || this.over || this.player.dead) return false
    const target = this.enemies.find((e) => e === source && !e.dead && !e.gone && e.state !== 'reviving')
    if (!target) return false
    this.stop = this.slowT = 0
    target.holdForCounter()
    this.cine = new CounterCine(this, target, hit)
    return true
  }

  onCountered(target: Enemy, hit: HitDef, dir: number) {
    if (!target.takeHit(hit, this.player, dir)) return
    const damage = hit.dmg * (hit.multiplier ?? this.player.damageMultiplier)
    this.hitFx(target, target.box, hit, dir, damage)
    this.combo(1)
  }
  get executionTarget(): Enemy | null {
    if (this.cine || this.over || this.paused || this.player.dead) return null
    const p = this.player
    let best: Enemy | null = null,
      bd = 1e9
    for (const e of this.enemies) {
      if (!this.canExecute(e)) continue
      const d = Math.abs(e.x - p.x) + Math.abs(e.cy - p.cy) * 0.6
      if (d < bd) {
        bd = d
        best = e
      }
    }
    return best
  }
  /** Any dying enemy that is on screen can be executed, however far away. */
  private canExecute(e: Enemy) {
    return !e.gone && e.dying && Math.abs(e.x - this.cam.x) < VIEW_W / 2 / BASE_ZOOM + 60
  }

  /**
   * The anchor a dodge would jump to: the nearest one within two thirds of a screen. While a direction is
   * held only anchors on that side count, so a chain of anchors can be ridden forward instead of bouncing
   * back to the one just left.
   */
  private findAnchor() {
    const p = this.player,
      ax = this.ctl.axis
    let best: Anchor | null = null,
      bd = ANCHOR_RANGE
    if (p.overloaded) {
      for (const e of this.enemies) {
        if (
          e.dead ||
          e.gone ||
          e.anchorUsed ||
          e.state === 'spawn' ||
          e.state === 'reviving' ||
          e.x < this.bounds.l ||
          e.x > this.bounds.r
        )
          continue
        const dx = e.x - p.x,
          y = Math.min(GROUND_Y, e.flying ? e.cy + p.h * 0.55 : e.y),
          distance = Math.hypot(dx, y - p.y)
        if (distance >= bd || (ax && dx * ax < 0)) continue
        const dir = Math.sign(dx) || p.facing
        bd = distance
        best = { x: e.x - dir * Math.max(90, (p.w + e.w) / 2 + 15), y, target: e }
      }
      if (best) return best
    }
    for (const a of this.anchors) {
      if (a.x < this.bounds.l + 40 || a.x > this.bounds.r - 40) continue
      const dx = a.x - p.x,
        d = Math.hypot(dx, a.y - p.y)
      if (d < 110 || d >= bd) continue // already there, or further than the best so far
      if (ax && dx * ax < 60) continue // not in the held direction
      bd = d
      best = a
    }
    return best
  }

  /** The attack that is about to land on the player, if any. */
  private findThreat(): Threat | null {
    const p = this.player
    if (p.dead || this.cine) return null
    let best: Enemy | null = null,
      bd = 1e9
    for (const e of this.enemies) {
      if (!e.threatens(p)) continue
      const d = Math.abs(e.x - p.x)
      if (d < bd) {
        bd = d
        best = e
      }
    }
    if (best) {
      const e = best
      return { src: e, negate: () => e.negate(p) }
    }
    for (const q of this.projs) {
      if (q.team !== 1 || q.dead || q.hitSet.has(p)) continue
      const dx = p.x - q.x,
        dy = p.cy - q.y
      let near = false
      if (q.kind === 'bolt') near = q.delay <= 0 && Math.hypot(dx, dy) < 250 && dx * q.vx + dy * q.vy > 0
      else if (q.kind === 'shock')
        near =
          q.delay <= 0 &&
          Math.abs(dx) < 230 &&
          (dx * q.vx >= 0 || overlap(this.projBox(q), p.box)) &&
          p.box.y + p.box.h > q.y - q.h
      else if (q.kind === 'rain') near = q.delay <= 13 && Math.abs(dx) < 110
      if (!near) continue
      return {
        src: q.owner && !q.owner.dead ? q.owner : null,
        negate: () => {
          q.hitSet.add(p)
          q.dead = true
          q.im.setVisible(false)
          this.fx.spark(q.x, q.kind === 'rain' ? p.cy : q.y, rand() * 6.28, 10, COL.main, 0.9, 3)
        },
      }
    }
    return null
  }

  /** The execution ripple wipes hostile projectiles as its front passes them. */
  private sweepProjs() {
    const fronts = this.fx.ripFronts()
    if (!fronts.length) return
    for (const q of this.projs) {
      if (q.team !== 1 || q.dead) continue
      const qy = q.kind === 'rain' ? GROUND_Y - 200 : q.y
      if (fronts.some((f) => Math.hypot(q.x - f.x, qy - f.y) < f.r)) {
        q.dead = true
        q.im.setVisible(false)
        this.fx.spark(q.x, qy, rand() * 6.28, 5, 0xffffff, 0.6, 3)
      }
    }
  }

  onExecuted(_t: Enemy) {
    this.execs++
    this.lastExec = this.frame
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 14)
    this.player.gainEnergy(25)
    this.combo(5)
    this.fx.text(this.player.x, this.player.y - 260, '+14', '#9dffb0', 34)
  }

  /* ----------------------------------- render ----------------------------------- */

  /** alpha: how far between two logic steps we are; dt: real seconds since the last draw. */
  private draw(alpha: number, dt: number) {
    const cam = this.cameras.main,
      p = this.player
    if (this.stop > 0) alpha = 1
    const time = this.visualTime
    p.render(alpha, time)
    for (const e of this.enemies) if (!e.gone) e.render(alpha, time)
    // camera: look ahead in the direction of travel (more at speed), ease everything in real time
    if (!this.cine) {
      const half = VIEW_W / 2 / BASE_ZOOM
      const lo = (this.locked ? this.bounds.l : 0) + half,
        hi = (this.locked ? this.bounds.r : WORLD_W) - half
      this.lead = damp(this.lead, p.facing * 90 + clamp(p.vx * 0.26, -300, 300), 5, dt)
      const tx = clamp(lerp(p.px, p.x, alpha) + this.lead, lo, Math.max(lo, hi))
      const ty = CAM_REST_Y + clamp((p.y - 640) * 0.55, -300, 0)
      this.cam.x = damp(this.cam.x, tx, 9, dt)
      this.cam.y = damp(this.cam.y, ty, 7, dt)
      this.cam.zoom = damp(this.cam.zoom, BASE_ZOOM, 8, dt)
      this.cam.rot = 0
      if (Math.abs(this.cam.zoom - BASE_ZOOM) < 0.002) this.cam.zoom = BASE_ZOOM
    }
    this.shakeAmp = damp(this.shakeAmp, 0, this.cine ? 6.5 : 9, dt)
    this.punch = damp(this.punch, 0, 10.5, dt)
    const sh = this.shakeAmp > 0.3 ? this.shakeAmp : 0
    cam.setZoom(this.cam.zoom + this.punch)
    cam.setRotation(this.cam.rot)
    cam.setScroll(
      this.cam.x - VIEW_W / 2 + (Math.random() - 0.5) * 2 * sh,
      this.cam.y - VIEW_H / 2 + (Math.random() - 0.5) * 2 * sh
    )
    for (const q of this.projs) if (q.screenX !== undefined && !q.dead) this.syncSurge(q)
    this.backdrop.update(cam, time)
    this.backdrop.dim.setAlpha(this.cineAmt * 0.78)
    // draw the bodies with the same view Phaser is about to use, then hand the canvas over as a texture
    const z = cam.zoom
    Stage3D.I.render(cam.scrollX + VIEW_W / 2, cam.scrollY + VIEW_H / 2, z)
    this.textures.get('actors3d').source[0].update()
    this.layer3d.setScale(1 / z)
    // anchors: idle ones stay dim, the active one opens up
    for (const a of this.anchors) {
      a.k = damp(a.k, a === this.anchor && !this.cine ? 1 : 0, 13, dt)
      const bob = Math.sin(time * 2 + a.x) * 6
      a.rot += Math.min(dt, 0.05) * (0.3 + a.k * 1.5)
      a.im
        .setPosition(a.x, a.y - 80 + bob)
        .setAlpha(0.3 + a.k * 0.7)
        .setScale(0.5 + a.k * 0.18)
        .setRotation(a.rot)
      a.halo
        .setPosition(a.x, a.y - 80 + bob)
        .setAlpha(a.k * 0.5)
        .setScale(0.26 + ((time * 1.2) % 1) * 0.2 * a.k)
      a.key.setVisible(a === this.anchor && !this.cine && !this.over).setPosition(a.x, a.y - 28 + bob)
    }
    // gates
    for (let i = 0; i < this.gates.length; i++) {
      const on = this.locked && i >> 1 === this.arenaIdx
      const g = this.gates[i]
      g.setAlpha(damp(g.alpha, on ? 0.55 + Math.sin(time * 6 + i) * 0.12 : 0, 6, dt))
    }
  }

  /* ----------------------------------- test hooks ----------------------------------- */

  private installTestHooks() {
    ;(window as any).__vanta = {
      scene: this,
      step: (n = 1) => {
        for (let i = 0; i < n; i++) this.tick()
      },
      hold: (a: string, v = true) => {
        ;(this.ctl.virtual as any)[a] = v
      },
      tap: (a: string, frames = 2) => {
        ;(this.ctl.virtual as any)[a] = true
        for (let i = 0; i < frames; i++) this.tick()
        ;(this.ctl.virtual as any)[a] = false
        this.tick()
      },
      state: () => ({
        frame: this.frame,
        arena: this.arenaIdx,
        wave: this.wave,
        locked: this.locked,
        over: this.over,
        player: {
          x: Math.round(this.player.x),
          y: Math.round(this.player.y),
          hp: Math.round(this.player.hp),
          state: this.player.state,
          energy: this.player.energy,
        },
        enemies: this.enemies.map((e) => ({
          kind: e.kind,
          x: Math.round(e.x),
          y: Math.round(e.y),
          hp: Math.round(e.hp),
          lives: e.lives,
          state: e.state,
          dying: e.dying,
        })),
        combo: this.comboN,
        execs: this.execs,
        cine: !!this.cine,
        projs: this.projs.length,
      }),
    }
  }
}
