/* Živý test kanálu se SKUTEČNÝMI soubory z GitHub Pages (nic se nepodstrkuje).
   Nové Zápatí se simuluje jen v testovacím prohlížeči: HTML stránky se přepíše tak, že řádek v2 nahradí řádek kanálu.
   Kontroluje i GA4 a Ads: zachytí požadavky, které gtag chce odeslat (z tohoto prostředí je síť zablokuje,
   takže do GA4 ani Ads nic neodchází), a ověří souhlas (gcs), parametry bez osobních údajů a žádnou konverzi Ads. */
const { chromium, devices } = require('playwright');
const assert = require('assert/strict');
const PAGES = 'https://dotejdne-cmd.github.io/promontaz-jarda/';
const V2LINE = /<script[^>]*promontaz-jarda\/dist\/jarda\.min\.js\?v=2[^>]*><\/script>/;
const STABLE = `<script defer src="${PAGES}dist/stable/jarda.min.js"></script>`;
const results = []; let failed = 0;
// živý web přes proxy občas nenačte zdroj → každý krok se při chybě jednou zopakuje (a vypíše to)
async function step(n, f) {
  for (let a = 0; a < 2; a++) {
    try { await f(); results.push('✓ ' + n + (a ? ' (na 2. pokus)' : '')); return; }
    catch (e) { if (a) { failed++; results.push('✗ ' + n + '\n    ' + String(e.message).split('\n').slice(0, 3).join('\n    ')); } }
  }
}

async function ctxFor(br, opts, footer) {
  const ctx = await br.newContext(opts || {});
  const hits = [];
  ctx.on('request', q => { const u = q.url(); if (/google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect|googleadservices|googleads\.g\.doubleclick|google\.com\/(pagead|ccm)/.test(u)) hits.push({ u, body: q.postData() || '' }); });
  if (footer === 'stable') await ctx.route(/^https:\/\/www\.promontaz\.cz\/[^?]*(\?.*)?$/, async r => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const res = await r.fetch(); let body = await res.text();
    if (!V2LINE.test(body)) return r.fulfill({ response: res, body });
    r.fulfill({ response: res, body: body.replace(V2LINE, STABLE), headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  return { ctx, hits };
}
const inst = p => p.evaluate(() => ({ fabs: document.querySelectorAll('.pmj-fab').length, ver: document.querySelector('.pmj-root') ? (document.querySelector('.pmj-root').dataset.version || 'v2') : '', scripts: [...document.scripts].map(s => s.src).filter(s => /promontaz-jarda/.test(s)).map(s => s.replace(/^.*promontaz-jarda\//, '')) }));
// gtag dávkuje: společné parametry (gcs = stav souhlasu, tid = měřicí ID) jsou v URL, události v řádcích těla
const evParams = hits => hits.flatMap(h => { const q = h.u.split('?')[1] || '', common = (q.match(/(?:^|&)(gcs|tid)=[^&]*/g) || []).join('&');
  return (q + '\n' + h.body).split('\n').filter(l => /en=jarda_/.test(l)).map(l => common + '&' + l); });

(async () => {
  const br = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const P = 'https://www.promontaz.cz/kramle/kramle-tesarska-10x200/';

  await step('dnešní Zápatí (v2) s novým config.json z main: v2 funguje', async () => {
    const { ctx } = await ctxFor(br, {}); const p = await ctx.newPage();
    await p.goto(P, { waitUntil: 'load' }); await p.waitForSelector('.pmj-fab', { timeout: 45000 });
    assert.deepEqual((await inst(p)).ver, 'v2');
    await p.click('.pmj-fab'); await p.waitForSelector('.pmj-chip'); await p.fill('.pmj-q', 'doprava'); await p.press('.pmj-q', 'Enter'); await p.waitForTimeout(400);
    assert.match(await p.$$eval('.pmj-bot', b => b.pop().innerText), /450 Kč/);
    await ctx.close();
  });
  await step('nové Zápatí (kanál stable): zákazník dostane v2, jedna instance', async () => {
    const { ctx } = await ctxFor(br, {}, 'stable'); const p = await ctx.newPage();
    await p.goto(P, { waitUntil: 'load' }); await p.waitForSelector('.pmj-fab', { timeout: 45000 }); await p.waitForTimeout(800);
    const i = await inst(p); results.push('    skripty: ' + i.scripts.join(', '));
    assert.equal(i.fabs, 1); assert.equal(i.ver, 'v2');
    await ctx.close();
  });
  let tester;
  await step('nové Zápatí + ?pmj_ver=3.0.3: v3 jen v tomto prohlížeči, platí i na dalších stránkách', async () => {
    tester = await ctxFor(br, { viewport: { width: 1366, height: 860 } }, 'stable'); const p = await tester.ctx.newPage();
    await p.goto(P + '?pmj_ver=3.0.3&pmj=test', { waitUntil: 'load' }); await p.waitForSelector('.pmj-fab', { timeout: 45000 }); await p.waitForTimeout(800);
    let i = await inst(p); assert.equal(i.fabs, 1); assert.equal(i.ver, '3.0.3');
    await p.goto('https://www.promontaz.cz/spojovaci-material/', { waitUntil: 'load' }); await p.waitForSelector('.pmj-fab', { timeout: 45000 }); await p.waitForTimeout(800);
    i = await inst(p); assert.equal(i.ver, '3.0.3'); assert.equal(i.fabs, 1);
    const other = await ctxFor(br, {}, 'stable'); const o = await other.ctx.newPage();
    await o.goto('https://www.promontaz.cz/spojovaci-material/', { waitUntil: 'load' }); await o.waitForSelector('.pmj-fab', { timeout: 45000 }); await o.waitForTimeout(800);
    assert.equal((await inst(o)).ver, 'v2', 'jiný prohlížeč musí mít v2'); await other.ctx.close();
  });
  await step('v3 ze skutečných Pages: hledání, fotky, košík, sada, bez chyb', async () => {
    const p = await tester.ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('https://www.promontaz.cz/montazni-sady/sada-tesarske-kovani---1-000-vrutu-4-8--35-40-bit-tx20/', { waitUntil: 'load' });
    await p.waitForSelector('.pmj-fab', { timeout: 45000 }).catch(async e => { await p.screenshot({ path: (process.env.SHOTS || '/tmp') + '/live-sada-fail.png' }); throw new Error(e.message.split('\n')[0] + ' | root=' + await p.evaluate(() => !!document.querySelector('.pmj-root')) + ' __pmj=' + await p.evaluate(() => window.__pmj)); });
    await p.click('.pmj-fab'); await p.waitForSelector('.pmj-chip');
    await p.click('.pmj-chip:has-text("Co obsahuje sada")'); await p.waitForSelector('.pmj-bot:last-of-type .pmj-cards', { timeout: 60000 });
    assert.equal(await p.$$eval('.pmj-bot:last-of-type .pmj-card', a => a.length), 3);
    await p.fill('.pmj-q', 'osb 18'); await p.press('.pmj-q', 'Enter'); await p.waitForTimeout(1500);
    await p.waitForFunction(() => [...document.querySelectorAll('.pmj-bot:last-of-type .pmj-thumb')].slice(0, 2).every(i => i.complete && i.naturalWidth), null, { timeout: 15000 });
    const imgs = await p.$$eval('.pmj-bot:last-of-type .pmj-thumb', a => a.filter(i => i.complete && i.naturalWidth).map(i => i.naturalWidth)); // další se načítají líně
    assert.ok(imgs.length >= 2 && imgs.every(w => w === 100), JSON.stringify(imgs));
    await p.click('.pmj-bot:last-of-type button:has-text("Do košíku")'); await p.waitForSelector('button:has-text("✓ V košíku")', { timeout: 10000 });
    await p.click('.pmj-chip:has-text("Nacenit seznam nebo fotku")'); await p.waitForSelector('.pmj-form');
    await p.fill('.pmj-form textarea', '20× vrut 5x60'); await p.fill('.pmj-form input[type=email]', 'test@example.com'); await p.press('.pmj-form input[type=email]', 'Tab');
    assert.deepEqual(errs, [], JSON.stringify(errs).slice(0, 300));
  });
  await step('GA4 před souhlasem: Consent Mode „denied“ (gcs=G1…0x), události Jardy bez osobních údajů', async () => {
    for (const old of tester.ctx.pages()) { await old.goto('about:blank').catch(() => {}); await old.close(); } // odeslat dávky (pagehide) a zavřít
    const ev = evParams(tester.hits);
    results.push(`    zachycené události Jardy (před souhlasem): ` + ev.map(l => (l.match(/en=[^&]*/) || [''])[0] + ' ' + (l.match(/gcs=[^&]*/) || [''])[0]).join(', '));
    assert.ok(ev.length > 0, 'gtag neodeslal žádnou událost Jardy (je načtený gtag.js?)');
    for (const l of ev) {
      assert.match(l, /gcs=G1[01]0/, 'analytics_storage musí být denied: ' + l.slice(0, 120));
      assert.ok(!/%40|@|722%20|\+420/.test(l), 'osobní údaj v ' + l.slice(0, 200));
    }
    assert.ok(tester.hits.filter(h => /googleadservices|doubleclick|google\.com\/pagead/.test(h.u) && /jarda/.test(h.u + h.body)).length === 0, 'Jarda nesmí volat Ads');
    const formEv = tester.hits.filter(h => /en=form_(start|submit)/.test(h.u + '\n' + h.body));
    assert.equal(formEv.length, 0, 'form_start/form_submit z Jardy: ' + formEv.map(h => h.u.slice(0, 70)).join(' | '));
  });
  // GA4 po souhlasu: viz test/live/consent.cjs (gtag dávkuje události ~25 s)
  await step('?pmj_ver=reset vrátí tento prohlížeč na výchozí (v2)', async () => {
    const p = await tester.ctx.newPage();
    await p.goto(P + '?pmj_ver=reset', { waitUntil: 'load' }); await p.waitForSelector('.pmj-fab', { timeout: 45000 }); await p.waitForTimeout(800);
    assert.equal((await inst(p)).ver, 'v2');
  });
  await br.close();
  console.log(results.join('\n')); console.log(`\n${results.filter(r => r[0] === '✓').length}/${results.filter(r => /^[✓✗]/.test(r)).length} prošlo`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
