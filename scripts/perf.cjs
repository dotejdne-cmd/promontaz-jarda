/* Srovnání výkonu na živém promontaz.cz: bez Jardy × v2 (produkce) × v3 (tato větev, podstrčená lokálně).
   Emulace mobilu: Pixel 7, CPU 4× zpomalené, síť „Fast 4G“ (9 Mb/s, 170 ms). Medián z RUNS běhů.
   Měří: LCP, CLS, TBT (součet dlouhých úloh nad 50 ms do 8 s), čas skriptů (ScriptDuration),
   počet a objem požadavků Jardy při načtení, a odezvu: klik na ikonu → panel, první hledání.
   Spuštění: node scripts/perf.cjs [url]   (RUNS=5) */
const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs');
const REPO = path.resolve(__dirname, '..'), V = JSON.parse(fs.readFileSync(REPO + '/package.json')).version;
const URL_ = process.argv[2] || 'https://www.promontaz.cz/kramle/kramle-tesarska-10x200/';
const RUNS = +process.env.RUNS || 5;
const TYPES = { js: 'application/javascript', json: 'application/json', webp: 'image/webp', jpg: 'image/jpeg', css: 'text/css' };
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function run(br, variant) {
  const ctx = await br.newContext({ ...devices['Pixel 7'] });
  const jr = { n: 0, bytes: 0 };
  await ctx.route(/dotejdne-cmd\.github\.io\/promontaz-jarda\//, async r => {
    const u = new URL(r.request().url()).pathname.replace('/promontaz-jarda/', '');
    const isV2 = /^dist\/jarda\.(min\.js|css)$/.test(u);
    if (variant === 'none' || (variant === 'v3' && isV2)) return r.abort();
    if (variant === 'v2' && !isV2 && !/^config\.json$/.test(u)) return r.continue();
    const f = path.join(REPO, u);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ path: f, headers: { 'access-control-allow-origin': '*', 'content-type': TYPES[f.split('.').pop()] } });
  });
  // v2 v produkci načítá i logo z promontaz.cz – počítá se do jejích požadavků
  ctx.on('requestfinished', async q => {
    if (!/promontaz-jarda|user\/documents\/upload\/jarda\.jpg/.test(q.url())) return;
    try { const s = await q.sizes(); jr.n++; jr.bytes += s.responseBodySize; } catch (e) {}
  });
  if (variant === 'v3') await ctx.addInitScript(src => {
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('script'); s.defer = true; s.src = src; document.body.appendChild(s); });
  }, `https://dotejdne-cmd.github.io/promontaz-jarda/dist/${V}/jarda.min.js`);
  await ctx.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0; window.__tbt = 0;
    new PerformanceObserver(l => l.getEntries().forEach(e => { window.__lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => { window.__tbt += Math.max(0, e.duration - 50); })).observe({ type: 'longtask', buffered: true });
  });
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: 9e6 / 8, uploadThroughput: 9e6 / 8 });
  await cdp.send('Performance.enable');
  await pg.goto(URL_, { waitUntil: 'load', timeout: 90000 });
  await pg.waitForTimeout(8000); // zavaděč startuje až po load + idle
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const v = await pg.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, tbt: window.__tbt }));
  const res = { lcp: v.lcp, cls: v.cls, tbt: v.tbt, script: m.ScriptDuration * 1000, req: jr.n, kb: jr.bytes / 1024 };
  // cookie lišta Shoptetu na mobilu zakrývá ikonu (jako u v2) → po změření načtení ji odmítnout
  const rej = await pg.$('.js-siteCookies button:has-text("Odmítnout")'); if (rej) { await rej.click().catch(() => {}); await pg.waitForTimeout(300); }
  if (variant !== 'none' && await pg.$('.pmj-fab')) {
    const t0 = Date.now(); await pg.click('.pmj-fab'); await pg.waitForSelector('.pmj-panel:not([hidden]) .pmj-chip, .pmj-box', { timeout: 30000 }).catch(() => {});
    res.open = Date.now() - t0;
    if (await pg.$('.pmj-q')) {
      const t1 = Date.now(); await pg.fill('.pmj-q', 'vrut 5x60'); await pg.press('.pmj-q', 'Enter');
      await pg.waitForSelector('.pmj-card', { timeout: 90000 }).catch(() => {});
      res.search = Date.now() - t1;
      const tb = await pg.evaluate(() => window.__tbt); res.tbtAfterSearch = tb - v.tbt;
    }
  }
  await ctx.close();
  return res;
}

(async () => {
  const br = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const out = {};
  for (let i = 0; i < RUNS; i++) for (const variant of ['none', 'v2', 'v3']) {
    (out[variant] = out[variant] || []).push(await run(br, variant));
  }
  await br.close();
  const keys = ['lcp', 'cls', 'tbt', 'script', 'req', 'kb', 'open', 'search', 'tbtAfterSearch'];
  const lab = { lcp: 'LCP ms', cls: 'CLS', tbt: 'TBT ms (načtení)', script: 'Skripty ms (celá stránka)', req: 'Požadavky Jardy při načtení', kb: 'kB Jardy při načtení', open: 'Klik → panel ms', search: 'První hledání ms', tbtAfterSearch: 'TBT ms během 1. hledání' };
  console.log(`\n${URL_}\nPixel 7, CPU 4×, 9 Mb/s / 170 ms, medián z ${RUNS} běhů\n`);
  console.log('Metrika'.padEnd(30) + ['bez Jardy', 'v2', 'v3 ' + V].map(s => s.padStart(12)).join(''));
  for (const k of keys) {
    console.log(lab[k].padEnd(30) + ['none', 'v2', 'v3'].map(vr => { const x = med(out[vr].map(r => r[k])); return (x == null ? '–' : k === 'cls' ? x.toFixed(3) : Math.round(x)).toString().padStart(12); }).join(''));
  }
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
