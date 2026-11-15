import * as Phaser from 'phaser'

import { shared } from './Battle'

import { Backdrop } from '../art/stage'
import { DISPLAY_FONT, TEST_MODE, UI_FONT, VIEW_H, VIEW_W } from '../config'
import { kook } from '../core/kook'

export class Title extends Phaser.Scene {
  private bd!: Backdrop
  private gone = false
  /** KOOK has been asked for the player's authorisation, and how many times input has been read since */
  private asked = false
  private polls = 0
  constructor() {
    super('Title')
  }
  create() {
    if (TEST_MODE) {
      this.scene.start('Battle')
      return
    }
    this.gone = false
    this.asked = false
    // the game can be played from here on: tell KOOK, when it is the one hosting, that loading succeeded
    kook.loadResult(true)
    shared.input.reset()
    this.bd = new Backdrop(this, 3000)
    this.cameras.main.setScroll(0, 0)
    this.cameras.main.filters.external.addVignette(0.5, 0.5, 0.9, 0.5)
    const text = (y: number, s: string, size: number, family: string) =>
      this.add
        .text(VIEW_W / 2, y, s, { fontFamily: family, fontSize: `${size}px`, color: '#ffffff' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(200)
        .setShadow(0, 4, '#02060c', 18, false, true)
    // the wordmark and one line: nothing else belongs on this screen
    text(VIEW_H * 0.42, 'VANTA', 230, DISPLAY_FONT)
      .setLetterSpacing(46)
      .setFontStyle('900')
    const start = text(VIEW_H * 0.68, '任意键继续', 34, UI_FONT).setLetterSpacing(14)
    this.tweens.add({ targets: start, alpha: 0.3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.input.keyboard?.once('keydown', () => this.startGame())
    this.input.once('pointerdown', () => this.startGame())
  }
  private startGame() {
    if (this.gone) return
    // Inside KOOK the press that leaves this screen is also the sign-in: KOOK asks the player for their
    // authorisation (or already has it) and the fight begins once they have answered, whatever the answer.
    if (kook.state === 'ready') {
      if (!this.asked) {
        this.asked = true
        this.polls = 0
        shared.sfx.unlock()
        void kook.authorize().then(() => this.enter())
        return
      }
      // The press that asked is read once more with the next input poll: that is not a second press. A later one
      // goes ahead without waiting for the answer.
      if (kook.auth === 'asking' && this.polls < 2) return
    } else if (kook.state === 'connecting') void kook.authorize()
    this.enter()
  }
  private enter() {
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
    if (this.asked) this.polls++
    if (shared.input.anyPressed) this.startGame()
    const time = t / 1000
    this.bd.update(this.cameras.main, time)
  }
}
