import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { port: 5198 }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 400))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
let code = 0;
try {
  await page.goto(`http://127.0.0.1:${server.config.server.port}/tools/preview3d/index.html`);
  await page.waitForFunction(() => window.__done, null, { timeout: 240000 });
  console.log(JSON.stringify(await page.evaluate(() => window.__done.missing)));
  await page.screenshot({ path: 'tools/out/preview3d.png', timeout: 120000 }); console.log('saved');
} catch (e) { console.log('FAILED', String(e).slice(0, 300)); code = 1; }
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 6).join('\n'));
await browser.close(); await server.close(); process.exit(code);
