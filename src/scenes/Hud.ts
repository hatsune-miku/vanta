import * as Phaser from 'phaser'

import { type Battle, LEVELS } from './Battle'

import { COL, DISPLAY_FONT, VIEW_H, VIEW_W } from '../config'
import { KEY_LABEL } from '../core/input'
import { kook } from '../core/kook'
import { clamp, damp, smooth } from '../core/util'
import { type MenuExtra, SKILLS } from '../game/menu'
import { OVERLOAD_DURATION, SHIELD_COST } from '../game/player'
import { SkillPreview } from '../game/skillPreview'

const FONT =
  '"Bahnschrift", "DIN Alternate", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
const DISPLAY = 'Impact, "Arial Black", "PingFang SC", "Microsoft YaHei", sans-serif'

/** Overlay scene: bars, combo, prompts, banners, letterbox, pause / result screens. */
export class Hud extends Phaser.Scene {
  private playerId = 0
  private g!: Phaser.GameObjects.Graphics
  private hpLag = 1
  private bossLag = 1
  private comboTxt!: Phaser.GameObjects.Text
  private comboLbl!: Phaser.GameObjects.Text
  private lastCombo = 0
  private comboPop = 0
  private name!: Phaser.GameObjects.Text
  private wave!: Phaser.GameObjects.Text
  private bossName!: Phaser.GameObjects.Text
  private bossLives!: Phaser.GameObjects.Text
  private overload!: Phaser.GameObjects.Text
  private charge!: Phaser.GameObjects.Text
  private go!: Phaser.GameObjects.Text
  private banner!: Phaser.GameObjects.Text
  private bannerSub!: Phaser.GameObjects.Text
  private veil!: Phaser.GameObjects.Rectangle
  private big!: Phaser.GameObjects.Text
  private body!: Phaser.GameObjects.Text
  /** the terminal: its drawing, its lettering (a pool reused every frame) and the stage picture */
  private mg!: Phaser.GameObjects.Graphics
  private menuTexts: Phaser.GameObjects.Text[] = []
  private menuUsed = 0
  private preview!: Phaser.GameObjects.Image
  private skillPreview!: SkillPreview
  private barT!: Phaser.GameObjects.Rectangle
  private barB!: Phaser.GameObjects.Rectangle

  constructor() {
    super('Hud')
  }

  create() {
    const t = (x: number, y: number, size: number, color = '#ffffff', font = FONT) =>
      this.add
        .text(x, y, '', { fontFamily: font, fontSize: `${size}px`, color })
        .setShadow(0, 2, '#000000', 6, false, true)
    this.barT = this.add.rectangle(VIEW_W / 2, 0, VIEW_W, 130, 0x000000).setOrigin(0.5, 1)
    this.barB = this.add.rectangle(VIEW_W / 2, VIEW_H, VIEW_W, 130, 0x000000).setOrigin(0.5, 0)
    this.g = this.add.graphics()
    this.name = t(70, 40, 22, '#bfe6ff').setText('VANTA').setLetterSpacing(3)
    this.overload = t(VIEW_W / 2, 86, 34, '#ff9be8')
      .setOrigin(0.5, 0)
      .setFontStyle('bold')
    this.charge = t(70, 138, 24, '#e8f8ff')
    this.wave = t(VIEW_W / 2, 44, 22, '#bfe9f2')
      .setOrigin(0.5, 0)
      .setLetterSpacing(4)
    this.bossName = t(VIEW_W / 2, VIEW_H - 118, 24, '#ffc8b0')
      .setOrigin(0.5, 0)
      .setLetterSpacing(6)
    this.bossLives = t(VIEW_W / 2 + 550, VIEW_H - 90, 36, '#ffc8b0').setFontStyle('bold')
    // slanted digits lean out of the box their width is measured as: room on the right keeps them whole
    this.comboTxt = t(VIEW_W - 90 + 44, 250, 120, '#ffffff', DISPLAY)
      .setOrigin(1, 0.5)
      .setFontStyle('italic')
      .setStroke('#0a0d16', 8)
      .setPadding(16, 10, 44, 10)
    this.comboLbl = t(VIEW_W - 88, 320, 28, '#ff9fe6')
      .setOrigin(1, 0.5)
      .setText('HITS')
      .setLetterSpacing(8)
    this.go = t(VIEW_W - 90, VIEW_H / 2, 54, '#bfe6ff', DISPLAY)
      .setOrigin(1, 0.5)
      .setText('▶')
      .setFontStyle('italic')
      .setPadding(8, 6, 22, 6)
    this.banner = t(VIEW_W / 2, 330, 84, '#ffffff', DISPLAY)
      .setOrigin(0.5)
      .setLetterSpacing(14)
    this.bannerSub = t(VIEW_W / 2, 400, 26, '#bfe9f2')
      .setOrigin(0.5)
      .setLetterSpacing(8)
    this.veil = this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x03050a).setAlpha(0)
    this.big = t(VIEW_W / 2, 330, 110, '#ffffff', DISPLAY)
      .setOrigin(0.5)
      .setLetterSpacing(18)
    this.body = t(VIEW_W / 2, 440, 30, '#d6eef5')
      .setOrigin(0.5, 0)
      .setAlign('center')
      .setLineSpacing(16)
    this.mg = this.add.graphics().setDepth(60)
    this.preview = this.add.image(0, 0, 'bd_mid').setOrigin(0, 0).setDepth(61).setVisible(false)
    this.skillPreview = new SkillPreview(this)
    this.menuTexts = []
  }

  private bar(x: number, y: number, w: number, h: number, v: number, color: number, lag = -1, skew = 14) {
    const g = this.g
    const quad = (x0: number, x1: number, c: number, a: number) => {
      if (x1 <= x0) return
      g.fillStyle(c, a)
      g.fillPoints(
        [
          { x: x0 + skew, y },
          { x: x1 + skew, y },
          { x: x1, y: y + h },
          { x: x0, y: y + h },
        ] as any,
        true
      )
    }
    quad(x - 4, x + w + 4, 0x05070c, 0.7)
    quad(x, x + w, 0x1b2535, 0.9)
    if (lag >= 0) quad(x, x + w * clamp(lag, 0, 1), 0xffffff, 0.85)
    quad(x, x + w * clamp(v, 0, 1), color, 1)
    g.fillStyle(0xffffff, 0.25)
    g.fillPoints(
      [
        { x: x + skew, y },
        { x: x + skew + w * clamp(v, 0, 1), y },
        { x: x + skew * 0.6 + w * clamp(v, 0, 1), y: y + h * 0.4 },
        { x: x + skew * 0.6, y: y + h * 0.4 },
      ] as any,
      true
    )
  }

  update(_t: number, dms: number) {
    const b = this.scene.get('Battle') as Battle
    if (!b || !b.player) return
    const p = b.player,
      g = this.g,
      now = this.time.now / 1000,
      dt = dms / 1000
    if (this.playerId !== p.id) {
      this.playerId = p.id
      this.hpLag = this.bossLag = 1
      this.lastCombo = this.comboPop = 0
      this.veil.setAlpha(0)
    }
    g.clear()
    const live = !b.cine && !b.over && !b.paused

    // letterbox
    const c = b.cineAmt
    this.barT.y = 110 * c
    this.barB.y = VIEW_H - 110 * c
    const ui = 1 - c
    for (const o of [
      this.name,
      this.wave,
      this.comboTxt,
      this.comboLbl,
      this.go,
      this.bossName,
      this.bossLives,
      this.overload,
      this.charge,
    ])
      o.setAlpha(ui)
    g.setAlpha(ui)

    if (p.overloaded) {
      const pulse = 0.5 + Math.sin(now * 4) * 0.5
      // A vivid frame of light closes in from every side and the whole view takes a faint pink cast, so the
      // state reads at a glance without a global banner.
      g.fillStyle(0xff8fe0, 0.035 + pulse * 0.012).fillRect(0, 0, VIEW_W, VIEW_H)
      for (let i = 0; i < 8; i++) {
        const width = 10 + i * 13,
          a = (0.02 + pulse * 0.012) * (8 - i)
        g.fillStyle(0xb47bff, a).fillRect(0, 0, width, VIEW_H)
        g.fillStyle(0xff6fd0, a).fillRect(VIEW_W - width, 0, width, VIEW_H)
        g.fillStyle(0xff8fe0, a * 0.5).fillRect(0, 0, VIEW_W, width * 0.45)
        g.fillStyle(0xff8fe0, a * 0.5).fillRect(0, VIEW_H - width * 0.45, VIEW_W, width * 0.45)
      }
      g.fillStyle(0x081627, 0.72).fillRoundedRect(VIEW_W / 2 - 200, 78, 400, 70, 8)
    }

    // player bars
    const hp = p.hp / p.maxHp
    this.hpLag = hp > this.hpLag ? hp : Math.max(hp, this.hpLag - dt * 0.35)
    this.bar(70, 74, 520, 22, hp, hp < 0.3 ? COL.hostile : 0xf2f6ff, this.hpLag)
    const en = (Math.floor(p.energy / SHIELD_COST) * SHIELD_COST) / p.maxEnergy
    this.bar(64, 104, 360, 10, en, COL.main, -1, 6)
    g.fillStyle(0x05070c, 0.9)
    for (let i = 1; i < 5; i++) g.fillRect(64 + (360 * i * SHIELD_COST) / p.maxEnergy + 3, 104, 2, 10)
    // overload shows only while it runs: its time left, top centre
    this.overload.setVisible(p.overloaded && !b.over && !b.paused).setText(`超载  ${p.overloadT.toFixed(1)}s`)
    if (p.overloaded) this.bar(VIEW_W / 2 - 180, 134, 360, 7, p.overloadT / OVERLOAD_DURATION, COL.pink, -1, 4)
    this.charge.setVisible(p.charging).setText(`光幕  ×${p.chargePower.toFixed(2)}`)
    if (p.charging) this.bar(70, 176, 520, 7, p.chargeT / p.chargeSpan, COL.cyan, -1, 5)

    // wave
    this.wave.setText(b.waveInfo ? `波次  ${b.waveInfo}` : '')

    // boss
    const boss = b.boss && !b.boss.gone ? b.boss : null
    this.bossName.setVisible(!!boss)
    this.bossLives.setVisible(!!boss)
    if (boss) {
      const v = clamp(boss.hp / boss.maxHp, 0, 1)
      this.bossLag = Math.max(v, this.bossLag - dt * 0.2)
      this.bossName.setText(boss.title)
      this.bossLives.setText(`×${boss.lives}`)
      this.bar(VIEW_W / 2 - 520, VIEW_H - 80, 1040, 18, v, COL.hostile, this.bossLag)
    } else this.bossLag = 1

    // combo
    if (b.comboN !== this.lastCombo) {
      if (b.comboN > this.lastCombo) this.comboPop = 1
      this.lastCombo = b.comboN
    }
    this.comboPop = Math.max(0, this.comboPop - dt * 6)
    const showCombo = b.comboN >= 2
    this.comboTxt
      .setVisible(showCombo)
      .setText(String(b.comboN))
      .setScale(1 + this.comboPop * 0.35)
      .setColor(b.comboN >= 50 ? '#ff7a9a' : b.comboN >= 20 ? '#ff9fe6' : '#ffffff')
    this.comboLbl.setVisible(showCombo)
    if (showCombo) {
      g.fillStyle(COL.main, 0.9 * ui)
      g.fillRect(VIEW_W - 90 - 220 * (b.comboT / 170), 344, 220 * (b.comboT / 170), 4)
    }

    this.go.setVisible(b.goHint && live).setX(VIEW_W - 230 + Math.sin(now * 6) * 12)

    // banner
    const bn = b.banner
    if (bn) {
      const a = clamp(Math.min(bn.t / 20, 1), 0, 1)
      this.banner
        .setText(bn.text)
        .setAlpha(a * ui)
        .setVisible(true)
      this.bannerSub
        .setText(bn.sub)
        .setAlpha(a * ui)
        .setVisible(true)
      g.fillStyle(COL.main, 0.8 * a * ui)
      g.fillRect(VIEW_W / 2 - 260, 384, 520, 2)
    } else {
      this.banner.setVisible(false)
      this.bannerSub.setVisible(false)
    }

    // low-hp pulse
    if (hp < 0.3 && !b.over) {
      g.fillStyle(0xff2040, 0.06 + Math.sin(now * 5) * 0.04)
      g.fillRect(0, 0, VIEW_W, VIEW_H)
    }

    // overlays
    let veil = 0,
      big = '',
      body = ''
    if (b.over === 'dead') {
      veil = 0.6
      big = '信号中断'
      body = '按任意键，从当前封锁区重新接入'
    } else if (b.over === 'win') {
      veil = 0.66
      big = '肃清完成'
      const s = Math.floor(b.clock),
        rank = p.damageTaken < 40 && b.maxCombo >= 60 ? 'S' : p.damageTaken < 90 ? 'A' : p.damageTaken < 160 ? 'B' : 'C'
      body = `用时  ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}        最高连击  ${b.maxCombo}\n处决  ${b.execs}        承受伤害  ${Math.round(p.damageTaken)}\n\n评价   ${rank}\n\n按任意键重新开始`
    }
    this.veil.setAlpha(damp(this.veil.alpha, veil, 10, dt))
    this.big.setText(big).setVisible(!!big)
    this.body.setText(body).setVisible(!!body)
    this.terminal(b)
  }

  /** A line of the terminal's lettering, taken from the pool. */
  private label(x: number, y: number, str: string, size: number, color: string, alpha = 1, ox = 0, wrap = 0) {
    let text = this.menuTexts[this.menuUsed++]
    if (!text) {
      text = this.add.text(0, 0, '', { fontFamily: FONT }).setDepth(62)
      this.menuTexts.push(text)
    }
    text
      .setPosition(x, y)
      .setOrigin(ox, 0.5)
      .setFontSize(size)
      .setFontFamily(FONT)
      .setFontStyle('')
      .setLetterSpacing(0)
      .setColor(color)
      .setAlpha(alpha)
      .setWordWrapWidth(wrap || null, true)
      .setLineSpacing(wrap ? 12 : 0)
      .setText(str)
      .setVisible(true)
    return text
  }
  /** A keycap with its letter, as on the signs of the opening stretch. Returns its width. */
  private cap(x: number, y: number, str: string, k: number, color: number) {
    const text = this.label(0, y, str, 26, '#ffffff', k, 0.5).setFontStyle('bold'),
      w = Math.max(46, text.width + 24)
    text.setX(x + w / 2)
    this.mg.fillStyle(0x0d2f4a, 0.9 * k).fillRoundedRect(x, y - 23, w, 46, 9)
    this.mg.lineStyle(2, color, k).strokeRoundedRect(x, y - 23, w, 46, 9)
    return w
  }

  /**
   * The terminal: the game's one menu, drawn as a projection over the frozen fight rather than as a page laid over
   * it. A stage screen (the stages, then skills, sound and credits) and a skills screen (every skill: how it is pressed and what it does).
   */
  private terminal(b: Battle) {
    const m = b.menu,
      g = this.mg
    g.clear()
    for (let i = 0; i < this.menuTexts.length; i++) this.menuTexts[i].setVisible(false)
    this.menuUsed = 0
    this.preview.setVisible(false)
    if (m?.tab !== 'skills') this.skillPreview.hide()
    if (!m) return
    const pad = b.ctl.padConnected ? 1 : 0,
      key = (action: string) => KEY_LABEL[action]?.[pad] ?? action,
      // it unfolds like the signs do: the frame opens, then what is in it comes up
      open = smooth(clamp(m.age / 0.22, 0, 1)),
      k = smooth(clamp((m.age - 0.12) / 0.2, 0, 1)),
      slide = smooth(clamp(m.moved / 0.14, 0, 1)),
      now = this.time.now / 1000,
      flicker = 0.93 + 0.07 * Math.sin(now * 9),
      X = 150,
      Y = 112,
      W = VIEW_W - X * 2,
      H = VIEW_H - Y * 2 + 10,
      cx = VIEW_W / 2,
      cy = Y + H / 2,
      w = W * open,
      h = Math.max(4, H * smooth(clamp((m.age - 0.06) / 0.2, 0, 1)))
    g.fillStyle(0x01040a, 0.74 * open).fillRect(0, 0, VIEW_W, VIEW_H)
    g.fillStyle(0x061827, 0.78 * open).fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 16)
    g.lineStyle(2.5, COL.cyan, 0.8 * open * flicker).strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 16)
    g.fillStyle(COL.cyan, 0.9 * open)
      .fillRect(cx - w / 2 - 12, cy - 3, 24, 6)
      .fillRect(cx + w / 2 - 12, cy - 3, 24, 6)
    if (k <= 0) return
    // slow scan line, as on the signs
    g.fillStyle(COL.cyan, 0.06 * k).fillRect(X + 8, Y + ((now * 0.22) % 1) * (H - 8), W - 16, 3)
    // header: what this is, and the two screens
    this.label(X + 56, Y + 58, 'VANTA', 30, '#ffffff', k)
      .setFontFamily(DISPLAY_FONT)
      .setLetterSpacing(8)
    this.label(X + 230, Y + 60, '作战终端', 24, '#8fd6ff', k * 0.9).setLetterSpacing(6)
    // inside a frame: where the KOOK session stands (connected or not, authorised or not, and why not)
    const session = kook.statusLine
    if (session) this.label(X + 410, Y + 61, session, 20, kook.auth === 'authorized' ? '#7dffb0' : '#ffd27d', k * 0.85)
    const tabs: [string, boolean][] = [
      ['关卡', m.tab === 'stage'],
      ['技能', m.tab === 'skills'],
    ]
    tabs.forEach(([name, on], i) => {
      const tx = X + W - 300 + i * 130
      this.label(tx, Y + 60, name, 26, on ? '#ffffff' : '#6f90a8', k, 0.5).setLetterSpacing(6)
      if (on) g.fillStyle(COL.cyan, k).fillRect(tx - 38, Y + 82, 76, 3)
    })
    g.lineStyle(1.5, COL.cyan, 0.35 * k).lineBetween(X + 40, Y + 100, X + W - 40, Y + 100)
    const hint =
      m.tab === 'stage'
        ? `W / S  选择        ${pad ? 'A' : 'Enter / 空格'}  确认        ${key('skills')}  技能        Esc  返回战斗`
        : `W / S  切换技能        ${pad ? 'A' : 'Enter / 空格'}  ${m.previewPaused ? '继续' : '暂停'}演示        Esc / ${key('skills')}  返回`
    this.label(cx, Y + H - 40, hint, 22, '#8fb3c9', k, 0.5).setLetterSpacing(2)
    const LX = X + 56,
      LW = 620,
      RX = X + 730,
      RW = W - 730 - 56,
      top = Y + 132
    if (m.tab === 'stage') {
      let y = top
      LEVELS.forEach((level, i) => {
        const on = m.row === i,
          lift = on ? slide : 0
        g.fillStyle(on ? 0x0f3552 : 0x0a2236, (on ? 0.95 : 0.6) * k).fillRoundedRect(LX, y, LW, 118, 12)
        g.lineStyle(on ? 3 : 1.5, COL.cyan, (on ? 1 : 0.35) * k).strokeRoundedRect(LX, y, LW, 118, 12)
        if (on) g.fillStyle(COL.cyan, k).fillRect(LX, y + 14, 5, 90)
        this.label(LX + 34 + lift * 8, y + 59, String(i + 1).padStart(2, '0'), 58, on ? '#ffffff' : '#6f90a8', k)
          .setFontFamily(DISPLAY_FONT)
          .setFontStyle('bold')
        this.label(LX + 150 + lift * 8, y + 42, level.place, 34, on ? '#ffffff' : '#b9d6e8', k).setLetterSpacing(4)
        this.label(LX + 150 + lift * 8, y + 84, level.name, 22, '#8fb3c9', k)
        if (i === b.level) this.label(LX + LW - 28, y + 42, '当前', 22, '#7dffb0', k, 1)
        y += 134
      })
      y += 10
      const names: Record<MenuExtra, string> = {
        skills: '技能',
        sound: `声音：${b.sfx.muted ? '关' : '开'}`,
        fullscreen: '全屏',
        signin: 'KOOK 授权',
        credits: '资源署名',
        leave: '退出游戏',
      }
      // with every row present the list is a little taller than the panel: the rows close up to fit
      const pitch = m.extras.length > 4 ? 64 : 74
      m.extras.forEach((extra, i) => {
        const on = m.row === LEVELS.length + i,
          h = pitch - 12
        g.fillStyle(on ? 0x0f3552 : 0x0a2236, (on ? 0.95 : 0.45) * k).fillRoundedRect(LX, y, LW, h, 10)
        g.lineStyle(on ? 3 : 1.5, COL.cyan, (on ? 1 : 0.25) * k).strokeRoundedRect(LX, y, LW, h, 10)
        this.label(
          LX + 34 + (on ? slide * 8 : 0),
          y + h / 2,
          names[extra],
          28,
          on ? '#ffffff' : '#b9d6e8',
          k
        ).setLetterSpacing(4)
        if (extra === 'skills' || extra === 'sound')
          this.label(LX + LW - 28, y + h / 2, extra === 'skills' ? key('skills') : 'M', 22, '#8fb3c9', k, 1)
        y += pitch
      })
      // the right side shows what the cursor is on
      const PH = Math.round((RW * 9) / 16)
      if (m.row < LEVELS.length) {
        const level = LEVELS[m.row],
          frame = this.textures.getFrame(this.textures.exists(level.picture) ? level.picture : 'bd_mid'),
          cropW = Math.min(frame.width, Math.round((frame.height * 16) / 9))
        this.preview
          .setTexture(frame.texture.key)
          .setCrop(Math.round(frame.width * 0.24), 0, cropW, frame.height)
          .setScale(RW / cropW)
          .setPosition(RX - Math.round(frame.width * 0.24) * (RW / cropW), top)
          .setAlpha(k * slide)
          .setVisible(true)
        g.lineStyle(2, COL.cyan, 0.8 * k).strokeRect(RX, top, RW, PH)
        this.label(RX, top + PH + 56, level.place, 46, '#ffffff', k).setLetterSpacing(6)
        this.label(RX + RW, top + PH + 60, m.row === b.level ? '重新开始本关' : '进入', 26, '#7dffb0', k, 1)
        this.label(RX, top + PH + 108, level.brief, 26, '#b9d6e8', k, 0, RW).setOrigin(0, 0)
      } else {
        const extra = m.extras[m.row - LEVELS.length],
          about: Record<MenuExtra, [string, string]> = {
            skills: ['全部技能', `逐个说明每个技能的按法和效果。战斗中按 ${key('skills')} 可直接打开。`],
            sound: [`声音：${b.sfx.muted ? '关' : '开'}`, '确认以切换。战斗中按 M 也可以随时开关。'],
            fullscreen: [
              '全屏',
              '确认后进入全屏；再次确认或按浏览器的 Esc 退出。在 KOOK 中由 KOOK 把游戏区域放到全屏。',
            ],
            signin: [
              'KOOK 授权',
              `${session}\n\n确认后向 KOOK 申请授权（读取你的基本资料）。不授权也可以正常游玩。`,
            ],
            credits: [
              '资源署名',
              '主角模型 Elle · Kai Sama · CC BY 4.0\n敌人模型与动作 · Quaternius · CC0\n背景实拍 · Poly Haven · CC0\n音乐 · Kevin MacLeod (incompetech.com) · CC BY 4.0\n\n确认后打开完整署名页。',
            ],
            leave: ['退出游戏', '确认后由 KOOK 关闭这局游戏。游戏不保存进度，下次从头开始。'],
          },
          lines = about[extra]
        g.lineStyle(2, COL.cyan, 0.5 * k).strokeRect(RX, top, RW, PH)
        this.label(RX + 40, top + 70, lines[0], 44, '#ffffff', k * slide).setLetterSpacing(6)
        this.label(RX + 40, top + 130, lines[1], 26, '#b9d6e8', k * slide, 0, RW - 80).setOrigin(0, 0)
      }
      return
    }
    // ---- skills
    SKILLS.forEach((skill, i) => {
      const on = m.skill === i,
        y = top + i * 64
      g.fillStyle(on ? 0x0f3552 : 0x0a2236, (on ? 0.95 : 0.4) * k).fillRoundedRect(LX, y, LW, 54, 9)
      g.lineStyle(on ? 3 : 1, COL.cyan, (on ? 1 : 0.2) * k).strokeRoundedRect(LX, y, LW, 54, 9)
      if (on) g.fillStyle(COL.cyan, k).fillRect(LX, y + 8, 5, 38)
      this.label(
        LX + 30 + (on ? slide * 8 : 0),
        y + 27,
        skill.name,
        28,
        on ? '#ffffff' : '#b9d6e8',
        k
      ).setLetterSpacing(4)
      this.label(LX + LW - 24, y + 27, skill.keys.map(key).join(' + '), 22, on ? '#bfe9ff' : '#6f90a8', k, 1)
    })
    // The recording leads; the controls and explanation stay directly beneath it.
    const skill = SKILLS[m.skill],
      PH = (RW * 9) / 16
    g.fillStyle(0x030b13, k).fillRect(RX, top, RW, PH)
    this.skillPreview.show(skill, RX, top, RW, k * slide, m.previewPaused)
    g.lineStyle(2, COL.cyan, 0.7 * k).strokeRect(RX - 1, top - 1, RW + 2, PH + 2)
    g.fillStyle(COL.cyan, k).fillRect(RX, top + PH + 4, RW * this.skillPreview.progress, 3)
    if (this.skillPreview.failed) this.label(RX + RW / 2, top + PH / 2, '演示暂不可用', 26, '#c8e2f2', k, 0.5)
    this.label(RX, top + PH + 42, skill.name, 42, '#ffffff', k * slide).setLetterSpacing(5)
    if (m.previewPaused) this.label(RX + RW, top + PH + 42, '已暂停', 22, '#8fd6ff', k, 1)
    let x = RX
    const ky = top + PH + 96
    if (skill.how) x += this.label(x, ky, skill.how, 25, '#8fd6ff', k).width + 18
    skill.keys.forEach((action, i) => {
      if (i) x += this.label(x + 8, ky, '+', 28, '#8fd6ff', k).width + 18
      x += this.cap(x, ky, key(action), k, COL.cyan) + 8
    })
    this.label(RX, ky + 42, skill.text, 25, '#c8e2f2', k * slide, 0, RW)
      .setOrigin(0, 0)
      .setLineSpacing(7)
  }
}
