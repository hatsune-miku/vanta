// Real-time check (no test hooks): title -> battle with real key events, against the production build.
import { chromium } from 'playwright';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4199 }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:4199/');
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('Title'), null, { timeout: 120000 });
await page.screenshot({ path: 'tools/out/title.png', timeout: 120000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game.scene.isActive('Battle'), null, { timeout: 60000 });
const info = () => page.evaluate(() => { const b = window.__game.scene.getScene('Battle'); return { frame: b.frame, x: Math.round(b.player.x), state: b.player.state, fps: Math.round(window.__game.loop.actualFps) }; });
await page.keyboard.down('KeyD'); await page.waitForTimeout(4000); await page.keyboard.up('KeyD');
console.log('after run', JSON.stringify(await info()));
for (let i = 0; i < 6; i++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
await page.keyboard.press('KeyL'); await page.waitForTimeout(500);
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
await page.screenshot({ path: 'tools/out/pause.png', timeout: 120000 });
console.log('paused', await page.evaluate(() => window.__game.scene.getScene('Battle').paused));
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
console.log('end', JSON.stringify(await info()));
console.log(errors.length ? 'PAGE ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors');
await browser.close(); await new Promise((r) => server.httpServer.close(r)); process.exit(errors.length ? 1 : 0);
