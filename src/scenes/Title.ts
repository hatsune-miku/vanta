import * as Phaser from 'phaser'

import { shared } from './Battle'

import { Backdrop } from '../art/stage'
import { TEST_MODE } from '../config'

export class Title extends Phaser.Scene {
  private bd!: Backdrop
  private gone = false
  constructor() {
    super('Title')
  }
  create() {
    if (TEST_MODE) {
      this.scene.start('Battle')
      return
    }
    this.gone = false
    shared.input.reset()
    this.bd = new Backdrop(this, 3000)
    this.cameras.main.setScroll(0, 0)
    this.cameras.main.filters.external.addVignette(0.5, 0.5, 0.9, 0.5)
    const font = 'Impact, "Arial Black", sans-serif',
      ui = '"Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    const hud = (x: number, y: number, s: string, size: number, color: string, f = ui) =>
      this.add
        .text(x, y, s, { fontFamily: f, fontSize: `${size}px`, color })
        .setScrollFactor(0)
        .setDepth(200)
        .setShadow(0, 3, '#000', 10, false, true)
    hud(1000, 270, 'VANTA', 190, '#ffffff', font).setLetterSpacing(12).setFontStyle('italic')
    this.add.rectangle(1016, 520, 560, 3, 0x58c2ff).setOrigin(0, 0.5).setScrollFactor(0).setDepth(200)
    hud(
      1016,
      640,
      'A / D 移动    空格 跳跃    J 轻击    I 重击\nO 闪避    L 处决    U 过载    Esc 暂停',
      24,
      '#bfe9f2'
    ).setLineSpacing(14)
    const start = hud(1016, 790, '按任意键开始', 36, '#ffffff').setLetterSpacing(10)
    this.tweens.add({ targets: start, alpha: 0.35, duration: 800, yoyo: true, repeat: -1 })
    hud(1016, 1008, 'Elle · Kai Sama · CC BY 4.0   /   资源署名', 21, '#8fa9bb')
      .setInteractive({ useHandCursor: true })
      .on(
        'pointerdown',
        (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation()
          shared.input.clear()
          window.open(import.meta.env.BASE_URL + 'credits.html', '_blank', 'noopener,noreferrer')
        }
      )
    this.input.keyboard?.once('keydown', () => this.startGame())
    this.input.once('pointerdown', () => this.startGame())
  }
  private startGame() {
    if (this.gone) return
    this.gone = true
    shared.sfx.unlock()
    shared.sfx.play('ui')
    this.cameras.main.fadeOut(350, 3, 5, 10)
    this.time.delayedCall(380, () => {
      this.cameras.main.filters.external.clear()
      this.scene.start('Battle')
    })
  }
  update(t: number) {
    if (!this.bd) return
    shared.input.poll()
    if (shared.input.anyPressed) this.startGame()
    const time = t / 1000
    this.bd.update(this.cameras.main, time)
  }
}
