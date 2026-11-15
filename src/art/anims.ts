/**
 * Animation table. Every entry points into the ready-made animation library (see three/stage3d.ts);
 * Elle's clips add authored poses during offline baking. Game logic counts in 60 Hz frames, so attack entries carry a
 * frame -> clip-time map that lands the library clip's swing peak on the move's hit frame.
 */
export interface Anim {
  clip: string
  loop?: boolean
  rate?: number
  keys?: [frame: number, time: number][]
  /** After its last key, a keyed entry drifts back and forth between these two frames instead of freezing. */
  sway?: [from: number, to: number]
}
export interface PoseRef {
  clip: string
  time: number
  prev: string | null
  prevTime: number
  w: number
}

const loop = (clip: string, speed = 1): Anim => ({ clip, loop: true, rate: speed / 60 })
const hold = (clip: string, t: number): Anim => ({ clip, keys: [[0, t]] })
const seg = (clip: string, t0: number, t1: number, frames: number): Anim => ({
  clip,
  keys: [
    [0, t0],
    [frames, t1],
  ],
})
const map = (clip: string, keys: [number, number][]): Anim => ({ clip, keys })
const swaying = (a: Anim, from: number, to: number): Anim => ({ ...a, sway: [from, to] })

/** clip durations, needed to wrap looping clips */
const DUR: Record<string, number> = {
  Sword_Idle: 1.67,
  Sprint_Loop: 0.67,
  NinjaJump_Idle_Loop: 2,
  Walk_Loop: 1.33,
  Jog_Fwd_Loop: 0.93,
  Pistol_Idle_Loop: 1.67,
  Zombie_Idle_Loop: 1.33,
  Idle_Loop: 2.5,
  Walk_Formal_Loop: 1.33,
  Zombie_Walk_Fwd_Loop: 1.33,
}

export function timeAt(a: Anim, f: number): number {
  if (a.keys) {
    const k = a.keys
    if (a.sway && f > a.sway[1]) {
      const [from, to] = a.sway,
        span = to - from,
        phase = (f - from) % (span * 2)
      f = from + (phase <= span ? phase : span * 2 - phase)
    }
    if (f <= k[0][0]) return k[0][1]
    for (let i = 1; i < k.length; i++)
      if (f <= k[i][0]) {
        const t = (f - k[i - 1][0]) / (k[i][0] - k[i - 1][0])
        return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * t
      }
    return k[k.length - 1][1]
  }
  const d = DUR[a.clip] ?? 1,
    t = f * (a.rate ?? 1 / 60)
  return ((t % d) + d) % d
}

/** Plays table entries with a short cross-blend whenever the entry changes. */
export class Animator {
  anim: Anim = A.idle
  t = 0
  pose: PoseRef = { clip: A.idle.clip, time: 0, prev: null, prevTime: 0, w: 1 }
  private blend = 0
  private blendLen = 0
  play(a: Anim, blend = 5, restart = false) {
    if (a === this.anim && !restart) return
    const p = this.pose
    // A blend that has barely begun is not a pose to leave from: keep blending out of the one it started with,
    // or a long settle interrupted early would snap to its far end first.
    if (!(p.prev !== null && p.w < 0.5)) {
      p.prev = p.clip
      p.prevTime = p.time
    }
    this.anim = a
    this.t = 0
    this.blend = 0
    this.blendLen = Math.max(1, blend)
  }
  /** Advance by dt frames (or jump to an absolute frame) and return what to show. */
  update(dt = 1, at?: number): PoseRef {
    this.t = at ?? this.t + dt
    const p = this.pose
    p.clip = this.anim.clip
    p.time = timeAt(this.anim, this.t)
    if (p.prev !== null) {
      this.blend += Math.abs(dt) || 1
      const k = Math.min(1, this.blend / this.blendLen)
      // long blends ease in and out; short ones stay crisp
      p.w = this.blendLen > 8 ? k * k * (3 - 2 * k) : k
      if (p.w >= 1 || p.prev === p.clip) p.prev = null
    } else p.w = 1
    return p
  }
}

export const A = {
  // locomotion
  // (the run clip's rate is further scaled by ground speed in the player, so the stride matches the travel)
  idle: loop('Sword_Idle'),
  run: loop('Sprint_Loop', 1.6),
  jump: loop('NinjaJump_Idle_Loop'),
  fall: hold('NinjaJump_Idle_Loop', 0.65),
  // light chain
  l1: map('Sword_Regular_A', [
    [0, 0.04],
    [3, 0.07],
    [6, 0.23],
    [9, 0.27],
    [16, 0.43],
  ]),
  l2: map('Sword_Regular_B', [
    [0, 0.05],
    [2, 0.08],
    [5, 0.25],
    [8, 0.3],
    [17, 0.53],
  ]),
  l3: map('Sword_Dash', [
    [0, 0.1],
    [4, 0.14],
    [7, 0.32],
    [10, 0.42],
    [26, 1.0],
  ]),
  l4: map('Sword_Heavy_Combo', [
    [0, 0.15],
    [5, 0.38],
    [11, 1.15],
    [28, 1.5],
  ]),
  l5: map('Sword_Regular_C', [
    [0, 0.25],
    [13, 0.63],
    [38, 1.5],
  ]),
  // heavy chain and derived moves
  // heavy chain: a straight rising cleave, a turning reverse-grip cut, a vanishing flurry, then the falling wheel
  h1: map('Sword_Heavy_Combo', [
    [0, 1.78],
    [11, 1.85],
    [15, 1.98],
    [19, 2.12],
    [38, 2.2],
    // the recovery: the follow-through settles instead of freezing
    [48, 2.24],
  ]),
  h2: map('Sword_Heavy_Combo', [
    [0, 0.62],
    [5, 0.92],
    [9, 1.1],
    [13, 1.28],
    [32, 1.36],
    [42, 1.4],
  ]),
  h3: hold('Sword_Regular_A', 0.28),
  gear: hold('Sword_Attack', 0.42),
  // the landing holds low for a long beat before she straightens
  gearLand: map('Sword_Attack', [
    [0, 0.5],
    [6, 0.72],
    [24, 0.9],
    [44, 1.25],
  ]),
  // the dodge: one held lunge, drawn as a ghost
  dashLunge: hold('Sword_Dash', 0.5),
  launcher: map('Sword_Attack', [
    [0, 0.05],
    [9, 0.28],
    [30, 0.6],
  ]),
  whirl: map('Sword_Heavy_Combo', [
    [0, 0.15],
    [5, 0.38],
    [13, 1.15],
    [21, 1.8],
    [42, 2.25],
  ]),
  al1: map('Sword_Regular_A', [
    [0, 0.04],
    [6, 0.23],
    [20, 0.43],
  ]),
  al2: map('Sword_Regular_B', [
    [0, 0.05],
    [6, 0.25],
    [20, 0.53],
  ]),
  al3: map('Sword_Regular_C', [
    [0, 0.3],
    [10, 0.63],
    [24, 1.1],
  ]),
  dive: map('Sword_Attack', [
    [0, 0.45],
    [9, 0.7],
    [11, 0.8],
  ]),
  diveLand: map('Sword_Attack', [
    [0, 0.85],
    [22, 1.45],
  ]),
  // reactions
  hurt: seg('Hit_Chest', 0, 0.33, 18),
  launched: hold('Hit_Knockback', 0.3),
  down: hold('Hit_Knockback', 0.82),
  getup: seg('LayToIdle', 0.2, 1.5, 22),
  die: seg('Death01', 0, 2.3, 80),
  stun: loop('Zombie_Idle_Loop'),
  // dying: regular frames reel before they sway on their feet; large frames sink to one knee and stay down
  reel: seg('Idle_Shield_Break', 0.1, 1.0, 32),
  kneel: swaying(
    map('Fixing_Kneeling', [
      [0, 0.2],
      [26, 0.85],
      [206, 3.85],
    ]),
    26,
    206
  ),
  // execution beats (held frames of library clips)
  exDraw: hold('Sword_Idle', 0),
  exSeed: seg('Spell_Simple_Enter', 0, 0.6, 10),
  exCrush: seg('Spell_Simple_Shoot', 0, 0.6, 8),
  exCutA: hold('Sword_Regular_A', 0.28),
  exCutB: hold('Sword_Regular_B', 0.3),
  exThrust: hold('Sword_Dash', 0.4),
  exRise: hold('Sword_Regular_C', 0.72),
  exSlam: hold('Sword_Attack', 0.95),
  exEnd: hold('Sword_Regular_A_Rec', 0.12),
  exRecover: seg('Sword_Regular_A_Rec', 0.12, 0.5, 24),
  charge: hold('Sword_Regular_C', 0.3),
  chargeRelease: seg('Sword_Regular_C', 0.52, 1.1, 24),
  passCut: map('Sword_Regular_C', [
    [0, 0.52],
    [3, 0.74],
    [12, 1.1],
  ]),
  leapUp: hold('Sword_Attack', 0.6),
  leapDown: hold('Sword_Attack', 0.8),
  // enemies
  eIdle: loop('Sword_Idle'),
  eWalk: loop('Walk_Loop'),
  eRun: loop('Jog_Fwd_Loop'),
  gIdle: loop('Pistol_Idle_Loop'),
  aim: hold('Pistol_Aim_Neutral', 0.1),
  shoot: seg('Pistol_Shoot', 0, 0.4, 8),
  windOver: seg('Sword_Regular_C', 0, 0.42, 24),
  strikeOver: map('Sword_Regular_C', [
    [0, 0.42],
    [5, 0.63],
    [28, 1.4],
  ]),
  windThrust: seg('Sword_Dash', 0, 0.16, 38),
  strikeThrust: map('Sword_Dash', [
    [0, 0.16],
    [3, 0.32],
    [32, 1.1],
  ]),
  windSlam: seg('Sword_Attack', 0.3, 0.66, 54),
  strikeSlam: map('Sword_Attack', [
    [0, 0.66],
    [7, 0.86],
    [48, 1.5],
  ]),
  windSweep: seg('Sword_Heavy_Combo', 1.3, 1.62, 42),
  strikeSweep: map('Sword_Heavy_Combo', [
    [0, 1.62],
    [5, 1.8],
    [34, 2.25],
  ]),
  windRise: seg('Sword_Regular_B', 0, 0.1, 9),
  strikeRise: map('Sword_Regular_B', [
    [0, 0.1],
    [5, 0.25],
    [20, 0.53],
  ]),
  cast: seg('Spell_Simple_Shoot', 0, 0.3, 26),
} satisfies Record<string, Anim>
