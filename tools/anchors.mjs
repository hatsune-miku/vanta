// Anchor + blink dodge sanity check.
export default async (g) => {
  await g.step(20);
  const s0 = await g.state(); const a0 = await g.eval(() => window.__vanta.scene.anchor && { x: window.__vanta.scene.anchor.x, y: window.__vanta.scene.anchor.y });
  console.log('start', JSON.stringify(s0.player), 'active anchor', JSON.stringify(a0));
  await g.shot('a_start');
  await g.tap('dash', 2); await g.step(2); await g.shot('a_blink'); await g.step(6);
  const s1 = await g.state(); console.log('after anchor dash', JSON.stringify(s1.player));
  await g.step(60);
  const x0 = (await g.state()).player.x;
  await g.eval(() => { window.__vanta.scene.anchors.length = 0; });
  await g.step(2); await g.hold('right'); await g.tap('dash', 2); await g.step(8); await g.hold('right', false);
  console.log('plain dash moved', (await g.state()).player.x - x0);
  await g.hold('right'); await g.step(60); await g.hold('right', false); console.log('run 1s moved', (await g.state()).player.x - x0);
};
