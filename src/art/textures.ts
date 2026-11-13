import * as Phaser from 'phaser';

/** Supersampling factor for generated textures. Sprites are displayed at 1/SS. */
export const SS = 2;
export const ORIGIN: Record<string, [number, number]> = {};

type G = CanvasRenderingContext2D;

/** Create a canvas texture drawn in logical px with the pivot at (ox, oy). */
export function tex(scene: Phaser.Scene, key: string, w: number, h: number, ox: number, oy: number, draw: (g: G) => void, ss = SS) {
  if (scene.textures.exists(key)) return;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * ss);
  c.height = Math.ceil(h * ss);
  const g = c.getContext('2d', { willReadFrequently: true })!; // CPU canvas: GPU-backed ones dropped draws on large surfaces
  g.scale(ss, ss);
  g.translate(ox, oy);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  scene.textures.addCanvas(key, c);
  ORIGIN[key] = [ox / w, oy / h];
}

function poly(g: G, pts: number[]) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}

/* ---------------------------------- drone ---------------------------------- */

export function buildDrone(scene: Phaser.Scene) {
  const DARK = '#2c2940', BASE = '#5a5470', LIGHT = '#938bb5', LINE = '#0e0c18';
  const edge = (g: G, w: number) => { g.strokeStyle = LINE; g.lineWidth = w; g.stroke(); };
  tex(scene, 'drone_body', 150, 110, 75, 55, (g) => {
    // fins
    poly(g, [-18, -8, -62, -30, -54, -14, -24, 4]); g.fillStyle = DARK; g.fill(); edge(g, 1.3);
    poly(g, [-18, 8, -58, 30, -48, 12, -22, -2]); g.fillStyle = DARK; g.fill(); edge(g, 1.3);
    // hull
    g.beginPath(); g.moveTo(-30, 0); g.quadraticCurveTo(-22, -26, 12, -22); g.quadraticCurveTo(40, -16, 44, 2);
    g.quadraticCurveTo(34, 22, 6, 24); g.quadraticCurveTo(-24, 22, -30, 0); g.closePath();
    const gr = g.createLinearGradient(0, -24, 0, 24); gr.addColorStop(0, LIGHT); gr.addColorStop(0.5, BASE); gr.addColorStop(1, DARK);
    g.fillStyle = gr; g.fill(); edge(g, 1.5);
    // eye
    g.beginPath(); g.arc(22, 2, 11, 0, 7); g.fillStyle = '#07080c'; g.fill(); edge(g, 1.2);
    g.save(); g.shadowColor = '#ff2a10'; g.shadowBlur = 16; g.fillStyle = '#ff5030'; g.beginPath(); g.arc(23, 2, 5.5, 0, 7); g.fill(); g.fill(); g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(24, 1, 2, 0, 7); g.fill();
    g.save(); g.shadowColor = '#ff2a10'; g.shadowBlur = 7; g.strokeStyle = '#ff5030'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-22, -4); g.lineTo(4, -12); g.stroke(); g.restore();
    // thruster
    g.save(); g.shadowColor = '#6fe9ff'; g.shadowBlur = 14; g.fillStyle = '#bff6ff'; g.beginPath(); g.ellipse(-2, 27, 12, 3.5, 0, 0, 7); g.fill(); g.fill(); g.restore();
  });
}

/* ---------------------------------- FX ---------------------------------- */

export function buildFx(scene: Phaser.Scene) {
  tex(scene, 'glow', 128, 128, 64, 64, (g) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
  }, 1);
  tex(scene, 'dot', 16, 16, 8, 8, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill(); });
  tex(scene, 'px', 4, 4, 2, 2, (g) => { g.fillStyle = '#fff'; g.fillRect(-2, -2, 4, 4); }, 1);
  // streak: bright head on the right, fading tail
  tex(scene, 'streak', 96, 12, 90, 6, (g) => {
    const gr = g.createLinearGradient(-90, 0, 6, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(-90, 0); g.lineTo(0, -4); g.quadraticCurveTo(7, 0, 0, 4); g.closePath(); g.fill();
  });
  tex(scene, 'shard', 24, 24, 12, 12, (g) => { g.fillStyle = '#fff'; poly(g, [-9, 6, 10, -2, 2, 9]); g.fill(); });
  // crescent slash: sweeps clockwise; razor thin at the tail, widest just behind the leading tip
  const crescent = (key: string, sweep: number, thick: number) => tex(scene, key, 512, 512, 256, 256, (g) => {
    const R = 240, a0 = -sweep / 2, a1 = sweep / 2, N = 64;
    const cg = g.createConicGradient(a0 - 0.02, 0, 0);
    const f = sweep / (Math.PI * 2);
    cg.addColorStop(0, 'rgba(255,255,255,0)');
    cg.addColorStop(f * 0.35, 'rgba(255,255,255,0.10)');
    cg.addColorStop(f * 0.7, 'rgba(255,255,255,0.5)');
    cg.addColorStop(f * 0.93, 'rgba(255,255,255,1)');
    cg.addColorStop(f, 'rgba(255,255,255,1)');
    cg.addColorStop(Math.min(1, f + 0.002), 'rgba(255,255,255,0)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    const width = (t: number) => R * thick * Math.pow(t, 1.6) * (t > 0.9 ? Math.sqrt((1 - t) / 0.1) : 1);
    const shape = (k: number) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) { const t = i / N, a = a0 + sweep * t; i ? g.lineTo(Math.cos(a) * R, Math.sin(a) * R) : g.moveTo(Math.cos(a) * R, Math.sin(a) * R); }
      for (let i = N; i >= 0; i--) { const t = i / N, a = a0 + sweep * t, r = R - width(t) * k; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath();
    };
    g.save(); g.globalAlpha = 0.55; g.filter = 'blur(7px)'; shape(1); g.fillStyle = cg; g.fill(); g.restore();
    g.save(); g.globalAlpha = 0.6; shape(1); g.fillStyle = cg; g.fill(); g.restore();
    shape(0.38); g.fillStyle = cg; g.fill();
    g.strokeStyle = cg; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, R - 1.5, a0, a1); g.stroke();
  }, 1);
  crescent('slash', Math.PI * 0.95, 0.30);
  crescent('slash_wide', Math.PI * 1.5, 0.36);
  crescent('slash_thin', Math.PI * 0.8, 0.14);
  // for sweeps drawn squashed (seen edge-on): must stay a thin band or the two sides merge into a blob
  crescent('slash_flat', Math.PI * 1.6, 0.13);
  // thrust / line cut
  tex(scene, 'cut', 512, 64, 256, 32, (g) => {
    const gr = g.createLinearGradient(-250, 0, 250, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.filter = 'blur(4px)'; g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 250, 12, 0, 0, 7); g.fill(); g.restore();
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 250, 3.2, 0, 0, 7); g.fill();
  }, 1);
  tex(scene, 'ring', 256, 256, 128, 128, (g) => {
    g.save(); g.filter = 'blur(2px)'; g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 112, 0, 7); g.stroke(); g.restore();
    g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 112, 0, 7); g.stroke();
  }, 1);
  tex(scene, 'smoke', 128, 128, 64, 64, (g) => {
    const gr = g.createRadialGradient(0, 0, 4, 0, 0, 60);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
  }, 1);
  // hostile bolt
  tex(scene, 'bolt', 96, 32, 48, 16, (g) => {
    g.save(); g.shadowColor = '#ff2a10'; g.shadowBlur = 12; g.fillStyle = '#ff7a5a';
    g.beginPath(); g.moveTo(-40, 0); g.quadraticCurveTo(10, -9, 26, 0); g.quadraticCurveTo(10, 9, -40, 0); g.fill(); g.fill(); g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(12, 0, 12, 2.6, 0, 0, 7); g.fill();
  });
  // execute marker (diamond reticle)
  tex(scene, 'marker', 96, 96, 48, 48, (g) => {
    g.save(); g.shadowColor = '#ff5fd0'; g.shadowBlur = 10; g.strokeStyle = '#ffc4f0'; g.lineWidth = 3;
    poly(g, [0, -30, 30, 0, 0, 30, -30, 0]); g.stroke();
    g.lineWidth = 2; poly(g, [0, -14, 14, 0, 0, 14, -14, 0]); g.stroke();
    g.beginPath(); g.moveTo(0, -42); g.lineTo(0, -32); g.moveTo(0, 42); g.lineTo(0, 32); g.moveTo(-42, 0); g.lineTo(-32, 0); g.moveTo(42, 0); g.lineTo(32, 0); g.stroke();
    g.restore();
  });
  // warning glyph for telegraphs
  tex(scene, 'warn', 64, 64, 32, 32, (g) => {
    g.save(); g.shadowColor = '#ff2a10'; g.shadowBlur = 10; g.fillStyle = '#ff7a5a';
    poly(g, [-3.5, -22, 3.5, -22, 2, 6, -2, 6]); g.fill(); g.beginPath(); g.arc(0, 15, 4, 0, 7); g.fill(); g.restore();
    g.fillStyle = '#fff'; poly(g, [-1.5, -19, 1.5, -19, 0.8, 3, -0.8, 3]); g.fill();
  });
  // traversal anchor: a small hard-light beacon
  tex(scene, 'anchor', 96, 96, 48, 48, (g) => {
    g.save(); g.shadowColor = '#2f8fff'; g.shadowBlur = 8; g.strokeStyle = '#9fd4ff'; g.lineWidth = 1.6;
    g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; k ? g.lineTo(Math.cos(a) * 22, Math.sin(a) * 22) : g.moveTo(Math.cos(a) * 22, Math.sin(a) * 22); } g.closePath(); g.stroke();
    g.lineWidth = 1; for (let k = 0; k < 3; k++) { const a = Math.PI * 2 / 3 * k - Math.PI / 2; g.beginPath(); g.moveTo(Math.cos(a) * 28, Math.sin(a) * 28); g.lineTo(Math.cos(a) * 38, Math.sin(a) * 38); g.stroke(); }
    g.restore();
    g.fillStyle = '#ffffff'; poly(g, [0, -6, 6, 0, 0, 6, -6, 0]); g.fill();
  });
  // scarf / cape segment (white, tinted at runtime)
  tex(scene, 'seg', 40, 16, 4, 8, (g) => {
    const gr = g.createLinearGradient(0, -7, 0, 7); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.72)');
    g.fillStyle = gr; g.beginPath(); g.roundRect(-3, -6.5, 38, 13, 6.5); g.fill();
  });
  // soft contact shadow
  tex(scene, 'shadow', 160, 32, 80, 16, (g) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 78);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.scale(1, 0.2); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 78, 0, 7); g.fill(); g.restore();
  }, 1);
}

