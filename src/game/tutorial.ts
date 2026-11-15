import type { Enemy } from './enemies'
import type { Player } from './player'

/** One control on a sign: the input actions pressed together, and what the game calls the skill. */
export interface SignEntry {
  keys: string[]
  name: string
}
/** A sign standing in the opening stretch. `open` runs from 0 (not yet shown) to 1 (fully unfolded). */
export interface Sign {
  x: number
  entries: SignEntry[]
  /** the overload's sign is lit in its colour */
  hot: boolean
  open: number
}

export interface TutorialHost {
  player: Player
  /** Put a training enemy into the opening stretch. Passive ones only stand and watch. */
  spawnTraining(kind: string, x: number, passive: boolean, y?: number): Enemy
  /** Take a training enemy out without counting it as a kill. */
  dismiss(e: Enemy): void
}

interface Section {
  x: number
  entries: SignEntry[]
  hot?: boolean
  /** small enemies standing past the sign to try the controls on: their kinds, where the first stands, the spacing */
  mobs?: { kinds: string[]; from: number; gap: number }
  /** the hero is handed a full energy bar on reaching this sign */
  energy?: boolean
}

const mobs = (pattern: string, from: number, gap: number) => ({
  kinds: [...pattern].map((c) => (c === 'g' ? 'grunt' : 'gunner')),
  from,
  gap,
})

/**
 * The opening stretch, left to right. These names are the skills' names everywhere the game speaks of them.
 * Nothing here has to be done: the signs are scenery, and whoever knows the controls can simply run past.
 */
const SECTIONS: Section[] = [
  {
    x: 640,
    entries: [
      { keys: ['light'], name: '轻击' },
      { keys: ['heavy'], name: '重击' },
      { keys: ['exec'], name: '处决' },
    ],
    mobs: mobs('gg', 1080, 260),
  },
  // nothing stands here: the dodge is tried on open floor, and its perfect timing is left to be found
  { x: 1780, entries: [{ keys: ['dash'], name: '闪避' }] },
  { x: 2500, entries: [{ keys: ['light', 'heavy'], name: '光幕' }], mobs: mobs('ggugguggug', 2860, 92), energy: true },
  { x: 3960, entries: [{ keys: ['overload'], name: '超载' }], hot: true, mobs: mobs('ggugg', 4230, 125) },
  // the last sign points at the terminal's skills page, where every skill is shown
  { x: 5080, entries: [{ keys: ['skills'], name: '技能详情' }] },
]

/** how far ahead of the hero a sign starts to unfold, and how many logic frames the unfolding takes */
const REVEAL = 820,
  UNFOLD = 40

/**
 * The opening lesson is not a lesson any more but a stretch of scenery ahead of the first lockdown: a sign for
 * each control, unfolding one after another as the hero walks right, some with a few passive small enemies
 * standing beyond them to try the control on. There are no tasks, no gates and nothing to skip.
 *
 * With `lesson` false the signs simply stand there, already open, and no enemies are placed: that is the stretch
 * as it is found again after a restart.
 */
export class Tutorial {
  readonly signs: Sign[]
  /** still placing enemies; ends when the first lockdown begins */
  active: boolean
  private placed: boolean[]
  private targets: Enemy[] = []

  constructor(
    private w: TutorialHost,
    lesson: boolean
  ) {
    this.active = lesson
    this.signs = SECTIONS.map((s) => ({ x: s.x, entries: s.entries, hot: !!s.hot, open: lesson ? 0 : 1 }))
    this.placed = SECTIONS.map(() => !lesson)
  }

  /** Enemies placed by the stretch that are still standing. */
  get standing() {
    return this.targets.filter((e) => !e.gone && !e.dead).length
  }

  /** Once per logic step. */
  update() {
    const p = this.w.player
    SECTIONS.forEach((section, i) => {
      const sign = this.signs[i]
      if (!this.placed[i] && p.x > section.x - REVEAL) {
        this.placed[i] = true
        if (section.energy && this.active) p.gainEnergy(p.maxEnergy)
        const m = section.mobs
        if (m && this.active)
          m.kinds.forEach((kind, k) => this.targets.push(this.w.spawnTraining(kind, m.from + m.gap * k, true)))
      }
      if (this.placed[i] && sign.open < 1) sign.open = Math.min(1, sign.open + 1 / UNFOLD)
    })
  }

  /** The first lockdown is starting: whatever was left standing is taken away, and nothing more is placed. */
  finish() {
    if (!this.active) return
    this.active = false
    for (const e of this.targets) if (!e.gone && !e.dead) this.w.dismiss(e)
    this.targets = []
  }
}
