export type Action =
  'left' | 'right' | 'up' | 'down' | 'jump' | 'light' | 'heavy' | 'dash' | 'exec' | 'overload' | 'pause'
const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'jump', 'light', 'heavy', 'dash', 'exec', 'overload', 'pause']

const KEYMAP: Record<string, Action> = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  Space: 'jump',
  KeyJ: 'light',
  KeyZ: 'light',
  KeyI: 'heavy',
  KeyX: 'heavy',
  KeyO: 'dash',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyC: 'dash',
  KeyL: 'exec',
  KeyE: 'exec',
  KeyF: 'exec',
  KeyU: 'overload',
  Escape: 'pause',
  KeyP: 'pause',
}
// standard gamepad mapping
const PAD: [number, Action][] = [
  [0, 'jump'],
  [2, 'light'],
  [3, 'heavy'],
  [1, 'dash'],
  [7, 'dash'],
  [5, 'exec'],
  [4, 'overload'],
  [10, 'overload'],
  [9, 'pause'],
  [14, 'left'],
  [15, 'right'],
  [12, 'up'],
  [13, 'down'],
]
const BUFFER = 9

/** Keyboard + gamepad + scripted input, sampled once per logic frame with press buffering. */
export class Input {
  private keys = new Set<string>()
  /** presses that arrived since the last poll; keeps quick taps from being lost on slow frames */
  private latch = {} as Record<Action, boolean>
  virtual = {} as Record<Action, boolean>
  down = {} as Record<Action, boolean>
  pressed = {} as Record<Action, boolean>
  private buf = {} as Record<Action, number>
  anyPressed = false
  private anyRaw = false

  constructor() {
    for (const a of ACTIONS) {
      this.latch[a] = this.virtual[a] = this.down[a] = this.pressed[a] = false
      this.buf[a] = 0
    }
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code]
      if (!e.repeat) this.anyRaw = true
      if (a) {
        if (!e.repeat && !this.keys.has(e.code)) this.latch[a] = true
        this.keys.add(e.code)
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.code]) {
        this.keys.delete(e.code)
        e.preventDefault()
      }
    })
    window.addEventListener('blur', () => {
      this.keys.clear()
      for (const a of ACTIONS) this.virtual[a] = this.down[a] = false
      this.clear()
    })
    window.addEventListener('pointerdown', () => {
      this.anyRaw = true
    })
  }

  /**
   * Sample the devices. Pass `frozen` while the game is in hitstop: presses are still recorded, but the
   * buffer does not run down, so an attack pressed during the freeze comes out when time resumes.
   */
  poll(frozen = false) {
    const keyDown = {} as Partial<Record<Action, boolean>>
    for (const code of this.keys) keyDown[KEYMAP[code]] = true
    const pad = (navigator.getGamepads ? navigator.getGamepads() : []).find((p) => p && p.connected) ?? null
    const padDown = {} as Partial<Record<Action, boolean>>
    if (pad) {
      for (const [b, a] of PAD) if (pad.buttons[b]?.pressed) padDown[a] = true
      const ax = pad.axes[0] ?? 0,
        ay = pad.axes[1] ?? 0
      if (ax < -0.4) padDown.left = true
      if (ax > 0.4) padDown.right = true
      if (ay < -0.55) padDown.up = true
      if (ay > 0.55) padDown.down = true
    }
    this.anyPressed = this.anyRaw
    this.anyRaw = false
    for (const a of ACTIONS) {
      const d = !!keyDown[a] || this.virtual[a] || !!padDown[a]
      this.pressed[a] = (d && !this.down[a]) || this.latch[a]
      this.latch[a] = false
      this.down[a] = d
      if (this.pressed[a]) {
        this.buf[a] = BUFFER
        this.anyPressed = true
      } else if (this.buf[a] > 0 && !frozen) this.buf[a]--
    }
  }
  /** True once if the action was pressed within the buffer window. */
  take(a: Action) {
    if (this.buf[a] > 0) {
      this.buf[a] = 0
      return true
    }
    return false
  }
  peek(a: Action) {
    return this.buf[a] > 0
  }
  /** Discard pending presses while preserving held movement inputs. */
  clear() {
    for (const a of ACTIONS) {
      this.buf[a] = 0
      this.latch[a] = this.pressed[a] = false
    }
    this.anyRaw = this.anyPressed = false
  }
  /** Consume the input that entered a scene; held buttons are not new presses. */
  reset() {
    for (const a of ACTIONS) this.virtual[a] = false
    this.poll()
    this.clear()
  }
  get axis() {
    return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0)
  }
}
