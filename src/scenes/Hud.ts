import * as Phaser from 'phaser';
import { COL, VIEW_H, VIEW_W } from '../config';
import { clamp, damp } from '../core/util';
import { SPECIAL_COST } from '../game/player';
import type { Battle } from './Battle';

const FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const DISPLAY = 'Impact, "Arial Black", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Overlay scene: bars, combo, prompts, banners, letterbox, pause / result screens. */
export class Hud extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private hpLag = 1; private bossLag = 1;
  private comboTxt!: Phaser.GameObjects.Text; private comboLbl!: Phaser.GameObjects.Text; private lastCombo = 0; private comboPop = 0;
  private name!: Phaser.GameObjects.Text; private wave!: Phaser.GameObjects.Text;
  private bossName!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text; private go!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text; private bannerSub!: Phaser.GameObjects.Text;
  private veil!: Phaser.GameObjects.Rectangle; private big!: Phaser.GameObjects.Text; private body!: Phaser.GameObjects.Text;
  private barT!: Phaser.GameObjects.Rectangle; private barB!: Phaser.GameObjects.Rectangle;

  constructor() { super('Hud'); }

  create() {
    const t = (x: number, y: number, size: number, color = '#ffffff', font = FONT) =>
      this.add.text(x, y, '', { fontFamily: font, fontSize: `${size}px`, color }).setShadow(0, 2, '#000000', 6, false, true);
    this.barT = this.add.rectangle(VIEW_W / 2, 0, VIEW_W, 130, 0x000000).setOrigin(0.5, 1);
    this.barB = this.add.rectangle(VIEW_W / 2, VIEW_H, VIEW_W, 130, 0x000000).setOrigin(0.5, 0);
    this.g = this.add.graphics();
    this.name = t(70, 40, 22, '#bfe6ff').setText('VANTA  //  UNIT-07').setLetterSpacing(3);
    this.wave = t(VIEW_W / 2, 44, 22, '#bfe9f2').setOrigin(0.5, 0).setLetterSpacing(4);
    this.bossName = t(VIEW_W / 2, VIEW_H - 118, 24, '#ffc8b0').setOrigin(0.5, 0).setLetterSpacing(6);
    this.comboTxt = t(VIEW_W - 90, 250, 120, '#ffffff', DISPLAY).setOrigin(1, 0.5).setFontStyle('italic').setStroke('#0a0d16', 8);
    this.comboLbl = t(VIEW_W - 88, 320, 28, '#ff9fe6').setOrigin(1, 0.5).setText('HITS').setLetterSpacing(8);
    this.prompt = t(VIEW_W / 2, VIEW_H - 210, 34, '#bfe6ff').setOrigin(0.5).setLetterSpacing(4);
    this.go = t(VIEW_W - 90, VIEW_H / 2, 54, '#bfe6ff', DISPLAY).setOrigin(1, 0.5).setText('GO ▶').setFontStyle('italic');
    this.banner = t(VIEW_W / 2, 330, 84, '#ffffff', DISPLAY).setOrigin(0.5).setLetterSpacing(14);
    this.bannerSub = t(VIEW_W / 2, 400, 26, '#bfe9f2').setOrigin(0.5).setLetterSpacing(8);
    this.veil = this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x03050a).setAlpha(0);
    this.big = t(VIEW_W / 2, 330, 110, '#ffffff', DISPLAY).setOrigin(0.5).setLetterSpacing(18);
    this.body = t(VIEW_W / 2, 440, 30, '#d6eef5').setOrigin(0.5, 0).setAlign('center').setLineSpacing(16);
  }

  private bar(x: number, y: number, w: number, h: number, v: number, color: number, lag = -1, skew = 14) {
    const g = this.g;
    const quad = (x0: number, x1: number, c: number, a: number) => {
      if (x1 <= x0) return;
      g.fillStyle(c, a);
      g.fillPoints([{ x: x0 + skew, y }, { x: x1 + skew, y }, { x: x1, y: y + h }, { x: x0, y: y + h }] as any, true);
    };
    quad(x - 4, x + w + 4, 0x05070c, 0.7);
    quad(x, x + w, 0x1b2535, 0.9);
    if (lag >= 0) quad(x, x + w * clamp(lag, 0, 1), 0xffffff, 0.85);
    quad(x, x + w * clamp(v, 0, 1), color, 1);
    g.fillStyle(0xffffff, 0.25); g.fillPoints([{ x: x + skew, y }, { x: x + skew + w * clamp(v, 0, 1), y }, { x: x + skew * 0.6 + w * clamp(v, 0, 1), y: y + h * 0.4 }, { x: x + skew * 0.6, y: y + h * 0.4 }] as any, true);
  }

  update(_t: number, dms: number) {
    const b = this.scene.get('Battle') as Battle;
    if (!b || !b.player) return;
    const p = b.player, g = this.g, now = this.time.now / 1000, dt = dms / 1000;
    g.clear();
    const live = !b.cine && !b.over;

    // letterbox
    const c = b.cineAmt;
    this.barT.y = 110 * c; this.barB.y = VIEW_H - 110 * c;
    const ui = 1 - c;
    for (const o of [this.name, this.wave, this.comboTxt, this.comboLbl, this.go, this.bossName]) o.setAlpha(ui);
    g.setAlpha(ui);

    // player bars
    const hp = p.hp / p.maxHp;
    this.hpLag = hp > this.hpLag ? hp : Math.max(hp, this.hpLag - dt * 0.35);
    this.bar(70, 74, 520, 22, hp, hp < 0.3 ? COL.hostile : 0xf2f6ff, this.hpLag);
    const en = p.energy / p.maxEnergy;
    this.bar(64, 104, 360, 10, en, p.energy >= SPECIAL_COST ? COL.main : 0x3a5f80, -1, 6);
    g.fillStyle(0x05070c, 0.9);
    for (let i = 1; i < 5; i++) g.fillRect(64 + 360 * (i * SPECIAL_COST / 2) / p.maxEnergy + 3, 104, 2, 10);

    // wave
    this.wave.setText(b.waveInfo ? `波次  ${b.waveInfo}` : '');

    // boss
    const boss = b.boss && !b.boss.gone ? b.boss : null;
    this.bossName.setVisible(!!boss);
    if (boss) {
      const v = clamp(boss.hp / boss.maxHp, 0, 1);
      this.bossLag = Math.max(v, this.bossLag - dt * 0.2);
      this.bossName.setText('典狱者  WARDEN');
      this.bar(VIEW_W / 2 - 520, VIEW_H - 80, 1040, 18, v, COL.hostile, this.bossLag);
      this.bar(VIEW_W / 2 - 400, VIEW_H - 54, 800, 7, boss.broken > 0 ? 0 : boss.posture / boss.maxPosture, COL.main, -1, 5);
    } else this.bossLag = 1;

    // combo
    if (b.comboN !== this.lastCombo) { if (b.comboN > this.lastCombo) this.comboPop = 1; this.lastCombo = b.comboN; }
    this.comboPop = Math.max(0, this.comboPop - dt * 6);
    const showCombo = b.comboN >= 2;
    this.comboTxt.setVisible(showCombo).setText(String(b.comboN)).setScale(1 + this.comboPop * 0.35)
      .setColor(b.comboN >= 50 ? '#ff7a9a' : b.comboN >= 20 ? '#ff9fe6' : '#ffffff');
    this.comboLbl.setVisible(showCombo);
    if (showCombo) { g.fillStyle(COL.main, 0.9 * ui); g.fillRect(VIEW_W - 90 - 220 * (b.comboT / 170), 344, 220 * (b.comboT / 170), 4); }

    // prompts
    let pr = '';
    if (live && b.execReady) pr = '[ L ]   处 决';
    else if (live && b.anchor) pr = '[ O ]   锚 点';
    this.prompt.setText(pr).setVisible(!!pr).setScale(1 + Math.sin(now * 12) * 0.04).setColor('#bfe6ff').setAlpha(pr.includes('锚') ? 0.6 : 1);
    this.go.setVisible(b.goHint && live).setX(VIEW_W - 90 + Math.sin(now * 6) * 12);

    // banner
    const bn = b.banner;
    if (bn) {
      const a = clamp(Math.min(bn.t / 20, 1), 0, 1);
      this.banner.setText(bn.text).setAlpha(a * ui).setVisible(true); this.bannerSub.setText(bn.sub).setAlpha(a * ui).setVisible(true);
      g.fillStyle(COL.main, 0.8 * a * ui); g.fillRect(VIEW_W / 2 - 260, 384, 520, 2);
    } else { this.banner.setVisible(false); this.bannerSub.setVisible(false); }

    // low-hp pulse
    if (hp < 0.3 && !b.over) { g.fillStyle(0xff2040, 0.06 + Math.sin(now * 5) * 0.04); g.fillRect(0, 0, VIEW_W, VIEW_H); }

    // overlays
    let veil = 0, big = '', body = '';
    if (b.paused) {
      veil = 0.72; big = '暂 停';
      body = 'A / D  移动        空格  跳跃（空中再按一次二段跳）\nJ  轻攻击（连按五段）        I  重攻击（连按三段，↑ + I 挑空）\nO / Shift  闪避（八方向瞬移）—— 在敌人攻击即将命中的瞬间闪避 = 极限闪避：免伤并反伤攻击者；附近有锚点时闪到锚点\nL  处决（敌人头顶出现金色准星时，全屏任意距离可发动）        U  能量斩\n\nEsc / P  继续';
    } else if (b.over === 'dead') {
      veil = 0.6; big = '信号中断';
      body = '按任意键，从当前封锁区重新接入';
    } else if (b.over === 'win') {
      veil = 0.66; big = '肃清完成';
      const s = Math.floor(b.clock), rank = p.damageTaken < 40 && b.maxCombo >= 60 ? 'S' : p.damageTaken < 90 ? 'A' : p.damageTaken < 160 ? 'B' : 'C';
      body = `用时  ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}        最高连击  ${b.maxCombo}\n处决  ${b.execs}        承受伤害  ${Math.round(p.damageTaken)}\n\n评价   ${rank}\n\n按任意键重新开始`;
    }
    this.veil.setAlpha(damp(this.veil.alpha, veil, 10, dt));
    this.big.setText(big).setVisible(!!big); this.body.setText(body).setVisible(!!body);
  }
}
