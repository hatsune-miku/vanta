// Auto-battler: plays the whole stage with a simple bot (player HP topped up) to shake out runtime errors.
export default async (g) => {
  const run = (frames, opts) => g.eval(({ frames, godmode }) => {
    const v = window.__vanta, s = v.scene, inp = s.ctl.virtual;
    const keys = ['left', 'right', 'up', 'down', 'jump', 'light', 'heavy', 'dash', 'exec', 'special'];
    let i = 0;
    for (; i < frames && !s.over; i++) {
      const p = s.player, f = s.frame;
      for (const k of keys) inp[k] = false;
      if (godmode && p.hp < 60) p.hp = 100;
      const es = s.enemies.filter((e) => !e.dead && e.state !== 'spawn');
      const t = es.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      if (!t) { inp.right = !s.locked; }
      else {
        const dx = t.x - p.x, adx = Math.abs(dx);
        inp[dx > 0 ? 'right' : 'left'] = adx > 150;
        if (t.broken > 0 && adx < 380) inp.exec = f % 4 < 2;
        else if (adx < 240) {
          if (t.y < p.y - 150 && p.onGround) inp.jump = f % 6 < 2;
          const r = f % 90;
          if (r < 50) inp.light = f % 6 < 2; else if (r < 62) { inp.heavy = f % 6 < 2; inp.up = r > 56; } else if (r < 66) inp.dash = true; else inp.light = f % 6 < 2;
        }
        if (p.energy >= 80 && adx < 700 && f % 50 === 0) inp.special = true;
        if (t.state === 'strike' && adx < 320 && f % 3 === 0) inp.dash = true;
      }
      v.step(1);
    }
    for (const k of keys) inp[k] = false;
    return i;
  }, { frames, ...opts });
  let last = '';
  for (let k = 0; k < 40; k++) {
    await run(600, { godmode: true });
    const s = await g.state();
    const line = `f=${s.frame} arena=${s.arena} wave=${s.wave} locked=${s.locked} over=${s.over} hp=${s.player.hp} execs=${s.execs} enemies=${s.enemies.map((e) => e.kind + ':' + e.hp + ':' + e.state).join(',')}`;
    console.log(line);
    if (k === 6 || k === 14) await g.shot('bot' + k);
    if (s.arena === 3 && s.locked && !last.includes('boss')) { last += 'boss'; await run(240, { godmode: true }); await g.shot('bot_boss'); }
    if (s.over) { await g.step(30); await g.shot('bot_end'); break; }
  }
};
