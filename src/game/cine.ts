import { COL, GROUND_Y } from '../config';
import { A, Anim } from '../art/anims';
import { clamp, lerp, rand, smooth } from '../core/util';
import type { Enemy } from './enemies';
import type { Player } from './player';
import type { Fx } from './fx';
import type { Sfx } from '../audio/sfx';

export interface CamShot { x: number; y: number; zoom: number; rot: number }
export interface CineHost {
  fx: Fx; sfx: Sfx; player: Player; bounds: { l: number; r: number };
  cam: CamShot;                 // written by the cinematic every frame
  cineAmt: number;              // 0..1, drives letterbox + backdrop dim
  shake(amp: number, zoomPunch?: number): void;
  slowmo(scale: number, realFrames: number): void;
  onExecuted(target: Enemy): void;
}

type Style = 'cross' | 'pierce' | 'sunder' | 'storm';
const STYLE: Record<string, Style> = { grunt: 'cross', gunner: 'pierce', heavy: 'sunder', titan: 'storm', warden: 'storm', drone: 'pierce' };

/**
 * Execution set piece; the rest of the world is frozen while it plays.
 *
 *   (approach blink, only when far away) -> lock-on -> close-up strikes -> wide hold -> detonation + ripple
 *
 * The strikes differ per enemy type:
 *   cross  (grunt)          two crossing cuts from opposite sides
 *   pierce (gunner, drone)  a thrust clean through, then a rising cut that lifts the target
 *   sunder (heavy)          a leap above the target and a single vertical cleave into the floor
 *   storm  (titan, warden)  a flurry from both sides, finished by the vertical cleave
 *
 * The camera never cuts and never tilts: every shot is a fast glide to a new position and zoom. The whole
 * piece plays below real time, slower again for the hold, and slowest after the detonation so the eye
 * can recover before control returns.
 */
export class ExecCine {
  t = 0; done = false;
  /** playback speed; also applied to effects by the host */
  rate = 1;
  private clock = 0;
  private dir: number;
  private tx: number; private ty: number; private gy: number; private ty0: number;
  private flash = 0;
  private goal: CamShot;
  private ev: (() => void)[][] = [];
  private lines: [number, number][] = [];
  private boom = 0; private end = 0; private holdAt = 0;
  // approach blink
  private pre = 0; private fx0 = 0; private fy0 = 0;
  private style: Style;

  constructor(private w: CineHost, private target: Enemy, public quick: boolean) {
    const p = w.player;
    this.dir = Math.sign(target.x - p.x) || p.facing;
    this.tx = target.x; this.ty = target.cy; this.ty0 = target.y;
    this.gy = target.flying ? Math.min(GROUND_Y, target.y + 40) : target.y;
    this.style = STYLE[target.kind] ?? 'cross';
    this.goal = { ...w.cam };
    p.cine = true; p.vx = p.vy = 0; p.invuln = 999; p.move = null;
    this.fx0 = p.x; this.fy0 = p.y;
    const far = Math.abs(target.x - p.x) > 330 || Math.abs(this.gy - p.y) > 150;
    this.pre = far ? (quick ? 6 : 9) : 0;
    w.sfx.play('exStart');
    w.fx.ring(this.tx, this.ty, COL.main, 420, 50, 0.22);
    if (far) {
      // same language as the dodge: the body is gone, hairlines mark where it went
      const b = w.bounds, ex = clamp(this.tx - this.dir * 130 * (target.h > 250 ? 1.5 : 1), b.l + 40, b.r - 40);
      p.blinkTrail(p.x, p.y, ex, this.gy); p.hidden = true; w.sfx.play('dash');
    }
    this.build(this.pre);
  }

  /* ----------------------------- helpers ----------------------------- */

  private at(t: number, fn: () => void) { (this.ev[t] ??= []).push(fn); }
  /** Aim the camera; it stays upright in every shot, only position and zoom move. */
  private cam(x: number, y: number, zoom: number) { const g = this.goal; g.x = x; g.y = y; g.zoom = zoom; g.rot = 0; }
  private place(offset: number, facing: number, lift = 0, anim?: Anim) {
    const p = this.w.player, b = this.w.bounds;
    this.w.fx.ghost(p.rig, COL.main, 0.9, 0.38);
    p.x = p.px = clamp(this.tx + this.dir * offset, b.l + 40, b.r - 40);
    p.y = p.py = this.gy - lift; p.facing = facing; p.hidden = false;
    if (anim) p.an.play(anim, 1, true);
  }
  private cut(ang: number, len: number, thick: number, shake = 15) {
    const fx = this.w.fx;
    fx.cut(this.tx, this.ty, ang, len, COL.main, 0.3, thick);
    fx.weld(this.tx, this.ty, ang, 30, 1.3, this.gy, 0.3); fx.weld(this.tx, this.ty, ang + Math.PI, 30, 1.3, this.gy, 0.3);
    fx.seam(this.tx, this.ty, ang, 240, 1.2);
    fx.glint(this.tx, this.ty, 0xffffff, 0.5, 0.16);
    fx.screenFlash(0xffffff, 0.12, 0.06);
    this.lines.push([ang, len]);
    this.flash = 4; this.target.x = this.tx + (rand() < 0.5 ? -9 : 9);
    this.w.shake(shake, 0.03); this.w.sfx.play('exCut');
  }
  private glint() {
    const p = this.w.player, fx = this.w.fx;
    fx.glint(p.rig.wx(p.rig.hand.x), p.rig.wy(p.rig.hand.y), COL.main, 0.55, 0.3); this.w.sfx.play('exGlint');
  }

  /* ----------------------------- timeline ----------------------------- */

  private build(t0: number) {
    const d = this.dir, fx = this.w.fx, q = this.quick, big = this.target.h > 250;
    const R = big ? 1.5 : 1;             // stand further from big bodies
    const Z = big ? 0.72 : 1;            // and frame them wider
    // lock-on
    this.at(t0, () => {
      this.place(-130 * R, d, 0, A.exDraw);
      fx.ring(this.tx, this.ty, 0xffffff, 260, 30, 0.18); fx.screenFlash(COL.main, 0.08, 0.15);
      this.cam(lerp(this.w.player.x, this.tx, 0.5), this.ty - 20, (q ? 1.7 : 1.5) * Z);
    });
    if (!q) this.at(t0 + 4, () => this.glint());
    let t = t0 + (q ? 5 : 10);

    const cleave = (at: number) => {
      // from above, straight down through the target
      this.at(at, () => { this.place(-20, d, 250 * R, A.leapUp); this.cam(this.tx, this.ty - 130 * R, 1.9 * Z); });
      this.at(at + 3, () => this.glint());
      this.at(at + 8, () => { this.place(50 * R, d, 0, A.exSlam); this.cam(this.tx + d * 20, this.ty + 10, 2.3 * Z); });
      this.at(at + 10, () => {
        this.cut(Math.PI / 2, 1500, 1.6, 24);
        fx.pillar(this.tx, this.gy, COL.main, 900, 0.3, 0.3); fx.ring(this.tx, this.gy, COL.main, 40, 360, 0.36, 0.26); fx.weld(this.tx, this.gy, -Math.PI / 2, 40, 1.4, this.gy, 1.2);
        fx.dust(this.tx, this.gy, 1, 8); fx.dust(this.tx, this.gy, -1, 8); this.w.sfx.play('slam');
      });
      return at + 18;
    };

    if (this.style === 'cross') {
      this.at(t, () => { this.place(150, d, 0, A.exCutA); this.cam(this.tx + d * 10, this.ty, 2.6); });
      this.at(t + 2, () => { this.cut(-0.5 * d, 1100, 1.3); fx.slash(this.tx, this.ty, 'slash_wide', -0.4, 1.4, d, COL.main, { sy: 0.55, life: 0.3 }); });
      if (!q) {
        this.at(t + 10, () => { this.place(-130, -d, 0, A.exCutB); this.cam(this.tx - d * 30, this.ty - 10, 2.2); });
        this.at(t + 12, () => { this.cut(0.62 * d + Math.PI, 1100, 1.3); fx.slash(this.tx, this.ty, 'slash', 0.5, 1.4, -d, COL.main, { life: 0.3 }); });
        this.at(t + 15, () => this.cut(-1.35 * d, 800, 1.0, 10));
      }
      t += q ? 7 : 20;
    } else if (this.style === 'pierce') {
      this.at(t, () => { this.place(170, d, 0, A.exThrust); this.cam(this.tx + d * 30, this.ty + 10, 2.7); });
      this.at(t + 2, () => { this.cut(d > 0 ? 0 : Math.PI, 1500, 1.5); fx.ring(this.tx, this.ty, COL.main, 20, 220, 0.25, 1); });
      if (!q) {
        // rising cut from behind lifts the target off its feet
        this.at(t + 10, () => { this.place(70, -d, 0, A.exRise); this.cam(this.tx, this.ty - 40, 2.2); });
        this.at(t + 12, () => {
          this.target.y = this.ty0 - 60; this.ty -= 60;
          this.cut(-Math.PI / 2 + 0.35 * d, 1100, 1.3);
          fx.slash(this.tx, this.ty + 30, 'slash', -0.5, 1.3, -d, COL.main, { flipY: true, life: 0.3 });
        });
      }
      t += q ? 7 : 20;
    } else if (this.style === 'sunder') {
      t = cleave(t);
    } else {
      // storm: alternating sides, the camera rocking with every cut
      const n = q ? 3 : 6;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? -1 : 1, a = [-0.5, 0.65, -1.2, 0.2, 1.25, -0.15][i] * d;
        this.at(t + i * 3, () => {
          this.place(170 * R * side, d * side, i % 3 === 1 ? 90 : 0, i % 2 ? A.exCutB : A.exCutA);
          this.cam(this.tx + side * 26, this.ty - 10 + (i % 3) * 14, (2.0 + i * 0.05) * Z);
        });
        this.at(t + i * 3 + 1, () => this.cut(a + (side < 0 ? Math.PI : 0), 1200, 1.1, 12));
      }
      t += n * 3 + 2;
      if (!q) t = cleave(t);
    }

    // wide hold: pass through and settle into the finishing stance
    this.holdAt = t;
    this.at(t, () => {
      const p = this.w.player, from = p.x;
      this.place(220 * R, d, 0, A.exEnd);
      this.cam(lerp(this.tx, p.x, 0.5), this.ty - 30, (q ? 1.6 : 1.42) * Z);
      fx.cut((from + p.x) / 2, this.ty + 6, 0, Math.abs(p.x - from) + 500, COL.main, 0.4, 1.1);
      fx.screenFlash(0xffffff, 0.1, 0.06); this.w.sfx.play('exCut'); this.flash = 3; this.w.shake(14);
      const hold = 0.5;
      for (const [a, l] of this.lines) fx.cut(this.tx, this.ty, a, l * 0.45, COL.pink, hold, 0.5);
    });
    this.at(t + 4, () => this.glint());
    this.boom = t + (q ? 7 : 10);
    this.end = this.boom + (q ? 5 : 8);
    this.at(this.boom, () => this.detonate());
  }

  private detonate() {
    const fx = this.w.fx, p = this.w.player, tg = this.target, boss = tg.isBoss, big = tg.h > 250;
    for (const [a, l] of this.lines) { fx.cut(this.tx, this.ty, a, l * 1.4, COL.main, 0.4, 0.7); fx.weld(this.tx, this.ty, a, 22, 1.5, this.gy, 0.35); fx.weld(this.tx, this.ty, a + Math.PI, 22, 1.5, this.gy, 0.35); }
    // light stays small and sharp: a pinpoint core, hairline pillars, and a lot of hot sparks
    fx.flash(this.tx, this.ty, COL.pink, big ? 0.7 : 0.5, 0.16);
    fx.pillar(this.tx, this.gy, COL.main, 1100, 0.45, 0.2); fx.pillar(this.tx - 60, this.gy, COL.pinkDeep, 800, 0.32, 0.08); fx.pillar(this.tx + 60, this.gy, COL.pinkDeep, 800, 0.32, 0.08);
    fx.shards(this.tx, this.ty, big ? 44 : 24, COL.main, 1.5); fx.weld(this.tx, this.ty, -Math.PI / 2, big ? 110 : 70, 1.6, this.gy, 3.2);
    fx.screenFlash(0xe8f0ff, 0.2, 0.18);
    // the signature: the picture itself ripples outward from the player, slowly at first, then racing away
    fx.ripple(p.cx, p.cy, 2300, 1.5, 1);
    fx.ripple(p.cx, p.cy, 2300, 1.5, 0.8, 0.2);
    this.w.shake(boss || big ? 46 : 36, 0.09); this.w.sfx.play('exBoom');
    tg.x = this.tx; tg.y = this.ty0; tg.flashT = 0;
    tg.executed(this.dir);
    this.w.onExecuted(tg);
  }

  /* ----------------------------- per logic frame ----------------------------- */

  update() {
    const w = this.w, c = w.cam, g = this.goal, d = this.dir;
    // camera whips to its goal in about four frames, then keeps drifting in
    const k = 0.3;
    c.x = lerp(c.x, g.x, k); c.y = lerp(c.y, g.y, k); c.zoom = lerp(c.zoom, g.zoom, k); c.rot = lerp(c.rot, g.rot, k);
    g.zoom *= 1 + 0.0035 * this.rate; g.x += d * 0.5 * this.rate;
    // playback speed: normal through the strikes, slower for the hold, slowest after the detonation
    this.rate = this.t > this.boom ? 0.28 : this.t >= this.holdAt && this.holdAt > 0 ? 0.5 : this.t < this.pre ? 1 : 0.7;
    w.cineAmt = this.t >= this.boom ? Math.max(0, w.cineAmt - 0.05) : Math.min(1, w.cineAmt + (this.quick ? 0.25 : 0.14));
    this.clock += this.rate;
    while (this.clock >= 1 && !this.done) { this.clock -= 1; this.frame(); }
  }

  private frame() {
    const w = this.w, p = w.player, tg = this.target, t = this.t;
    if (this.flash > 0) { this.flash--; tg.flashT = this.flash > 0 ? 2 : 0; if (!this.flash) tg.x = this.tx; }
    if (t < this.pre) {
      // approach: the camera travels; the body only reappears at the target
      const e = smooth((t + 1) / this.pre), b = w.bounds;
      const ex = clamp(this.tx - this.dir * 130 * (tg.h > 250 ? 1.5 : 1), b.l + 40, b.r - 40);
      const nx = lerp(this.fx0, ex, e), ny = lerp(this.fy0, this.gy, e);
      p.x = p.px = nx; p.y = p.py = ny; p.facing = this.dir;
      if (t % 3 === 1) { p.rig.setPos(nx, ny, this.dir); w.fx.ghost(p.rig, t % 2 ? COL.main : COL.pinkDeep, 0.3, 0.24); }
      this.cam(lerp(nx, this.tx, 0.6), lerp(ny, this.ty, 0.5) - 20, 1.25);
    }
    for (const fn of this.ev[t] ?? []) fn();
    p.rig.apply(p.an.update(1));
    this.t++;
    if (this.t >= this.end) {
      p.cine = false; p.hidden = false; p.invuln = 55; p.state = 'free'; p.st = 0; p.an.play(A.idle, 12);
      w.cineAmt = 0; this.done = true;
      w.slowmo(0.45, 26);
    }
  }
}

