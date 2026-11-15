import type { Input } from '../core/input'

/** A skill as the terminal's skills page presents it. */
export interface SkillInfo {
  id: string
  name: string
  /** the input actions pressed together */
  keys: string[]
  /** how they are pressed, when that is more than a tap ("按住", "空中 ↓ +") */
  how?: string
  text: string
}

/** Every skill, under the names the game uses for them everywhere. */
export const SKILLS: SkillInfo[] = [
  { id: 'light', name: '轻击', keys: ['light'], text: '连按五段，快而连贯；空中是三段。' },
  {
    id: 'heavy',
    name: '重击',
    keys: ['heavy'],
    text: '连按四段：上挑斩、转身反手斩、残影三连、刀轮下砸。第二段命中时画面定格，敌人身上绽开光花。按住 ↑ 再重击为挑空。',
  },
  {
    id: 'exec',
    name: '处决',
    keys: ['exec'],
    text: '敌人空血濒死、身上亮起标识时按下。屏幕内任意距离都能发动，并回复生命。',
  },
  {
    id: 'dash',
    name: '闪避',
    keys: ['dash'],
    text: '朝方向键的方向瞬移，途中无敌。空中可以连续闪避飞行，不会失去高度。',
  },
  {
    id: 'extreme',
    name: '极限闪避',
    keys: ['dash'],
    how: '攻击即将命中的瞬间',
    text: '免除这次伤害、获得能量，并自动对攻击者还以一记穿身斩。',
  },
  {
    id: 'curtain',
    name: '光幕',
    keys: ['light', 'heavy'],
    how: '按住',
    text: '蓄力时每秒消耗一格能量（至少两格才能开始），松开或蓄满两秒后放出贯穿战场的光墙。冷却五秒。',
  },
  {
    id: 'overload',
    name: '超载',
    keys: ['overload'],
    text: '十五秒内伤害提高两成，重击变为蓝粉双刃、范围更大；闪避会闪到敌人身边并斩击。结束后冷却五秒。',
  },
  {
    id: 'verdict',
    name: '超载光幕',
    keys: ['light', 'heavy'],
    how: '超载中按住',
    text: '不消耗能量。时间放慢、俯视全场；松开后连斩两刀：先导光刃开路，巨大的弧形光刃坠地拖行，持续切割全场敌人。释放后超载结束。',
  },
  {
    id: 'plunge',
    name: '下劈 · 重下劈',
    keys: ['light'],
    how: '空中 ↓ +（重下劈用重击）',
    text: '从空中笔直落下。重下劈落地时带一圈冲击波。',
  },
  {
    id: 'lunge',
    name: '闪避重击',
    keys: ['heavy'],
    how: '长按',
    text: '向前闪避，撞到敌人就停下并斩出重击第一段，之后连按接后续几段。',
  },
]

export type MenuTab = 'stage' | 'skills'
/**
 * The rows of the stage screen after the stages themselves. Which of them appear depends on where the game is
 * running: fullscreen only where it can be had, leaving only inside KOOK.
 */
export type MenuExtra = 'skills' | 'sound' | 'fullscreen' | 'credits' | 'leave'
export type MenuAction =
  { type: 'close' } | { type: 'level'; index: number } | { type: 'sound' | 'fullscreen' | 'credits' | 'leave' }

/**
 * The terminal: what Escape opens. The game stands still behind it. Its first screen lists the stages (choosing one
 * starts it from its beginning) and leads to the skills page, the sound switch and the credits; its second screen
 * is the skills page, one skill at a time. K opens that page directly from play, and closes it.
 */
export class Menu {
  /** the row under the cursor on the stage screen: the stages first, then the extras */
  row: number
  skill = 0
  previewPaused = false
  /** seconds since it opened, and since the selection last moved: what its unfolding is timed from */
  age = 0
  moved = 0

  constructor(
    public tab: MenuTab,
    private stages: number,
    current: number,
    readonly extras: MenuExtra[],
    /** opened straight onto the skills page: closing it returns to the fight, not to the stage screen */
    private direct = false
  ) {
    this.row = current
  }

  get rows() {
    return this.stages + this.extras.length
  }
  /** The extra row under the cursor on the stage screen, if the cursor is on one. */
  get extra(): MenuExtra | null {
    return this.tab === 'stage' && this.row >= this.stages ? this.extras[this.row - this.stages] : null
  }

  /** Once per frame while it is open. Returns what the scene should do, if anything. */
  update(ctl: Input, dt: number): MenuAction | null {
    this.age += dt
    this.moved += dt
    const step = (ctl.take('down') ? 1 : 0) - (ctl.take('up') ? 1 : 0),
      // confirming is Enter, Space or the pad's A: never an attack button, so mashing cannot pick a row
      confirm = ctl.take('confirm') || ctl.take('jump'),
      back = ctl.take('pause'),
      skills = ctl.take('skills')
    if (this.tab === 'skills') {
      if (step) {
        this.skill = (this.skill + step + SKILLS.length) % SKILLS.length
        this.moved = 0
        this.previewPaused = false
      }
      if (confirm) this.previewPaused = !this.previewPaused
      if (back || skills) {
        if (this.direct) return { type: 'close' }
        this.tab = 'stage'
        this.moved = 0
      }
      return null
    }
    if (step) {
      this.row = (this.row + step + this.rows) % this.rows
      this.moved = 0
    }
    if (back) return { type: 'close' }
    if (skills) {
      this.tab = 'skills'
      this.moved = 0
      return null
    }
    if (!confirm) return null
    if (this.row < this.stages) return { type: 'level', index: this.row }
    const extra = this.extras[this.row - this.stages]
    if (extra === 'skills') {
      this.tab = 'skills'
      this.moved = 0
      return null
    }
    return { type: extra }
  }
}
