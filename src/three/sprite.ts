import * as Phaser from 'phaser';
import type { PoseRef } from '../art/anims';
import type { Puppet } from './stage3d';

/** The drone is a single sprite; it implements the same drawing contract as the 3D bodies. */
export class SpritePuppet implements Puppet {
  hand = { x: 0, y: 0 }; neck = { x: 0, y: -60 }; tip = { x: 0, y: 0 };
  x = 0; y = 0; alpha = 1; facing = 1; squash = 0; extraRot = 0; spin = 0; rest = 0; mirror = false; reverseGrip = false; heightPx = 70; widthPx = 90;
  im: Phaser.GameObjects.Image;
  constructor(scene: Phaser.Scene, key: string, scale: number, depth: number) { this.im = scene.add.image(0, 0, key).setScale(scale).setDepth(depth); }
  apply(_p: PoseRef) {}
  setPos(x: number, y: number, facing: number) { this.x = x; this.y = y; this.facing = facing; this.im.setPosition(x, y).setFlipX(facing < 0); this.im.rotation = this.extraRot; }
  wx(v: number) { return this.x + v; }
  wy(v: number) { return this.y + v; }
  setFlash(color: number | null) { if (color === null) this.im.clearTint().setTintMode(Phaser.TintModes.MULTIPLY); else this.im.setTint(color).setTintMode(Phaser.TintModes.FILL); }
  setTintMul(color: number, power = 0.1) {
    // a sprite has no emissive surface: lean its multiply tint toward the colour by the same strength
    const k = Math.min(1, power * 4), mix = (shift: number) => Math.round(255 + (((color >> shift) & 255) - 255) * k);
    this.im.setTint((mix(16) << 16) | (mix(8) << 8) | mix(0)).setTintMode(Phaser.TintModes.MULTIPLY);
  }
  setRim(_color: number, _power: number) {}
  setAlpha(a: number) { this.alpha = a; this.im.setAlpha(a); }
  setVisible(v: boolean) { this.im.setVisible(v); }
  ghost() {}
  ghostAt() {}
  destroy() { this.im.destroy(); }
}
