import * as Phaser from 'phaser'

import { Backdrop, BackdropSet, makePlatform } from '../art/stage'
import { ORIGIN } from '../art/textures'
import { Sfx } from '../audio/sfx'
import {
  ANCHOR_RANGE,
  BASE_ZOOM,
  CAM_REST_Y,
  COL,
  DEPTH,
  FORCE_TUTORIAL,
  GROUND_Y,
  LEAD_W,
  START_ARENA,
  START_LEVEL,
  STEP,
  TEST_MODE,
  UI_FONT,
  VIEW_H,
  VIEW_W,
  WORLD_W,
} from '../config'
import { Input, KEY_LABEL } from '../core/input'
import { kook } from '../core/kook'
import { Box, approach, clamp, damp, lerp, overlap, rand, randRange, reseed, segmentBox, smooth } from '../core/util'
import { Actor, Anchor, HitDef, Plat, Proj, Threat, World } from '../game/actor'
import { CamShot, CineHost, ExecCine } from '../game/cine'
import { CounterCine } from '../game/counter'
import { Enemy, spawnEnemy } from '../game/enemies'
import { Fx } from '../game/fx'
import { Menu, type MenuExtra } from '../game/menu'
import { MotionBlur } from '../game/motionBlur'
import { Player } from '../game/player'
import { Tutorial, TutorialHost } from '../game/tutorial'
import { Stage3D } from '../three/stage3d'

interface Arena {
  l: number
  r: number
  plats: Plat[]
  waves: [kind: string, at: number][][]
  boss?: boolean
}

/** The lockdowns as laid out from the end of the opening stretch. */
const ARENA_LAYOUT: Arena[] = [
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
      // high enough that a heavy chain thrown from the deck never ends up standing on one
      { x: 4250, y: 540, w: 420 },
      { x: 5130, y: 540, w: 420 },
      { x: 4690, y: 300, w: 420 },
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
      { x: 7400, y: 540, w: 480 },
      { x: 8120, y: 540, w: 480 },
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

/**
 * Stage 2, the outer yard. Skirmishers that lunge from range and spotters that call strikes down from behind them
 * make every wave a question of who to reach first; the frames from stage 1 come back as their anchor.
 */
const YARD_LAYOUT: Arena[] = [
  {
    l: 700,
    r: 3000,
    plats: [{ x: 1640, y: 540, w: 420 }],
    waves: [
      [
        ['lancer', 0.72],
        ['lancer', 0.9],
        ['grunt', 0.5],
      ],
      [
        ['mortar', 0.06],
        ['mortar', 0.94],
        ['lancer', 0.35],
        ['grunt', 0.65],
      ],
      [
        ['lancer', 0.12],
        ['lancer', 0.5],
        ['lancer', 0.88],
        ['mortar', 0.96],
      ],
    ],
  },
  {
    l: 3700,
    r: 6100,
    plats: [
      { x: 4240, y: 540, w: 440 },
      { x: 5120, y: 540, w: 440 },
    ],
    waves: [
      [
        ['drone', 0.3],
        ['drone', 0.7],
        ['mortar', 0.5],
        ['lancer', 0.15],
      ],
      [
        ['heavy', 0.8],
        ['lancer', 0.2],
        ['lancer', 0.6],
        ['mortar', 0.95],
      ],
      [
        ['titan', 0.75],
        ['mortar', 0.05],
        ['lancer', 0.4],
        ['drone', 0.5],
      ],
    ],
  },
  {
    l: 6800,
    r: 9200,
    plats: [
      { x: 7420, y: 540, w: 460 },
      { x: 8140, y: 540, w: 460 },
      { x: 7780, y: 300, w: 420 },
    ],
    waves: [
      [
        ['lancer', 0.1],
        ['lancer', 0.3],
        ['lancer', 0.7],
        ['lancer', 0.9],
        ['mortar', 0.03],
        ['mortar', 0.97],
      ],
      [
        ['heavy', 0.2],
        ['heavy', 0.8],
        ['mortar', 0.5],
        ['lancer', 0.92],
      ],
      [
        ['titan', 0.78],
        ['heavy', 0.2],
        ['lancer', 0.5],
        ['lancer', 0.9],
        ['mortar', 0.04],
      ],
    ],
  },
  { l: 9900, r: 12120, plats: [], waves: [[['arbiter', 0.74]]], boss: true },
]

/** A layout in world coordinates: the opening stretch with its signs comes first, and everything follows it. */
const placed = (layout: Arena[]): Arena[] =>
  layout.map((a) => ({
    ...a,
    l: a.l + LEAD_W,
    r: a.r + LEAD_W,
    plats: a.plats.map((p) => ({ ...p, x: p.x + LEAD_W })),
  }))

/** A stage: what the terminal calls it, which backdrop and music it has, and its lockdowns. */
export interface Level {
  name: string
  place: string
  /** a line about it for the terminal */
  brief: string
  backdrop: BackdropSet
  /** the texture the terminal shows for it */
  picture: string
  music: string
  /** the banner over its last lockdown */
  boss: string
  arenas: Arena[]
}
export const LEVELS: Level[] = [
  {
    name: '第一关',
    place: '废弃电厂',
    brief: '停摆的涡轮大厅。三道封锁，尽头是典狱者。',
    backdrop: 'plant',
    picture: 'bd_mid',
    music: 'bgm1',
    boss: '典狱者 · WARDEN',
    arenas: placed(ARENA_LAYOUT),
  },
  {
    name: '第二关',
    place: '外环货场',
    brief: '黄昏下的露天货场。突刺兵从远处冲锋，观测兵在后方呼叫落雷；尽头是裁决机。',
    backdrop: 'yard',
    picture: 'bd_far_yard',
    music: 'bgm2',
    boss: '裁决机 · ARBITER',
    arenas: placed(YARD_LAYOUT),
  },
]

/** While the hero charges in overload the rest of the world takes one step in this many ticks: a tenth of its speed. */
const WORLD_STEP = 10
/** how far the view leans in during the beat an extreme dodge is held for */
const CLOSE_UP = 1.13
/** how fast the ordinary charge's wall of light crosses the screen (screen units per second) */
const SURGE_SPEED = 1000
/** The verdict wave: fall speed (px/s), how long its edge drags on the floor, its height, and frames between bites. */
const VERDICT_SPEED = 6000,
  VERDICT_GRIND = 2,
  VERDICT_HEIGHT = 1080,
  VERDICT_BITE = 6,
  /** how far the blade sinks into the floor after dragging before it is gone */
  VERDICT_SINK = 320
/**
 * The blade that goes before it: purely for show. It falls straight through the floor without slowing, and the
 * light it trails stays standing for a moment. The real blade drops this many frames after it.
 */
/** The blade's speed smear: for each copy, how far behind it hangs, how bright it is and how much taller. */
const VERDICT_TRAIL: [lag: number, alpha: number, stretch: number][] = [
  [90, 0.5, 1.12],
  [210, 0.32, 1.3],
  [370, 0.2, 1.55],
  [580, 0.11, 1.9],
]
const HERALD_SPEED = 4200,
  HERALD_HEIGHT = 2600,
  HERALD_FADE = 0.7,
  HERALD_LEAD = 18
/**
 * The opening stretch is walked once per page load: that first time the hero starts at its far left and small
 * enemies are placed along it. After a defeat or a win she rejoins just outside the first lockdown, and the signs
 * are simply standing there.
 */
let tutorialOffered = false
/** how a sign is drawn: the height of its middle above the floor, and the sizes of its parts */
const SIGN = { rise: 470, cap: 78, gap: 16, name: 44, between: 84, pad: 46, height: 150 }

/** strength of the screen-space vignette in ordinary play */
const VIGNETTE = 0.42
const sfx = new Sfx()
const input = new Input()
export const shared = { sfx, input }

export class Battle extends Phaser.Scene implements World, CineHost, TutorialHost {
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
  motion!: MotionBlur
  /** 0..1: how far the view has swung overhead for the overload charge */
  topK = 0
  private topShade!: Phaser.GameObjects.Rectangle
  /** While the hero charges in overload everything else runs at a tenth of its speed: ticks since its last step. */
  private worldClock = 0
  /** The overload charge's wave: where its edge is, how long it has ground on the floor, and when it next bites. */
  private verdict: {
    y: number
    ground: number
    bite: number
    hit: HitDef
    im: Phaser.GameObjects.Image[]
    /** copies of the blade strung out behind it while it falls: the smear of its speed */
    trail: Phaser.GameObjects.Image[]
    /** frames before the real blade drops; until then only the herald is in the air */
    wait: number
    /** the decorative first blade: where its edge is, and how long it has been fading since it passed the floor */
    herald: { y: number; fade: number; im: Phaser.GameObjects.Image } | null
  } | null = null
  private vignette!: Phaser.Filters.Vignette
  private blurShot = { strength: 0, x: 0, y: 0 }
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
  /** the opening stretch: its signs, and the small enemies standing along it until the first lockdown */
  tutorial: Tutorial | null = null
  private signG!: Phaser.GameObjects.Graphics
  /** each sign's lettering, one group of key letters and one name per control */
  private signText: {
    keys: Phaser.GameObjects.Text[]
    plus: Phaser.GameObjects.Text[]
    name: Phaser.GameObjects.Text
  }[][] = []
  private startArena = 0
  /** which stage this is, and its lockdowns */
  level = START_LEVEL
  private arenas: Arena[] = LEVELS[0].arenas
  private allPlats: Plat[] = []
  /** the terminal, while it is open; the game stands still behind it */
  menu: Menu | null = null
  private restarting = false

  constructor() {
    super('Battle')
  }
  init(data: { arena?: number; level?: number }) {
    this.startArena = data?.arena ?? START_ARENA
    this.level = Math.trunc(clamp(data?.level ?? this.level, 0, LEVELS.length - 1))
    this.arenas = LEVELS[this.level].arenas
    this.allPlats = this.arenas.flatMap((a) => a.plats)
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
    this.menu = null
    this.boss = null
    this.locked = false
    this.wave = -1
    this.waveDelay = 0
    this.lastExec = -9999
    this.parryBoxes = []
    this.arenaIdx = Math.trunc(clamp(this.startArena, 0, this.arenas.length - 1))
    this.cleared = this.arenas.map((_, i) => i < this.arenaIdx)
    this.bounds = { l: 0, r: WORLD_W }

    this.backdrop = new Backdrop(this, WORLD_W, LEVELS[this.level].backdrop)
    Stage3D.I.reset()
    // every 3D body is drawn into this one camera-fixed layer
    this.layer3d = this.add
      .image(VIEW_W / 2, VIEW_H / 2, 'actors3d')
      .setScrollFactor(0)
      .setDepth(DEPTH.enemy + 5)
    for (const a of this.arenas) {
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
    this.anchor = null
    this.threat = null
    this.fx = new Fx(this)
    const a = this.arenas[this.arenaIdx]
    // The first visit of a page load walks the opening stretch from its left end; scripted runs only when asked.
    const lesson = !tutorialOffered && this.level === 0 && this.arenaIdx === 0 && (FORCE_TUTORIAL || !TEST_MODE)
    this.player = new Player(this, lesson ? 260 : a.l - 260)
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
    this.vignette = cam.filters.external.addVignette(0.5, 0.5, 0.92, VIGNETTE)
    this.motion = new MotionBlur(this)
    this.blurShot.strength = 0

    this.topK = this.worldClock = 0
    this.verdict = null
    // Everything flat goes under this shade when the view swings overhead; only the 3D layer is raised above it.
    this.topShade = this.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W + 1000, VIEW_H + 1000, 0x04060f)
      .setScrollFactor(0)
      .setDepth(DEPTH.fore + 30)
      .setAlpha(0)
    // The signs are scenery and always stand in the opening stretch; plain scripted runs do without them.
    if (lesson) tutorialOffered = true
    this.tutorial = lesson || !TEST_MODE || FORCE_TUTORIAL ? new Tutorial(this, lesson) : null
    this.buildSigns()

    if (!this.scene.isActive('Hud')) this.scene.launch('Hud')
    this.scene.bringToTop('Hud')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      cam.filters.internal.clear()
      cam.filters.external.clear()
      Stage3D.I.reset()
    })
    this.sfx.startMusic(LEVELS[this.level].music)
    // As a KOOK mini-game: hidden by the host, the fight is held and the music stops; closed by it, play ends.
    kook.onVisibility = (hidden) => {
      this.sfx.setAway(hidden)
      if (hidden && !this.paused && !this.over && !this.restarting) this.openMenu('stage')
    }
    kook.onClosed = () => {
      this.sfx.stopMusic()
      if (!this.paused && !this.over && !this.restarting) this.openMenu('stage')
    }
    kook.wantsFullscreen = (event) =>
      this.menu?.extra === 'fullscreen' && ['Enter', 'NumpadEnter', 'Space'].includes(event.code)
    kook.wantsSignIn = (event) =>
      this.menu?.extra === 'signin' && ['Enter', 'NumpadEnter', 'Space'].includes(event.code)
    if (TEST_MODE) this.installTestHooks()
    this.draw(1, 0)
  }

  /* ----------------------------------- loop ----------------------------------- */

  update(_t: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000
    // the music steps back while the game is paused, lost, or holding time still
    this.sfx.muffle(
      this.paused ? 1 : this.over === 'dead' ? 0.8 : this.player.overCharging ? 0.75 : this.cine ? 0.45 : 0
    )
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
      const fdt =
        dt *
        (this.cine ? this.cine.rate : this.slowT > 0 ? Math.max(0.4, this.slowScale) : 1) *
        (this.player.overCharging ? 0.3 : 1)
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
    this.runMenu(this.game.loop.rawDelta / 1000)
    this.ctl.clear()
  }

  /** Open the terminal; the game stands still until it is closed. */
  openMenu(tab: 'stage' | 'skills') {
    // fullscreen is offered where it can be had (the host's inside KOOK, the browser's on its own); leaving the
    // game is something only KOOK can do
    const extras: MenuExtra[] = ['skills', 'sound']
    if (kook.fullscreenOffered) extras.push('fullscreen')
    // in KOOK, while the player's authorisation is not held: a row to ask for it again
    if (kook.signInOffered) extras.push('signin')
    extras.push('credits')
    if (kook.can('lifecycle.leave')) extras.push('leave')
    this.menu = new Menu(tab, LEVELS.length, this.level, extras, tab === 'skills')
    this.paused = true
    this.ctl.clear()
    this.sfx.play('ui')
  }
  private runMenu(dt: number) {
    const menu = this.menu
    if (!menu) {
      // held still by something other than the terminal (scripted runs do this): Escape still lets go
      if (this.ctl.take('pause')) this.paused = false
      return
    }
    const action = menu.update(this.ctl, dt)
    if (!action) return
    this.sfx.play('ui')
    if (action.type === 'sound') this.sfx.setMuted(!this.sfx.muted)
    else if (action.type === 'credits')
      kook.openLink(new URL(import.meta.env.BASE_URL + 'credits.html', location.href).href)
    // a keyboard confirm has already gone fullscreen inside its own key event; this covers the gamepad
    else if (action.type === 'fullscreen') kook.fullscreen(false)
    else if (action.type === 'signin') kook.signIn(false)
    else if (action.type === 'leave') {
      // nothing of the game's own to save or close: hand the exit to KOOK, which closes the page
      this.sfx.stopMusic()
      void kook.leave()
    } else {
      this.menu = null
      this.paused = false
      if (action.type === 'level') {
        // a stage chosen from the terminal starts from its beginning
        this.restarting = true
        this.scene.restart({ level: action.index, arena: 0 })
      }
    }
  }

  /** One fixed logic step. */
  tick() {
    if (this.restarting) return
    this.ctl.poll(this.stop > 0)
    if (this.ctl.anyPressed) this.sfx.unlock()
    if (this.paused) {
      this.runMenu(STEP)
      this.ctl.clear()
      return
    }
    if (TEST_MODE) {
      const fdt = STEP * (this.cine ? this.cine.rate : 1) * (this.player.overCharging ? 0.3 : 1)
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
      this.openMenu('stage')
      return
    } else if (this.ctl.take('skills')) {
      this.openMenu('skills')
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
    // The overload charge slows everything but the hero to a tenth: the rest of the world steps on every tenth tick.
    if (this.player.overCharging) {
      this.worldClock = (this.worldClock + 1) % WORLD_STEP
      if (this.worldClock) return
    } else this.worldClock = 0
    for (const e of this.enemies) {
      if (!e.gone) e.update()
      if (this.cine) return
    }
    this.enemies = this.enemies.filter((e) => !e.gone)
    this.updateProjs()
    this.updateVerdict()
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
    // after a win the next stage begins (the last leads back to the first); after a defeat, this lockdown again
    this.scene.restart(
      this.over === 'win'
        ? { level: (this.level + 1) % LEVELS.length, arena: 0 }
        : { level: this.level, arena: this.arenaIdx }
    )
  }

  /* ----------------------------------- director ----------------------------------- */

  private direct() {
    const a = this.arenas[this.arenaIdx]
    if (!a || this.over) return
    // the opening stretch asks for nothing and holds nothing back
    this.tutorial?.update()
    if (!this.locked) {
      if (!this.cleared[this.arenaIdx] && this.player.x > a.l + 420) {
        this.leaveLesson()
        this.locked = true
        this.wave = -1
        this.waveDelay = 30
        this.bounds = { l: a.l, r: a.r }
        this.plats = a.plats
        this.banner = {
          text: a.boss ? LEVELS[this.level].boss : `封锁区 0${this.arenaIdx + 1}`,
          sub: '清除所有敌对单位',
          t: 130,
        }
        this.sfx.play('gate')
      } else {
        // free roam between arenas: every platform is solid
        this.plats = this.allPlats
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

  /** The first lockdown is closing: the run proper starts with a clean record. */
  private leaveLesson() {
    const lesson = this.tutorial
    if (!lesson?.active) return
    lesson.finish()
    this.player.damageTaken = 0
    this.kills = this.execs = this.maxCombo = 0
    this.clock = 0
    this.combo(0)
  }
  reinforce(kind: string, x: number) {
    this.enemies.push(spawnEnemy(this, kind, x))
  }
  spawnTraining(kind: string, x: number, passive: boolean, y?: number) {
    const e = spawnEnemy(this, kind, x, y)
    e.passive = passive
    this.enemies.push(e)
    return e
  }
  dismiss(e: Enemy) {
    this.releaseToken(e)
    this.fx.pillar(e.x, e.y, COL.main, 520, 0.3, 0.8)
    this.fx.ring(e.x, e.cy, COL.main, 30, 180, 0.3)
    e.destroy()
  }

  get waveInfo() {
    const a = this.arenas[this.arenaIdx]
    return this.locked && a && !a.boss ? `${Math.max(1, this.wave + 1)} / ${a.waves.length}` : ''
  }
  get goHint() {
    return !this.locked && !this.over && this.arenaIdx < this.arenas.length && !this.cleared[this.arenaIdx]
  }

  /* ----------------------------------- combat services ----------------------------------- */

  hitstop(n: number) {
    this.stop = Math.max(this.stop, n)
  }
  shake(amp: number, zoomPunch = 0, always = false) {
    // Ordinary attacks, damage and landings leave the camera steady outside cinematics; only what asks for it
    // by name (the overload charge's blade) shakes the view in open play.
    if (!this.cine && !always) return
    this.shakeAmp = Math.max(this.shakeAmp, amp)
    this.punch = Math.max(this.punch, zoomPunch)
  }
  blur(strength: number, x: number, y: number) {
    this.blurShot.strength = strength
    this.blurShot.x = x
    this.blurShot.y = y
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
        if (!e.takeHit(hit, src, dir)) continue
        hitSet.add(e)
        n++
        this.hitFx(e, box, hit, dir)
        // The marked heavy stages open a lesser execution bloom on what they hit: on two bodies at most, the
        // second smaller, and only the first of them washes the screen.
        if (hit.bloom && n <= 2) {
          const first = n === 1
          this.fx.bloomBurst(e.coreX, e.coreY, hit.bloom * (first ? 1 : 0.7), this.player.overloaded, first ? 0.5 : 0)
        }
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
        // the frame only freezes on contact for the hits marked to do so (the second heavy stage)
        if (hit.pause) this.hitstop(hit.stop)
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

  private hitFx(e: Actor, box: Box, hit: HitDef, dir: number) {
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

  /** The lettering of every sign. The panels themselves are drawn each frame. */
  private buildSigns() {
    this.signG = this.add.graphics().setDepth(DEPTH.props + 6)
    const text = (size: number, color: string, glow: string) =>
      this.add
        .text(0, 0, '', { fontFamily: UI_FONT, fontSize: `${size}px`, color, fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH.props + 6.1)
        .setVisible(false)
        // lettering made of light: a soft halo in the sign's colour
        .setShadow(0, 0, glow, 16, false, true)
    this.signText = (this.tutorial?.signs ?? []).map((sign) =>
      sign.entries.map((entry) => ({
        keys: entry.keys.map(() => text(46, '#ffffff', sign.hot ? '#ff5fd0' : '#3fb8ff')),
        plus: entry.keys
          .slice(1)
          .map(() => text(40, sign.hot ? '#ffb3ec' : '#9fdcff', sign.hot ? '#ff5fd0' : '#3fb8ff').setText('+')),
        name: text(SIGN.name, sign.hot ? '#ffe3f8' : '#eaf8ff', sign.hot ? '#ff5fd0' : '#3fb8ff').setLetterSpacing(6),
      }))
    )
  }
  /**
   * The signs of the opening stretch: holograms thrown up from the floor, each unfolding as the hero comes to it.
   * A line of light opens sideways, the panel opens out of the line, and the controls come up one after another.
   */
  private drawSigns(time: number) {
    const g = this.signG,
      pad = this.ctl.padConnected ? 1 : 0
    g.clear()
    this.tutorial?.signs.forEach((sign, si) => {
      const texts = this.signText[si],
        seen = sign.open > 0 && Math.abs(sign.x - this.cam.x) < VIEW_W / this.cam.zoom
      for (const t of texts) for (const o of [...t.keys, ...t.plus, t.name]) o.setVisible(seen)
      if (!seen) return
      const color = sign.hot ? COL.pink : COL.cyan,
        // three overlapping beats: the line, the panel, the lettering
        line = smooth(clamp(sign.open / 0.4, 0, 1)),
        panel = smooth(clamp((sign.open - 0.25) / 0.45, 0, 1)),
        flicker = 0.9 + 0.1 * Math.sin(time * 7 + sign.x)
      // lay the controls out to find the panel's width
      const widths = sign.entries.map((entry, ei) => {
        const t = texts[ei]
        entry.keys.forEach((key, ki) => t.keys[ki].setText(KEY_LABEL[key]?.[pad] ?? key))
        t.name.setText(entry.name)
        const caps = t.keys.map((k) => Math.max(SIGN.cap, k.width + 34))
        return {
          caps,
          total: caps.reduce((a, c) => a + c, 0) + (caps.length - 1) * 44 + SIGN.gap + t.name.width,
        }
      })
      const inner = widths.reduce((a, w) => a + w.total, 0) + (widths.length - 1) * SIGN.between,
        width = inner + SIGN.pad * 2,
        cy = GROUND_Y - SIGN.rise,
        w = width * line,
        h = Math.max(3, SIGN.height * panel)
      // the projector: a point on the floor and the fan of light up to the panel
      g.fillStyle(color, 0.05 * line * flicker).fillTriangle(
        sign.x,
        GROUND_Y,
        sign.x - w / 2,
        cy + h / 2,
        sign.x + w / 2,
        cy + h / 2
      )
      g.lineStyle(2, color, 0.22 * line)
        .lineBetween(sign.x, GROUND_Y, sign.x - w / 2, cy + h / 2)
        .lineBetween(sign.x, GROUND_Y, sign.x + w / 2, cy + h / 2)
      g.fillStyle(color, 0.8 * line).fillEllipse(sign.x, GROUND_Y - 2, 46, 8)
      // the panel
      g.fillStyle(0x061a2c, 0.5 * panel).fillRoundedRect(sign.x - w / 2, cy - h / 2, w, h, Math.min(14, h / 2))
      g.lineStyle(3, color, 0.85 * line * flicker).strokeRoundedRect(
        sign.x - w / 2,
        cy - h / 2,
        w,
        h,
        Math.min(14, h / 2)
      )
      g.fillStyle(color, 0.9 * line)
        .fillRect(sign.x - w / 2 - 10, cy - 3, 20, 6)
        .fillRect(sign.x + w / 2 - 10, cy - 3, 20, 6)
      // a slow scan line while it stands
      if (panel >= 1) {
        const scan = ((time * 0.35 + si * 0.37) % 1) * SIGN.height
        g.fillStyle(color, 0.1).fillRect(sign.x - w / 2 + 6, cy - h / 2 + scan, w - 12, 3)
      }
      let x = sign.x - inner / 2
      sign.entries.forEach((_, ei) => {
        const t = texts[ei],
          // each control a beat after the one before it
          k = smooth(clamp((sign.open - 0.56 - ei * 0.1) / 0.22, 0, 1)),
          y = cy + (1 - k) * 14
        widths[ei].caps.forEach((cap, ki) => {
          if (ki) {
            t.plus[ki - 1].setPosition(x + 22, y).setAlpha(k * flicker)
            x += 44
          }
          g.fillStyle(0x0d2f4a, 0.9 * k).fillRoundedRect(x, y - SIGN.cap / 2, cap, SIGN.cap, 12)
          g.lineStyle(3, color, k).strokeRoundedRect(x, y - SIGN.cap / 2, cap, SIGN.cap, 12)
          g.fillStyle(0xffffff, 0.12 * k).fillRoundedRect(x + 5, y - SIGN.cap / 2 + 5, cap - 10, SIGN.cap * 0.36, 8)
          t.keys[ki].setPosition(x + cap / 2, y).setAlpha(k)
          x += cap
        })
        x += SIGN.gap
        t.name.setPosition(x + t.name.width / 2, y).setAlpha(k * flicker)
        x += t.name.width + SIGN.between
      })
    })
  }

  get verdictActive() {
    return !!this.verdict
  }
  /**
   * The overload charge is cut twice. The first blade is a herald: it harms nothing and stops for nothing, only
   * leaving a tall path of light behind it. The second, a deep arc, follows down that path and is the one that bites.
   */
  spawnVerdict(hit: HitDef) {
    this.dropVerdict()
    const top = this.cam.y - VIEW_H / 2 / this.cam.zoom,
      layer = (key: string, depth: number, oy: number) =>
        this.add
          .image(0, 0, key)
          // the texture's blade edge at its lowest, so `y` is where the edge is
          .setOrigin(0.5, oy)
          .setDepth(DEPTH.frontFx + depth)
          .setBlendMode(Phaser.BlendModes.ADD)
    this.verdict = {
      y: top - 160,
      ground: 0,
      bite: 0,
      hit,
      im: [0, 1].map((i) => layer('verdict', 3 + i * 0.01, 0.92).setVisible(false)),
      trail: VERDICT_TRAIL.map((_, i) => layer('verdict', 2.95 - i * 0.01, 0.92).setVisible(false)),
      wait: HERALD_LEAD,
      herald: { y: top - 60, fade: 0, im: layer('verdict_herald', 2.9, 0.94) },
    }
    this.syncVerdict()
  }
  private dropVerdict() {
    const v = this.verdict
    if (!v) return
    for (const im of [...v.im, ...v.trail]) im.destroy()
    v.herald?.im.destroy()
    this.verdict = null
  }
  /** The wave spans the view whatever the camera does. */
  private syncVerdict() {
    const v = this.verdict
    if (!v) return
    // On the floor the edge is shown pressed against it, the curtain above being driven down, for as long as it
    // drags; only then does it sink out of sight.
    const width = VIEW_W / this.cam.zoom + 300,
      h = v.herald
    if (h)
      h.im
        .setPosition(this.cam.x, h.y)
        .setScale(width / 512, HERALD_HEIGHT / 512)
        .setAlpha(0.9 * (1 - h.fade / HERALD_FADE))
    for (const im of [...v.im, ...v.trail]) im.setVisible(v.wait <= 0)
    if (v.wait > 0) return
    const press = clamp(v.ground / VERDICT_GRIND, 0, 1),
      sunk = Math.max(0, v.y - GROUND_Y - VERDICT_SPEED * 0.1 * VERDICT_GRIND),
      y = v.y < GROUND_Y ? v.y : GROUND_Y + 12 * press + (press < 1 ? 0 : sunk),
      height = VERDICT_HEIGHT * (1 - 0.45 * press),
      flicker = v.y < GROUND_Y ? 1 : 0.86 + 0.14 * Math.sin(this.frame * 1.3)
    v.im[0]
      .setPosition(this.cam.x, y + 14)
      .setScale((width * 1.04) / 512, (height * 1.08) / 512)
      .setAlpha(0.55 * flicker)
    v.im[1]
      .setPosition(this.cam.x, y)
      .setScale(width / 512, height / 512)
      .setAlpha(flicker)
    // The smear: fainter, taller copies strung out above the blade for as long as it is falling. Once it is on
    // the floor they close up into it and are gone.
    const falling = 1 - clamp(press * 5, 0, 1)
    VERDICT_TRAIL.forEach(([lag, alpha, stretch], i) =>
      v.trail[i]
        .setPosition(this.cam.x, y - lag * falling)
        .setScale(width / 512, (height * (1 + (stretch - 1) * falling)) / 512)
        .setAlpha(alpha * falling)
    )
  }
  /**
   * The wave falls fast, drags at a tenth of that speed for two seconds once its edge meets the floor, then
   * drives on through. For as long as it exists it bites every enemy in view ten times a second.
   */
  private updateVerdict() {
    const v = this.verdict
    if (!v) return
    const h = v.herald
    if (h) {
      h.y += HERALD_SPEED * STEP
      if (h.y > GROUND_Y) h.fade += STEP
      if (h.fade >= HERALD_FADE) {
        h.im.destroy()
        v.herald = null
      }
    }
    if (v.wait > 0) {
      if (--v.wait > 0) return
      // the second cut: the one that counts
      this.fx.screenFlash(0xffd0f0, 0.16, 0.12)
      this.fx.cut(this.cam.x, v.y + 200, 0, VIEW_W / this.cam.zoom + 400, COL.pinkDeep, 0.2, 1.6)
    }
    const fx = this.fx,
      grinding = v.y >= GROUND_Y && v.ground < VERDICT_GRIND,
      half = VIEW_W / 2 / this.cam.zoom + 60
    if (v.y < GROUND_Y) {
      // falling: streaks of light torn off along its path
      for (let i = 0; i < 3; i++)
        fx.cut(
          this.cam.x + randRange(-half, half),
          v.y - randRange(160, 520),
          Math.PI / 2,
          randRange(420, 900),
          i ? COL.pinkDeep : 0xffffff,
          0.16,
          0.7
        )
    }
    if (grinding && v.ground === 0) {
      // the edge meets the floor: the view jolts, the picture ripples, and the whole line throws welding sparks
      this.sfx.play('slam')
      this.shake(64, 0.06, true)
      fx.ripple(this.cam.x, GROUND_Y, 2400, 0.9, 0.9, 0, false)
      fx.screenFlash(0xffe0f6, 0.12, 0.12)
      for (let i = 0; i < 12; i++) {
        const x = this.cam.x - half + ((i + rand()) / 12) * half * 2
        fx.weld(x, GROUND_Y, -Math.PI / 2, 16, 1.9, GROUND_Y, 1.3)
        if (i % 2) fx.glint(x, GROUND_Y - 8, i % 3 ? 0xcfe6ff : 0xffffff, 0.34, 0.12)
      }
    }
    if (grinding) v.ground += STEP
    v.y += VERDICT_SPEED * (grinding ? 0.1 : 1) * STEP
    if (grinding) {
      // Dragging: the edge welds its way along the floor. Sparks shower from somewhere new every frame, with
      // the hard blue-white flicker of an arc, and the view keeps trembling under it.
      const x = this.cam.x + randRange(-half, half)
      fx.weld(x, GROUND_Y, -Math.PI / 2 + randRange(-0.5, 0.5), 9, 1.5, GROUND_Y, 1.3)
      if (this.frame % 2 === 0)
        fx.glint(this.cam.x + randRange(-half, half), GROUND_Y - 6, rand() < 0.5 ? 0xcfe6ff : 0xffffff, 0.55, 0.07)
      if (this.frame % 6 === 0) fx.cut(this.cam.x, GROUND_Y - 4, 0, half * 2.2, COL.pinkDeep, 0.16, 0.9)
      this.shake(15, 0, true)
    }
    if (++v.bite >= VERDICT_BITE) {
      v.bite = 0
      const dir = this.player.facing
      for (const e of this.enemies) {
        if (e.dead || e.gone || e.state === 'spawn' || e.state === 'reviving' || Math.abs(e.x - this.cam.x) > half)
          continue
        if (!e.takeHit(v.hit, this.player, dir)) continue
        // ten bites a second: a full hit flash on each would leave every body white
        e.flashT = Math.min(e.flashT, 2)
        fx.cut(e.cx, e.cy, Math.PI / 2 + randRange(-0.2, 0.2), 260 + e.h * 0.6, COL.pinkDeep, 0.14, 0.7)
        fx.weld(e.cx, e.cy, -Math.PI / 2, 8, 1, GROUND_Y)
        this.combo(1)
      }
      for (const q of this.projs) if (q.team === 1 && !q.dead && Math.abs(q.x - this.cam.x) < half) this.parryProj(q)
      this.sfx.play('hit')
    }
    if (v.ground >= VERDICT_GRIND && v.y - GROUND_Y - VERDICT_SPEED * 0.1 * VERDICT_GRIND > VERDICT_SINK)
      this.dropVerdict()
  }

  spawnSurge(hit: HitDef) {
    return this.spawnProj({
      kind: 'surge',
      x: 0,
      y: 0,
      screenX: -160,
      vx: SURGE_SPEED,
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
          const hit = p.hit
          if (e.takeHit(hit, pl, dir)) {
            p.hitSet.add(e)
            this.hitFx(e, box, hit, dir)
            this.combo(1)
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
    this.hitFx(target, target.box, hit, dir)
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
   * The anchor a dodge would jump to. Only enemies are anchors, and only under overload: the nearest unused one
   * within two thirds of a screen. While a direction is held only those on that side count, so a line of them can
   * be ridden forward instead of bouncing back to the one just left.
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
    // while the world is slowed its bodies cross one logic step over ten ticks
    const worldAlpha = p.overCharging ? (this.worldClock + alpha) / WORLD_STEP : alpha
    for (const e of this.enemies) if (!e.gone) e.render(worldAlpha, time)
    // camera: look ahead in the direction of travel (more at speed), ease everything in real time
    if (!this.cine) {
      const half = VIEW_W / 2 / BASE_ZOOM
      const lo = (this.locked ? this.bounds.l : 0) + half,
        hi = (this.locked ? this.bounds.r : WORLD_W) - half
      this.lead = damp(this.lead, p.facing * 90 + clamp(p.vx * 0.26, -300, 300), 5, dt)
      // The beat an extreme dodge is held for gets a close-up, and a quiet one: the view only leans in on her a
      // little and settles toward where she stands. The counter's own shot follows from there.
      const close = p.dodgeBeat
      const tx = clamp(lerp(p.px, p.x, alpha) + (close ? this.lead * 0.25 : this.lead), lo, Math.max(lo, hi))
      const ty = CAM_REST_Y + clamp((p.y - 640) * 0.55, -300, 0) + (close ? 26 : 0)
      const zoom = close ? BASE_ZOOM * CLOSE_UP : BASE_ZOOM
      this.cam.x = damp(this.cam.x, tx, 9, dt)
      this.cam.y = damp(this.cam.y, ty, 7, dt)
      this.cam.zoom = damp(this.cam.zoom, zoom, close ? 6 : 8, dt)
      this.cam.rot = 0
      if (!close && Math.abs(this.cam.zoom - BASE_ZOOM) < 0.002) this.cam.zoom = BASE_ZOOM
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
    // The overload charge swings the view overhead: the flat world goes dark under a shade and the 3D layer,
    // raised above it, shows the same fight from above with every enemy cross-marked on a floor of light.
    // The swing follows the wall clock, like the leap it accompanies: 0.3 s up, 0.18 s back, at any frame rate.
    const real = TEST_MODE ? 1 : this.game.loop.rawDelta / 1000,
      overhead = p.overCharging ? 1 : 0
    this.topK = approach(this.topK, overhead, real / (overhead ? 0.3 : 0.18))
    this.topShade.setAlpha(0.94 * this.topK)
    this.layer3d.setDepth(this.topK > 0 ? DEPTH.fore + 31 : DEPTH.enemy + 5)
    Stage3D.I.setTop(
      this.topK,
      clamp(p.x, this.bounds.l + 600, Math.max(this.bounds.l + 600, this.bounds.r - 600)),
      GROUND_Y,
      Math.max(this.bounds.l, p.x - 1500),
      Math.min(this.bounds.r, p.x + 1500),
      this.topK > 0
        ? [
            { x: p.x, hero: true },
            ...this.enemies.filter((e) => !e.dead && !e.gone && e.state !== 'spawn').map((e) => ({ x: e.x })),
          ]
        : []
    )
    this.syncVerdict()
    this.drawSigns(time)
    // An overexposed frame washes out its own dark corners, so the bloom stays bright out to the edges.
    this.vignette.strength = VIGNETTE * (1 - 0.55 * this.fx.glare)
    // The blur is centred with the view that is about to be drawn, so it stays locked on while the camera glides.
    const shot = this.blurShot
    this.motion.set(
      this.cine ? shot.strength : 0,
      ((shot.x - this.cam.x) * cam.zoom + VIEW_W / 2) / VIEW_W,
      ((shot.y - this.cam.y) * cam.zoom + VIEW_H / 2) / VIEW_H
    )
    for (const q of this.projs) if (q.screenX !== undefined && !q.dead) this.syncSurge(q)
    this.backdrop.update(cam, time)
    this.backdrop.dim.setAlpha(this.cineAmt * 0.78)
    // draw the bodies with the same view Phaser is about to use, then hand the canvas over as a texture
    const z = cam.zoom
    Stage3D.I.render(cam.scrollX + VIEW_W / 2, cam.scrollY + VIEW_H / 2, z)
    this.textures.get('actors3d').source[0].update()
    this.layer3d.setScale(1 / z)
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
