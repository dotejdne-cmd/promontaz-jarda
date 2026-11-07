/* Výkon na živém promontaz.cz – varianty Zápatí, všechny načtené stejně (přepis HTML v testovacím prohlížeči):
     none        řádek Jardy odstraněn
     v2          dnešní řádek dist/jarda.min.js?v=2
     stable→v2   nový řádek dist/stable/jarda.min.js (kanál ukazuje na v2)
     tester→v3   nový řádek + ?pmj_ver=<verze> (v3 jen v tomto prohlížeči)
     stable=v3   nový řádek, kanál = zavaděč v3 (simulace po přepnutí: dist/stable podstrčen z dist/<verze>)
   Soubory jinak ze skutečných GitHub Pages. Pixel 7, CPU 4×, 9 Mb/s / 170 ms, medián z RUNS běhů.
   Měří LCP, CLS, TBT, čas skriptů, požadavky/kB Jardy při načtení, INP (klik na ikonu, psaní, Enter), klik → panel, první hledání.
   Spuštění: node scripts/perf.cjs [url]   (RUNS=5) */
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..'), V = JSON.parse(fs.readFileSync(REPO + '/package.json')).version;
const PAGES = 'https://dotejdne-cmd.github.io/promontaz-jarda/';
const URL_ = process.argv[2] || 'https://www.promontaz.cz/kramle/kramle-tesarska-10x200/';
const RUNS = +process.env.RUNS || 5;
const V2LINE = /<script[^>]*promontaz-jarda\/dist\/jarda\.min\.js\?v=2[^>]*><\/script>/;
const STABLE = `<script defer src="${PAGES}dist/stable/jarda.min.js"></script>`;
const VARIANTS = { 'none': '', 'v2': null, 'stable→v2': STABLE, 'tester→v3': STABLE, 'stable=v3': STABLE };
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function run(br, variant) {
  const ctx = await br.newContext({ ...devices['Pixel 7'] });
  const jr = { n: 0, bytes: 0 }; let counting = true;
  await ctx.route(/^https:\/\/www\.promontaz\.cz\//, async r => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const res = await r.fetch(); let body = await res.text();
    if (VARIANTS[variant] !== null) body = body.replace(V2LINE, VARIANTS[variant]);
    r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  if (variant === 'stable=v3') await ctx.route(PAGES + 'dist/stable/jarda.min.js', r => r.fulfill({ path: path.join(REPO, `dist/${V}/jarda.min.js`), headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' } }));
  ctx.on('requestfinished', async q => {
    if (!counting || !/promontaz-jarda|user\/documents\/upload\/jarda\.jpg/.test(q.url())) return;
    try { const s = await q.sizes(); jr.n++; jr.bytes += s.responseBodySize; } catch (e) {}
  });
  await ctx.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0; window.__tbt = 0; window.__inp = 0;
    new PerformanceObserver(l => l.getEntries().forEach(e => { window.__lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => { window.__tbt += Math.max(0, e.duration - 50); })).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => { if (e.interactionId) window.__inp = Math.max(window.__inp, e.duration); })).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: 9e6 / 8, uploadThroughput: 9e6 / 8 });
  await cdp.send('Performance.enable');
  await pg.goto(URL_ + (variant === 'tester→v3' ? `?pmj_ver=${V}` : ''), { waitUntil: 'load', timeout: 90000 });
  await pg.waitForTimeout(8000); // Jarda startuje až po load + idle
  counting = false;
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const v = await pg.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, tbt: window.__tbt }));
  const res = { lcp: v.lcp, cls: v.cls, tbt: v.tbt, script: m.ScriptDuration * 1000, req: jr.n, kb: jr.bytes / 1024 };
  // cookie lišta Shoptetu na mobilu zakrývá ikonu (stejně pro všechny varianty) → po změření načtení ji odmítnout
  await pg.$eval('.js-siteCookies button[value="none"], .js-siteCookies .siteCookies__button--reject', b => b.click()).catch(() => {});
  await pg.evaluate(() => { const b = [...document.querySelectorAll('.js-siteCookies button')].find(x => /Odmítnout/.test(x.textContent)); if (b) b.click(); });
  await pg.waitForTimeout(500);
  if (variant !== 'none' && await pg.$('.pmj-fab')) {
    await pg.evaluate(() => { window.__inp = 0; });
    const t0 = Date.now(); await pg.tap('.pmj-fab').catch(() => pg.click('.pmj-fab'));
    await pg.waitForSelector('.pmj-panel:not([hidden]) .pmj-chip', { timeout: 30000 }).catch(() => {});
    res.open = Date.now() - t0;
    if (await pg.$('.pmj-q')) {
      const t1 = Date.now(); await pg.fill('.pmj-q', 'vrut 5x60'); await pg.press('.pmj-q', 'Enter');
      await pg.waitForSelector('.pmj-card', { timeout: 90000 }).catch(() => {});
      res.search = Date.now() - t1;
      await pg.waitForTimeout(500);
      const after = await pg.evaluate(() => ({ tbt: window.__tbt, inp: window.__inp }));
      res.tbtAfterSearch = after.tbt - v.tbt; res.inp = after.inp;
    }
  }
  await ctx.close();
  return res;
}

(async () => {
  const br = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const out = {}, names = Object.keys(VARIANTS);
  // neplatný běh (stránka se přes proxy nenačetla celá: LCP < 800 ms, TBT 0, chyba) se zopakuje, max. 2×
  const valid = r => !r.err && r.lcp > 800 && r.tbt > 0 && (r.open !== undefined || false);
  for (let i = 0; i < RUNS; i++) for (const variant of names) {
    let r, tries = 0;
    do { r = await run(br, variant).catch(e => ({ err: e.message })); if (variant === 'none' && !r.err && r.lcp > 800 && r.tbt > 0) break; } while (!valid(r) && ++tries < 3);
    (out[variant] = out[variant] || []).push(r);
  }
  await br.close();
  for (const n of names) out[n] = out[n].filter(r => !r.err && r.lcp > 800 && r.tbt > 0);
  const keys = ['lcp', 'cls', 'tbt', 'script', 'req', 'kb', 'inp', 'open', 'search', 'tbtAfterSearch'];
  const lab = { lcp: 'LCP ms', cls: 'CLS', tbt: 'TBT ms (načtení)', script: 'Skripty ms (stránka)', req: 'Požadavky Jardy (načtení)', kb: 'kB Jardy (načtení)', inp: 'INP ms (ikona+hledání)', open: 'Klik → panel ms', search: 'První hledání ms', tbtAfterSearch: 'TBT ms během hledání' };
  console.log(`\n${URL_}\nPixel 7, CPU 4×, 9 Mb/s / 170 ms, medián z ${RUNS} běhů (platné: ${names.map(n => n + ' ' + out[n].length).join(', ')}), verze ${V}\n`);
  console.log('Metrika'.padEnd(27) + names.map(s => s.padStart(12)).join(''));
  for (const k of keys) console.log(lab[k].padEnd(27) + names.map(vr => { const x = med(out[vr].map(r => r[k])); return (x == null ? '–' : k === 'cls' ? x.toFixed(3) : Math.round(x)).toString().padStart(12); }).join(''));
  const errs = names.flatMap(n => out[n].filter(r => r.err).map(r => n + ': ' + r.err.split('\n')[0]));
  if (errs.length) console.log('\nChyby běhů:', errs);
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
