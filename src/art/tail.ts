import * as Phaser from 'phaser';
import { ORIGIN, SS } from './textures';

/** Verlet ribbon (scarf / cape) drawn with tapered segment sprites. */
export class Tail {
  pts: { x: number; y: number; px: number; py: number }[] = [];
  segs: Phaser.GameObjects.Image[] = [];
  constructor(scene: Phaser.Scene, n: number, public segLen: number, public width: number, c0: number, c1: number, depth: number) {
    for (let i = 0; i <= n; i++) this.pts.push({ x: 0, y: 0, px: 0, py: 0 });
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const col = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.IntegerToColor(c0), Phaser.Display.Color.IntegerToColor(c1), 100, t * 100);
      this.segs.push(scene.add.image(0, 0, 'seg').setOrigin(ORIGIN.seg[0], 0.5).setDepth(depth).setTint(Phaser.Display.Color.GetColor(col.r, col.g, col.b)).setAlpha(1 - t * 0.35));
    }
  }
  reset(x: number, y: number) { for (const p of this.pts) { p.x = p.px = x; p.y = p.py = y; } }
  update(ax: number, ay: number, dir: number, t: number) {
    const pts = this.pts;
    if (Math.abs(ax - pts[0].x) + Math.abs(ay - pts[0].y) > 260) this.reset(ax, ay); // teleports
    pts[0].x = ax; pts[0].y = ay;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * 0.86, vy = (p.y - p.py) * 0.86;
      p.px = p.x; p.py = p.y;
      p.x += vx - dir * 0.75 + Math.sin(t * 5 + i * 0.9) * 0.35;
      p.y += vy + 0.55;
    }
    for (let k = 0; k < 3; k++) for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001, f = this.segLen / d;
      b.x = a.x + dx * f; b.y = a.y + dy * f;
    }
    const n = this.segs.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1], s = this.segs[i];
      s.setPosition(a.x, a.y); s.rotation = Math.atan2(b.y - a.y, b.x - a.x);
      s.setScale((this.segLen + 5) / (38 * SS), (this.width / (13 * SS)) * (1 - (i / n) * 0.6));
    }
  }
  setVisible(v: boolean) { for (const s of this.segs) s.setVisible(v); }
  setAlpha(a: number) { const n = this.segs.length; this.segs.forEach((s, i) => s.setAlpha(a * (1 - (i / (n - 1)) * 0.35))); }
  destroy() { for (const s of this.segs) s.destroy(); }
}
