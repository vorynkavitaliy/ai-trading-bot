// Coinglass liquidation-map probe via Playwright (operator's web account).
// Strategy: do NOT scrape canvas pixels — intercept the page's own XHR/fetch
// responses that carry the map data, dump them to /tmp for analysis.
//
//   npx tsx src/tools/diagnostics/cg-liqmap-probe.ts [--session /root/.cg-session/cookies.json] [url ...]
//
// Cookie file: JSON array exported by the Cookie-Editor browser extension from
// coinglass.com ({name, value, domain, path, expirationDate?, secure?, httpOnly?,
// sameSite?}). Stored OUTSIDE the repo; never committed, never logged.
// Anonymous run (no --session) shows which endpoints are Pro-gated.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_PAGES = [
  'https://www.coinglass.com/LiquidationData',
  'https://www.coinglass.com/pro/futures/LiquidationHeatMap',
];
const CAPTURE_DIR = '/tmp/cg-liqmap-capture';
const INTERESTING = /liq|heatmap|map/i;

function toPlaywrightCookies(raw: any[]): any[] {
  return raw
    .filter((c) => c && c.name && c.value != null)
    .map((c) => ({
      name: String(c.name),
      value: String(c.value),
      domain: c.domain ?? '.coinglass.com',
      path: c.path ?? '/',
      expires: typeof c.expirationDate === 'number' ? Math.floor(c.expirationDate) : -1,
      httpOnly: !!c.httpOnly,
      secure: c.secure !== false,
      sameSite: c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax',
    }));
}

async function main() {
  const args = process.argv.slice(2);
  let sessionFile: string | null = null;
  const pages: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session') sessionFile = args[++i];
    else pages.push(args[i]);
  }
  const targets = pages.length > 0 ? pages : DEFAULT_PAGES;

  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    viewport: { width: 2400, height: 1400 },
    deviceScaleFactor: 2,   // crisp price-axis labels for vision read
    locale: 'en-US',
  });

  if (sessionFile) {
    if (!fs.existsSync(sessionFile)) {
      console.error(`session file not found: ${sessionFile}`);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    const cookies = toPlaywrightCookies(Array.isArray(raw) ? raw : raw.cookies ?? []);
    await context.addCookies(cookies);
    console.log(`session: loaded ${cookies.length} cookies (values not logged)`);
  } else {
    console.log('session: ANONYMOUS run (no cookies) — expect Pro data to be gated');
  }

  const page = await context.newPage();
  let captureIdx = 0;
  const summary: Array<{ url: string; status: number; bytes: number; file: string }> = [];

  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (!INTERESTING.test(url)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!/json|javascript/.test(ct) && !INTERESTING.test(url)) return;
      const body = await resp.body().catch(() => null);
      if (!body || body.length < 50) return;
      const idx = ++captureIdx;
      const file = path.join(CAPTURE_DIR, `cap-${String(idx).padStart(3, '0')}.json`);
      fs.writeFileSync(file, JSON.stringify({ url, status: resp.status(), headers: resp.headers() }, null, 2) + '\n');
      fs.appendFileSync(file, body.slice(0, 200_000));
      summary.push({ url: url.slice(0, 140), status: resp.status(), bytes: body.length, file });
    } catch { /* response already disposed — fine */ }
  });

  async function dismissOverlays() {
    // Google consent + CG cookie/login modals block the canvas. Click anything that
    // dismisses them; ignore misses. Multiple passes — consent iframe loads late.
    const labels = ['Consent', 'Do not consent', 'Accept all', 'Agree', 'Got it', 'Я согласен', 'Close'];
    for (let pass = 0; pass < 3; pass++) {
      for (const frame of page.frames()) {
        for (const label of labels) {
          try {
            const btn = frame.getByRole('button', { name: new RegExp(label, 'i') });
            if (await btn.count()) { await btn.first().click({ timeout: 1500 }); }
          } catch { /* not present in this frame */ }
        }
      }
      await page.waitForTimeout(1500);
    }
  }

  for (const target of targets) {
    console.log(`\n→ ${target}`);
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(6_000);
      await dismissOverlays();
      await page.waitForTimeout(12_000);      // let the heatmap canvas paint
      const i = targets.indexOf(target);
      const shot = path.join(CAPTURE_DIR, `page-${i}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      console.log(`  title: ${await page.title()}`);
      console.log(`  screenshot: ${shot}`);
      // Also crop the largest canvas (the heatmap itself) for a clean read.
      try {
        const canvas = page.locator('canvas').first();
        if (await canvas.count()) {
          const cshot = path.join(CAPTURE_DIR, `canvas-${i}.png`);
          await canvas.screenshot({ path: cshot });
          console.log(`  canvas crop: ${cshot}`);
        }
      } catch { /* no canvas */ }
    } catch (e: any) {
      console.error(`  navigation failed: ${e?.message ?? String(e)}`);
    }
  }

  console.log(`\n=== captured ${summary.length} interesting responses → ${CAPTURE_DIR} ===`);
  for (const s of summary) {
    console.log(`  [${s.status}] ${(s.bytes / 1024).toFixed(0).padStart(5)}KB  ${s.url}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error('cg-liqmap-probe failed:', e?.message ?? String(e));
  process.exit(1);
});
