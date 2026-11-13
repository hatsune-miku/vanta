// Fight the first wave until something breaks, then execute and capture the cinematic.
export default async (g) => {
  await g.hold('right'); await g.step(110); await g.hold('right', false);
  let s, broke = null;
  for (let i = 0; i < 400 && !broke; i++) {
    s = await g.state();
    broke = s.enemies.find((e) => e.broken > 0);
    if (broke) break;
    const near = s.enemies.filter((e) => e.state !== 'spawn').sort((a, b) => Math.abs(a.x - s.player.x) - Math.abs(b.x - s.player.x))[0];
    if (!near) { await g.step(5); continue; }
    const dir = near.x > s.player.x ? 'right' : 'left';
    if (Math.abs(near.x - s.player.x) > 200) { await g.hold(dir); await g.step(6); await g.hold(dir, false); }
    else { await g.hold(dir); await g.tap('light', 2); await g.hold(dir, false); await g.step(8); }
    if (i === 30) await g.shot('c0_fight');
  }
  console.log('broken:', JSON.stringify(broke), 'player', JSON.stringify(s.player), 'combo', s.combo);
  await g.shot('c1_break');
  const dir = broke.x > s.player.x ? 'right' : 'left';
  await g.hold(dir); await g.step(2); await g.hold(dir, false);
  await g.tap('exec', 2);
  s = await g.state(); console.log('cine', s.cine);
  const ct = () => g.eval(() => { const c = window.__vanta.scene.cine; return c ? { t: c.t, boom: c.boom } : null; });
  await g.step(14); await g.shot('c_strike');
  let n = 0;
  for (; n < 400; n++) { const c = await ct(); if (!c || c.t > c.boom + 1) break; await g.step(1); }
  await g.step(14); await g.shot('c_ripple1');
  await g.step(26); await g.shot('c_ripple2');
  console.log(JSON.stringify(await g.state()));
};
