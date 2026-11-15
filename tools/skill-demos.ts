import { reseed } from '../src/core/util'
import { SKILLS } from '../src/game/menu'
import { MOVES } from '../src/game/player'

/** Recording fixtures only: the production engine, staged opponents and ordinary input actions. */
export function installDemo(id: string) {
  const game = (window as any).__game,
    b = game.scene.getScene('Battle'),
    p = b.player,
    ctl = b.ctl,
    hud = game.scene.getScene('Hud'),
    skill = SKILLS.find((s) => s.id === id)!
  reseed(711)
  b.tutorial?.finish()
  b.tutorial = null
  for (const e of b.enemies) if (!e.gone) e.destroy()
  b.enemies = []
  b.direct = () => {}
  b.bounds = { l: 5700, r: 10000 }
  b.plats = []
  b.locked = true
  b.banner = null
  // Foreground occluders are omitted in these teaching shots so the sword and target stay readable.
  for (const object of b.children.list) if (object.texture?.key === 'fg_pillar') object.setVisible(false)
  b.stop = b.slowT = b.acc = 0
  b.cam = { x: 7090, y: 478, zoom: 0.88, rot: 0 }
  b.lead = 90
  b.sfx.setMuted(true)
  Object.assign(p, { x: 7000, px: 7000, y: 900, py: 900, facing: 1, vx: 0, vy: 0, onGround: true, energy: 100 })
  ctl.reset()
  const caption = hud.add
    .text(70, 1005, '', {
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '30px',
      color: '#d7f6ff',
      backgroundColor: '#071623',
      padding: { x: 20, y: 12 },
    })
    .setDepth(1000)
  const targets: any[] = []
  function enemy(kind: string, offset: number, durable = false, y?: number) {
    const e = b.spawnTraining(kind, 7000 + offset, true, y)
    e.state = 'idle'
    e.st = 0
    e.invuln = 0
    e.onGround = !e.flying
    e.rig.setAlpha(1)
    if (durable) e.hp = e.maxHp = 2000
    targets.push(e)
    return e
  }
  if (id === 'light') {
    enemy('heavy', 160, true)
    enemy('drone', 420, true, 550)
  }
  if (id === 'heavy' || id === 'overload') {
    enemy('heavy', 380, true)
    enemy('grunt', 560, true)
  }
  if (id === 'exec') {
    const e = enemy('gunner', 350)
    b.attack(p, e.box, { ...MOVES.l1.hits[0].hit, dmg: e.hp }, new Set())
    p.hp = 60
  }
  if (id === 'extreme') enemy('grunt', 170, true)
  if (id === 'curtain' || id === 'verdict') {
    for (const [i, offset] of [-580, 240, 510, 800, 1050].entries()) enemy(i % 2 ? 'grunt' : 'gunner', offset)
  }
  if (id === 'plunge') enemy('heavy', 70, true)
  if (id === 'lunge') enemy('heavy', 470, true)
  b.fx.update(10)
  b.fx.update(10)
  b.stop = 0
  const releases = new Map<string, number>(),
    moves = new Set<string>(),
    states = new Set<string>(),
    dives = new Set<boolean>()
  let frame = 0,
    chain: any = null,
    counter = false,
    verdict = false,
    surge = false,
    overload = false,
    dashes = 0,
    lastState = ''
  function cue(text: string) {
    caption.setText(text)
  }
  function press(action: string, duration = 2) {
    ctl.virtual[action] = true
    releases.set(action, frame + duration)
  }
  function combo(action: string, limit: number, hold = 2) {
    chain = { action, limit, count: 0, last: null, queued: new Set() }
    press(action, hold)
  }
  function next() {
    for (const [action, end] of releases)
      if (frame >= end) {
        ctl.virtual[action] = false
        releases.delete(action)
      }
    if (chain && p.move) {
      if (p.move !== chain.last) {
        chain.last = p.move
        chain.count++
      }
      if (chain.count < chain.limit && !chain.queued.has(p.move) && p.mf >= (p.move.chain ?? p.move.cancel) - 2) {
        chain.queued.add(p.move)
        press(chain.action)
      }
    }
    if (id === 'light') {
      if (frame === 0) cue('连按 J · 地面五段')
      if (frame === 36) combo('light', 5)
      if (frame === 250) {
        chain = null
        cue('空格 → 连按 J · 空中三段')
        press('jump', 15)
      }
      if (frame === 265) combo('light', 3)
    } else if (id === 'heavy') {
      if (frame === 0) cue('连按 I · 四段重击')
      if (frame === 36) combo('heavy', 4)
    } else if (id === 'exec') {
      if (frame === 0) cue('目标濒死 → L')
      if (frame === 40) press('exec')
    } else if (id === 'dash') {
      if (frame === 0) cue('方向 + O · 闪避')
      if (frame === 36) {
        press('right', 5)
        press('dash')
      }
      if (frame === 88) {
        cue('空格 → 方向 + O · 空中连续闪避')
        press('jump', 15)
      }
      if (frame === 108) {
        press('up', 5)
        press('right', 5)
        press('dash')
      }
      if (frame === 140 || frame === 172) {
        press('right', 5)
        press('dash')
      }
      if (frame === 215) press('down', 24)
    } else if (id === 'extreme') {
      if (frame === 0) cue('敌人即将命中 → O')
      if (frame === 36) targets[0].begin('gruntOver')
      if (frame === 53) press('dash')
    } else if (id === 'curtain') {
      if (frame === 0) cue('按住 J + I · 光幕蓄力')
      if (frame === 36) {
        press('light', 108)
        press('heavy', 108)
      }
      if (frame === 144) cue('松开 · 贯穿光幕')
    } else if (id === 'overload') {
      if (frame === 0) cue('U · 超载')
      if (frame === 36) press('overload')
      if (frame === 98) {
        cue('I · 蓝粉双刃')
        combo('heavy', 2)
      }
      if (frame === 238) {
        chain = null
        cue('O · 敌人锚点斩击')
        press('dash')
      }
    } else if (id === 'verdict') {
      if (frame === 0) cue('U → 按住 J + I')
      if (frame === 24) press('overload')
      if (frame === 84) {
        press('light', 66)
        press('heavy', 66)
      }
      if (frame === 150) cue('松开 · 超载光幕')
    } else if (id === 'plunge') {
      if (frame === 0) cue('空中 ↓ + J · 下劈')
      if (frame === 30 || frame === 150) press('jump', 16)
      if (frame === 48) {
        press('down')
        press('light')
      }
      if (frame === 150) cue('空中 ↓ + I · 重下劈')
      if (frame === 168) {
        press('down')
        press('heavy')
      }
    } else if (id === 'lunge') {
      if (frame === 0) cue('长按 I · 闪避重击 → I 接续')
      if (frame === 36) combo('heavy', 2, 28)
    }
    frame++
  }
  function observe() {
    const move = Object.entries(MOVES).find(([, m]) => m === p.move)?.[0]
    if (move) moves.add(move)
    states.add(p.state)
    if (p.state === 'dash' && lastState !== 'dash') dashes++
    if (p.state === 'dive') dives.add(p.diveHeavy)
    lastState = p.state
    counter ||= !!b.cine?.counterHit
    verdict ||= !!b.verdict
    surge ||= b.projs.some((q: any) => q.kind === 'surge')
    overload ||= p.overloaded
  }
  const durations: Record<string, number> = {
    light: 8,
    heavy: 6.5,
    exec: 4,
    dash: 5,
    extreme: 4,
    curtain: 5,
    overload: 6,
    verdict: 7,
    plunge: 5,
    lunge: 4,
  }
  function report() {
    return {
      id,
      name: skill.name,
      seconds: durations[id],
      moves: [...moves],
      states: [...states],
      dives: [...dives],
      counter,
      verdict,
      surge,
      overload,
      dashes,
      execs: b.execs,
      anchor: targets.some((e) => e.anchorUsed),
    }
  }
  return { next, observe, report, seconds: durations[id] }
}
