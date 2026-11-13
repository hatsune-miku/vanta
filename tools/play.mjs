// Scripted playtest in headless Chromium (logic is stepped manually, so a slow machine is fine).
// Usage: node tools/play.mjs <query> <scenario.js>   -- scenario default-exports async (api) => {}
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [query = 'test', scenario] = process.argv.slice(2);
mkdirSync('tools/out', { recursive: true });
const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
let code = 0;
try {
  await page.goto(`http://127.0.0.1:${server.config.server.port}/?${query}`);
  await page.waitForFunction(() => window.__vanta, null, { timeout: 120000 });
  const api = {
    page,
    step: (n = 1) => page.evaluate((n) => window.__vanta.step(n), n),
    hold: (a, v = true) => page.evaluate(([a, v]) => window.__vanta.hold(a, v), [a, v]),
    tap: (a, f = 2) => page.evaluate(([a, f]) => window.__vanta.tap(a, f), [a, f]),
    state: () => page.evaluate(() => window.__vanta.state()),
    eval: (fn, arg) => page.evaluate(fn, arg),
    shot: async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: `tools/out/${name}.png`, timeout: 120000 }); console.log('shot', name); },
  };
  const mod = await import(resolve(scenario));
  await mod.default(api);
} catch (e) { console.log('FAILED', String(e.stack || e).slice(0, 600)); code = 1; }
if (errors.length) { console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n')); code = 1; }
await browser.close(); await server.close(); process.exit(code);
