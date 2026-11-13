import * as Phaser from 'phaser';
import { CAM_REST_Y, DEPTH, GROUND_Y, VIEW_H, VIEW_W } from '../config';
import { rng } from '../core/util';
import { tex } from './textures';

const TILE = 2048;

/** Draw something twice so it wraps cleanly across the tile seam. */
function wrap(x: number, w: number, fn: (x: number) => void) {
  fn(x);
  if (x + w > TILE) fn(x - TILE);
  if (x < 0) fn(x + TILE);
}

export function buildStage(scene: Phaser.Scene) {
  // ---- sky
  tex(scene, 'sky', VIEW_W, VIEW_H, 0, 0, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, VIEW_H);
    gr.addColorStop(0, '#060a1e'); gr.addColorStop(0.24, '#0c1c42'); gr.addColorStop(0.5, '#15406a');
    gr.addColorStop(0.66, '#2b7890'); gr.addColorStop(0.75, '#66b8b0'); gr.addColorStop(0.85, '#1d4a5c'); gr.addColorStop(1, '#081019');
    g.fillStyle = gr; g.fillRect(0, 0, VIEW_W, VIEW_H);
    const r = rng(7);
    for (let i = 0; i < 260; i++) {
      const y = 120 + r() * 520, a = (1 - (y - 120) / 560) * (0.25 + r() * 0.75);
      g.fillStyle = `rgba(${200 + r() * 55},${220 + r() * 35},255,${a})`;
      const s = r() < 0.08 ? 2.2 : 1.1; g.fillRect(r() * VIEW_W, y, s, s);
    }
    // the shattered moon
    const mx = 1300, my = 390, mr = 215;
    const halo = g.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 2.2);
    halo.addColorStop(0, 'rgba(120,210,230,0.28)'); halo.addColorStop(1, 'rgba(120,210,230,0)');
    g.fillStyle = halo; g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.save();
    g.beginPath(); g.arc(mx, my, mr, 0, 7); g.clip();
    const mg = g.createRadialGradient(mx - 130, my - 140, 30, mx, my, mr * 1.15);
    mg.addColorStop(0, '#e6f4f2'); mg.addColorStop(0.35, '#9fc9cf'); mg.addColorStop(0.75, '#3d7189'); mg.addColorStop(1, '#16304a');
    g.fillStyle = mg; g.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    for (let i = 0; i < 46; i++) {
      const a = r() * 7, d = Math.sqrt(r()) * mr, cr = 6 + r() * 38;
      g.fillStyle = `rgba(20,50,80,${0.05 + r() * 0.12})`;
      g.beginPath(); g.ellipse(mx + Math.cos(a) * d, my + Math.sin(a) * d, cr, cr * 0.8, r() * 3, 0, 7); g.fill();
    }
    // fracture: a glowing wound across the disc
    g.strokeStyle = 'rgba(255,214,150,0.95)'; g.shadowColor = '#ffb040'; g.shadowBlur = 26; g.lineWidth = 5;
    g.beginPath(); g.moveTo(mx + 60, my - mr); g.lineTo(mx + 8, my - 86); g.lineTo(mx + 50, my - 22); g.lineTo(mx - 14, my + 64); g.lineTo(mx + 22, my + mr); g.stroke();
    g.lineWidth = 2.5; g.beginPath(); g.moveTo(mx + 50, my - 22); g.lineTo(mx + 136, my + 14); g.lineTo(mx + 172, my + 80); g.stroke();
    g.beginPath(); g.moveTo(mx + 8, my - 86); g.lineTo(mx - 86, my - 108); g.stroke();
    g.restore();
    // debris arc
    for (let i = 0; i < 120; i++) {
      const t = r(), a = -0.62 + t * 1.5, rad = mr * (1.25 + r() * 0.22);
      const x = mx + Math.cos(a) * rad * 1.5 - 40, y = my + Math.sin(a) * rad * 0.42 + 40;
      const s = 1 + r() * r() * 9;
      g.fillStyle = `rgba(${150 + r() * 80},${200 + r() * 40},${215 + r() * 30},${0.35 + r() * 0.5})`;
      g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 1.3, y); g.lineTo(x + s * 0.2, y + s * 0.8); g.lineTo(x - s, y + s * 0.2); g.closePath(); g.fill();
    }
    // high cloud bands
    g.save(); g.filter = 'blur(28px)';
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(110,190,205,${0.05 + r() * 0.07})`;
      g.beginPath(); g.ellipse(r() * VIEW_W, 520 + r() * 250, 300 + r() * 500, 14 + r() * 26, 0, 0, 7); g.fill();
    }
    g.restore();
  }, 1);

  // ---- far megastructures (hazy)
  tex(scene, 'bg_far', TILE, 640, 0, 0, (g) => {
    const r = rng(21), H = 640;
    const fill = g.createLinearGradient(0, 0, 0, H);
    fill.addColorStop(0, '#2f6f86'); fill.addColorStop(0.55, '#245a73'); fill.addColorStop(1, '#3d8793');
    g.fillStyle = fill;
    let x = 0;
    while (x < TILE) {
      const w = 50 + r() * 150, h = 140 + r() * r() * 470, gap = 10 + r() * 90;
      wrap(x, w, (X) => {
        const top = H - h;
        g.beginPath(); g.moveTo(X, H); g.lineTo(X, top + 24); g.lineTo(X + w * 0.18, top + 24); g.lineTo(X + w * 0.18, top + 8);
        g.lineTo(X + w * 0.42, top + 8); g.lineTo(X + w * 0.5, top - 40 * r()); g.lineTo(X + w * 0.58, top + 8); g.lineTo(X + w * 0.84, top + 14); g.lineTo(X + w, top + 40); g.lineTo(X + w, H); g.closePath(); g.fill();
      });
      x += w + gap;
    }
    // sky bridges
    g.fillStyle = '#2b6880';
    for (let i = 0; i < 5; i++) { const y = 250 + r() * 260, bx = r() * TILE, bw = 300 + r() * 500; wrap(bx, bw, (X) => { g.fillRect(X, y, bw, 7); g.fillRect(X, y + 12, bw, 2); }); }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = r() < 0.2 ? 'rgba(255,214,150,0.75)' : 'rgba(170,240,255,0.55)';
      g.fillRect(r() * TILE, 200 + r() * 430, 2, r() < 0.3 ? 5 : 2);
    }
    // haze so the layer sinks into the horizon
    const hz = g.createLinearGradient(0, 0, 0, H); hz.addColorStop(0, 'rgba(60,150,165,0)'); hz.addColorStop(1, 'rgba(95,176,170,0.55)');
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = hz; g.fillRect(0, 0, TILE, H);
  }, 1);

  // ---- mid city
  tex(scene, 'bg_mid', TILE, 800, 0, 0, (g) => {
    const r = rng(99), H = 800;
    let x = -40;
    while (x < TILE) {
      const w = 90 + r() * 210, h = 220 + r() * r() * 520, gap = -20 + r() * 110;
      const style = r();
      wrap(x, w + 20, (X) => {
        const top = H - h;
        const gr = g.createLinearGradient(X, 0, X + w, 0);
        gr.addColorStop(0, '#0d2233'); gr.addColorStop(0.75, '#12304a'); gr.addColorStop(1, '#1d4c66');
        g.fillStyle = gr;
        g.beginPath();
        if (style < 0.35) { g.moveTo(X, H); g.lineTo(X, top + 50); g.lineTo(X + w * 0.3, top); g.lineTo(X + w, top + 16); g.lineTo(X + w, H); }
        else if (style < 0.7) { g.moveTo(X, H); g.lineTo(X, top); g.lineTo(X + w * 0.7, top); g.lineTo(X + w * 0.7, top + 60); g.lineTo(X + w, top + 60); g.lineTo(X + w, H); }
        else { g.moveTo(X, H); g.lineTo(X + w * 0.12, top + 30); g.lineTo(X + w * 0.5, top); g.lineTo(X + w * 0.88, top + 30); g.lineTo(X + w, H); }
        g.closePath(); g.fill();
        // lit edge
        g.fillStyle = 'rgba(120,220,235,0.22)'; g.fillRect(X + w - 3, top + 62, 2, h);
      });
      // windows (deterministic per building, so draw unwrapped then wrapped copy)
      const seed = Math.floor(r() * 1e9);
      wrap(x, w, (X) => {
        const q = rng(seed), top = H - h + 70;
        const cols = Math.floor((w - 24) / 12), rows = Math.floor((h - 90) / 16);
        for (let c = 0; c < cols; c++) for (let rw = 0; rw < rows; rw++) {
          const v = q();
          if (v < 0.72) continue;
          g.fillStyle = v > 0.965 ? 'rgba(255,196,110,0.9)' : v > 0.9 ? 'rgba(150,240,255,0.75)' : 'rgba(90,170,200,0.35)';
          g.fillRect(X + 12 + c * 12, top + rw * 16, 6, v > 0.93 ? 9 : 4);
        }
        // antenna + beacon
        if (q() < 0.55) {
          const ax = X + w * (0.3 + q() * 0.4), ah = 40 + q() * 90;
          g.fillStyle = '#0d2233'; g.fillRect(ax, H - h - ah, 3, ah + 20);
          g.save(); g.shadowColor = '#ff5030'; g.shadowBlur = 12; g.fillStyle = '#ff6a8e'; g.beginPath(); g.arc(ax + 1.5, H - h - ah, 3, 0, 7); g.fill(); g.fill(); g.restore();
        }
        // vertical sign bars (abstract, no glyphs)
        if (q() < 0.4 && w > 120) {
          const sx = X + 14 + q() * (w - 50), sy = H - h + 90 + q() * 80, sh = 70 + q() * 120;
          g.save(); const warm = q() < 0.5; g.shadowColor = warm ? '#ffb040' : '#40e0ff'; g.shadowBlur = 16;
          g.fillStyle = warm ? 'rgba(255,205,130,0.9)' : 'rgba(150,240,255,0.9)';
          for (let yy = 0; yy < sh; yy += 14) g.fillRect(sx, sy + yy, 10, 8 + (q() < 0.3 ? -4 : 0));
          g.restore();
        }
      });
      x += w + gap;
    }
    const hz = g.createLinearGradient(0, 0, 0, H); hz.addColorStop(0, 'rgba(30,90,110,0)'); hz.addColorStop(0.7, 'rgba(40,110,125,0.12)'); hz.addColorStop(1, 'rgba(70,150,150,0.5)');
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = hz; g.fillRect(0, 0, TILE, H);
  }, 1);

  // ---- near gantries
  tex(scene, 'bg_near', TILE, 900, 0, 0, (g) => {
    const r = rng(404), H = 900;
    const col = (X: number, w: number, h: number) => {
      const gr = g.createLinearGradient(X, 0, X + w, 0); gr.addColorStop(0, '#070f1a'); gr.addColorStop(0.8, '#0b1a2a'); gr.addColorStop(1, '#16324a');
      g.fillStyle = gr; g.fillRect(X, H - h, w, h);
      g.fillStyle = '#0b1a2a'; g.fillRect(X - 10, H - h, w + 20, 16); g.fillRect(X - 6, H - h * 0.55, w + 12, 10);
      g.save(); g.shadowColor = '#40e0ff'; g.shadowBlur = 10; g.fillStyle = 'rgba(140,235,255,0.8)'; g.fillRect(X + w - 2, H - h + 20, 2, h * 0.5); g.restore();
      for (let y = H - h + 40; y < H - 30; y += 46) { g.fillStyle = 'rgba(3,7,12,0.7)'; g.fillRect(X + 6, y, w - 12, 3); }
      g.save(); g.shadowColor = '#ffb040'; g.shadowBlur = 12; g.fillStyle = 'rgba(255,205,130,0.95)'; g.fillRect(X + 8, H - h * 0.55 + 18, 14, 4); g.restore();
    };
    const xs: number[] = [];
    let x = 80;
    while (x < TILE - 200) { const w = 46 + r() * 50, h = 520 + r() * 340; wrap(x, w + 20, (X) => col(X, w, h)); xs.push(x + w / 2); x += 420 + r() * 380; }
    // overhead truss
    g.fillStyle = '#081320';
    g.fillRect(0, 60, TILE, 20); g.fillRect(0, 118, TILE, 8);
    g.strokeStyle = '#081320'; g.lineWidth = 5; g.beginPath();
    for (let tx = 0; tx <= TILE; tx += 64) { g.moveTo(tx, 80); g.lineTo(tx + 32, 118); g.lineTo(tx + 64, 80); }
    g.stroke();
    g.fillStyle = 'rgba(140,235,255,0.5)'; g.fillRect(0, 80, TILE, 1.5);
    // cables
    g.strokeStyle = '#060d16'; g.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      const a = r() * TILE, b = a + 260 + r() * 520, sag = 120 + r() * 260;
      wrap(a, b - a, (X) => { g.beginPath(); g.moveTo(X, 124); g.quadraticCurveTo(X + (b - a) / 2, 124 + sag, X + (b - a), 124); g.stroke(); });
    }
    // hanging lamps
    for (let i = 0; i < 6; i++) {
      const lx = 120 + r() * (TILE - 240), ly = 126 + 60 + r() * 90;
      g.fillStyle = '#060d16'; g.fillRect(lx - 1.5, 126, 3, ly - 126); g.fillRect(lx - 16, ly, 32, 9);
      g.save(); g.shadowColor = '#bdf4ff'; g.shadowBlur = 20; g.fillStyle = '#e8fdff'; g.fillRect(lx - 12, ly + 9, 24, 3); g.restore();
      const cone = g.createLinearGradient(0, ly + 12, 0, ly + 420); cone.addColorStop(0, 'rgba(170,240,255,0.16)'); cone.addColorStop(1, 'rgba(170,240,255,0)');
      g.fillStyle = cone; g.beginPath(); g.moveTo(lx - 12, ly + 12); g.lineTo(lx + 12, ly + 12); g.lineTo(lx + 130, ly + 420); g.lineTo(lx - 130, ly + 420); g.closePath(); g.fill();
    }
  }, 1);

  // ---- floor deck
  tex(scene, 'floor', 512, 200, 0, 0, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 200);
    gr.addColorStop(0, '#2c4458'); gr.addColorStop(0.06, '#1a2c3d'); gr.addColorStop(0.5, '#0c1622'); gr.addColorStop(1, '#04080d');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 200);
    // perspective plates
    g.strokeStyle = 'rgba(4,8,13,0.9)'; g.lineWidth = 2;
    for (const [y, a] of [[20, 0.9], [52, 0.8], [100, 0.7], [160, 0.6]] as const) { g.globalAlpha = a; g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    g.globalAlpha = 1;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 128 + 20, 0); g.lineTo(i * 128 - 10, 200); g.stroke(); }
    g.strokeStyle = 'rgba(120,200,230,0.10)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 128 + 22.5, 0); g.lineTo(i * 128 - 7.5, 200); g.stroke(); }
    // edge strip
    g.fillStyle = '#0a121c'; g.fillRect(0, 0, 512, 7);
    g.save(); g.shadowColor = '#40e0ff'; g.shadowBlur = 10; g.fillStyle = 'rgba(170,240,255,0.95)'; g.fillRect(0, 0, 512, 2); g.restore();
    // inset guide lights
    for (let i = 0; i < 4; i++) { g.save(); g.shadowColor = '#ffb040'; g.shadowBlur = 10; g.fillStyle = 'rgba(255,205,130,0.9)'; g.fillRect(i * 128 + 54, 30, 26, 3); g.restore(); }
    // vents
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(2,4,8,0.8)'; g.fillRect(300 + i * 9, 66, 5, 22); }
    const sheen = g.createLinearGradient(0, 8, 0, 60); sheen.addColorStop(0, 'rgba(120,220,240,0.13)'); sheen.addColorStop(1, 'rgba(120,220,240,0)');
    g.fillStyle = sheen; g.fillRect(0, 8, 512, 60);
  }, 1);

  // ---- floating platform (stretchable middle is baked per width in makePlatform)
  // ---- energy gate
  tex(scene, 'gate', 96, 512, 48, 0, (g) => {
    const gr = g.createLinearGradient(-48, 0, 48, 0);
    gr.addColorStop(0, 'rgba(255,61,110,0)'); gr.addColorStop(0.5, 'rgba(255,61,110,0.55)'); gr.addColorStop(1, 'rgba(255,61,110,0)');
    g.fillStyle = gr; g.fillRect(-48, 0, 96, 512);
    g.strokeStyle = 'rgba(255,190,205,0.85)'; g.lineWidth = 1.5;
    for (let y = -16; y < 540; y += 32) for (let c = -1; c <= 1; c++) {
      const cx = c * 28 + ((Math.round(y / 32) & 1) ? 14 : 0), cy = y;
      g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; const px = cx + Math.cos(a) * 15, py = cy + Math.sin(a) * 15; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.stroke();
    }
    g.globalCompositeOperation = 'destination-in';
    const m = g.createLinearGradient(-48, 0, 48, 0); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.5, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(-48, 0, 96, 512);
    g.globalCompositeOperation = 'source-over';
    g.save(); g.shadowColor = '#ff2a10'; g.shadowBlur = 14; g.fillStyle = '#ffd0da'; g.fillRect(-1.5, 0, 3, 512); g.restore();
  }, 1);

  // ---- foreground silhouettes
  tex(scene, 'fg_pillar', 260, 1080, 130, 0, (g) => {
    g.save(); g.filter = 'blur(5px)';
    g.fillStyle = '#02050a'; g.fillRect(-30, 0, 60, 1080); g.fillRect(-70, 0, 140, 50); g.fillRect(-52, 1010, 104, 70);
    g.strokeStyle = '#02050a'; g.lineWidth = 9; g.beginPath(); g.moveTo(-90, 20); g.quadraticCurveTo(-120, 500, -60, 1010); g.stroke();
    g.restore();
    g.save(); g.filter = 'blur(2px)'; g.fillStyle = 'rgba(120,220,240,0.25)'; g.fillRect(27, 60, 2.5, 940); g.restore();
  }, 1);

  tex(scene, 'fog', 64, 420, 0, 0, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 420);
    gr.addColorStop(0, 'rgba(110,200,205,0)'); gr.addColorStop(0.62, 'rgba(110,200,205,0.34)'); gr.addColorStop(0.75, 'rgba(110,200,205,0.2)'); gr.addColorStop(1, 'rgba(110,200,205,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 420);
  }, 1);
}

export function makePlatform(scene: Phaser.Scene, w: number): string {
  const key = `plat_${w}`;
  tex(scene, key, w + 40, 90, 20, 20, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 30); gr.addColorStop(0, '#34506a'); gr.addColorStop(0.2, '#1b2d40'); gr.addColorStop(1, '#0a121c');
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w - 14, 24); g.lineTo(w * 0.62, 24); g.lineTo(w * 0.58, 34); g.lineTo(w * 0.42, 34); g.lineTo(w * 0.38, 24); g.lineTo(14, 24); g.closePath();
    g.fillStyle = gr; g.fill(); g.strokeStyle = '#04080d'; g.lineWidth = 1.5; g.stroke();
    g.save(); g.shadowColor = '#40e0ff'; g.shadowBlur = 10; g.fillStyle = 'rgba(170,240,255,0.95)'; g.fillRect(0, 0, w, 2); g.restore();
    g.save(); g.shadowColor = '#ffb040'; g.shadowBlur = 14; g.fillStyle = 'rgba(255,205,130,0.95)'; g.fillRect(w * 0.44, 33, w * 0.12, 3); g.restore();
    const cone = g.createLinearGradient(0, 36, 0, 70); cone.addColorStop(0, 'rgba(255,200,120,0.3)'); cone.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(w * 0.44, 36); g.lineTo(w * 0.56, 36); g.lineTo(w * 0.62, 70); g.lineTo(w * 0.38, 70); g.closePath(); g.fill();
    for (let x = 30; x < w - 30; x += 46) { g.fillStyle = 'rgba(4,8,13,0.8)'; g.fillRect(x, 8, 22, 3); }
  });
  return key;
}

/** Parallax backdrop; all layers are camera-fixed tile sprites scrolled by hand. */
export class Backdrop {
  private layers: { ts: Phaser.GameObjects.TileSprite; f: number; y: number }[] = [];
  private filler!: Phaser.GameObjects.Rectangle;
  private motes: { im: Phaser.GameObjects.Image; x: number; y: number; z: number; ph: number }[] = [];
  dim: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, worldW: number) {
    const M = 500; // overscan so cinematic zoom/rotation never shows an edge
    const W = VIEW_W + M * 2;
    scene.add.image(VIEW_W / 2, VIEW_H / 2, 'sky').setScrollFactor(0).setDepth(DEPTH.sky).setScale(1.45);
    const add = (key: string, y: number, h: number, f: number, depth: number) => {
      const ts = scene.add.tileSprite(-M, y, W, h, key).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
      this.layers.push({ ts, f, y });
      return ts;
    };
    add('bg_far', GROUND_Y - 640 - 40, 640, 0.06, DEPTH.far);
    add('bg_mid', GROUND_Y - 800 + 10, 800, 0.22, DEPTH.mid);
    add('fog', GROUND_Y - 330, 420, 0.3, DEPTH.mid + 1).setBlendMode(Phaser.BlendModes.ADD);
    add('bg_near', GROUND_Y - 900 + 6, 900, 0.5, DEPTH.near);
    add('floor', GROUND_Y, 200, 1, DEPTH.floor);
    this.filler = scene.add.rectangle(VIEW_W / 2, GROUND_Y + 200 + 300, W, 600, 0x04080d).setScrollFactor(0).setDepth(DEPTH.floor);
    for (let x = 900; x < worldW; x += 1750) scene.add.image(x, -260, 'fg_pillar').setOrigin(0.5, 0).setScale(1, 1.3).setScrollFactor(1.4, 1).setDepth(DEPTH.fore).setAlpha(0.92);
    const r = rng(5);
    for (let i = 0; i < 46; i++) {
      const z = 0.4 + r() * 1.1;
      const im = scene.add.image(0, 0, 'glow').setScrollFactor(0).setDepth(z > 1 ? DEPTH.fore - 1 : DEPTH.near + 1)
        .setBlendMode(Phaser.BlendModes.ADD).setScale(0.05 + z * 0.07).setAlpha(0.18 + r() * 0.3).setTint(r() < 0.3 ? 0xffd9a0 : 0xaef2ff);
      this.motes.push({ im, x: r() * 2400, y: r() * VIEW_H, z, ph: r() * 7 });
    }
    // cinematic dimmer: sits between the backdrop and the actors
    this.dim = scene.add.rectangle(VIEW_W / 2, VIEW_H / 2, W, VIEW_H + M * 2, 0x02030a).setScrollFactor(0).setDepth(DEPTH.props + 5).setAlpha(0);
  }

  update(cam: Phaser.Cameras.Scene2D.Camera, time: number) {
    // vertical parallax is measured from the camera's resting height so layers meet the floor when at rest
    const rest = CAM_REST_Y - VIEW_H / 2, dy = cam.scrollY - rest;
    for (const l of this.layers) { l.ts.tilePositionX = cam.scrollX * l.f - 500 * (1 - l.f); l.ts.y = l.y - rest - dy * l.f; }
    this.filler.y = GROUND_Y + 500 - cam.scrollY;
    for (const m of this.motes) {
      const x = (((m.x - cam.scrollX * m.z * 0.6 + time * 12 * m.z) % 2400) + 2400) % 2400 - 240;
      m.im.setPosition(x, m.y + Math.sin(time * 0.6 + m.ph) * 26 - ((time * 9 * m.z) % VIEW_H) * 0);
    }
  }
}
