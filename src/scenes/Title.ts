import * as Phaser from 'phaser';
import { TEST_MODE } from '../config';
import { Backdrop } from '../art/stage';
import { shared } from './Battle';

export class Title extends Phaser.Scene {
  private bd!: Backdrop; private gone = false;
  constructor() { super('Title'); }
  create() {
    if (TEST_MODE) { this.scene.start('Battle'); return; }
    this.gone = false;
    this.bd = new Backdrop(this, 3000);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.filters.external.addVignette(0.5, 0.5, 0.9, 0.5);
    const font = 'Impact, "Arial Black", sans-serif', ui = '"Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    const hud = (x: number, y: number, s: string, size: number, color: string, f = ui) =>
      this.add.text(x, y, s, { fontFamily: f, fontSize: `${size}px`, color }).setScrollFactor(0).setDepth(200).setShadow(0, 3, '#000', 10, false, true);
    hud(1000, 270, 'VANTA', 190, '#ffffff', font).setLetterSpacing(12).setFontStyle('italic');
    this.add.rectangle(1016, 520, 560, 3, 0x58c2ff).setOrigin(0, 0.5).setScrollFactor(0).setDepth(200);
    hud(1016, 540, '高 速 斩 击 · 完 美 闪 避 · 处 决', 30, '#bfe6ff').setLetterSpacing(4);
    hud(1016, 640, 'A / D 移动    空格 跳跃    J 轻击    I 重击\nO 冲刺    L 处决    U 能量斩    Esc 暂停', 24, '#bfe9f2').setLineSpacing(14);
    const start = hud(1016, 790, '按任意键开始', 36, '#ffffff').setLetterSpacing(10);
    this.tweens.add({ targets: start, alpha: 0.35, duration: 800, yoyo: true, repeat: -1 });
    const go = () => {
      if (this.gone) return; this.gone = true;
      shared.sfx.unlock(); shared.sfx.play('ui');
      this.cameras.main.fadeOut(350, 3, 5, 10);
      this.time.delayedCall(380, () => { this.cameras.main.filters.external.clear(); this.scene.start('Battle', { arena: 0 }); });
    };
    this.input.keyboard?.once('keydown', go);
    this.input.once('pointerdown', go);
  }
  update(t: number) {
    if (!this.bd) return;
    const time = t / 1000;
    this.bd.update(this.cameras.main, time);
  }
}
