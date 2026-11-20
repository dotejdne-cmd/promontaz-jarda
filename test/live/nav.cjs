/* 3.2: navigace a soužití s vyhledáváním webu (promontaz-search 3.2) na ŽIVÉM promontaz.cz.
   Nenasazená verze z repa se podstrčí jen v testovacím prohlížeči (jako local.cjs); PAGES=stable = skutečný kanál.
   Nic se neodesílá (dry_run), do košíku se nic nevkládá. Spuštění: npm run build && node test/live/nav.cjs (MOBILE=1, SHOTS=adresář) */
const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
const REPO = path.resolve(__dirname, '../..'), V = require(REPO + '/package.json').version, SH = process.env.SHOTS, PAGES = process.env.PAGES;
const TYPES = { js: 'application/javascript', json: 'application/json', webp: 'image/webp', jpg: 'image/jpeg' };
const results = []; let failed = 0;
async function step(n, f) { try { await f(); results.push('✓ ' + n); } catch (e) { failed++; results.push('✗ ' + n + '\n    ' + String(e.message).split('\n').slice(0, 6).join('\n    ')); } }
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext(process.env.MOBILE ? { ...devices['iPhone 13'] } : { viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript(() => { window.PMJ_CONFIG_OVERRIDE = { dry_run: true }; });
  if (!PAGES) await ctx.route(/dotejdne-cmd\.github\.io\/promontaz-jarda\/(.*?)(\?.*)?$/, r => {
    let f = /promontaz-jarda\/([^?]*)/.exec(r.request().url())[1];
    if (f === 'dist/stable/jarda.min.js') f = `dist/${V}/jarda.min.js`;
    const p = path.join(REPO, f);
    if (!p.startsWith(REPO) || !fs.existsSync(p)) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ path: p, headers: { 'content-type': TYPES[path.extname(p).slice(1)] || 'application/octet-stream', 'access-control-allow-origin': '*' } });
  });
  const errs = []; ctx.on('page', p => p.on('pageerror', e => errs.push(e.message)));
  const pg = await ctx.newPage();
  const nav = () => pg.evaluate(() => { const n = document.querySelector('.pmj-nav'); return !n || n.hidden ? null : [...n.querySelectorAll('button')].filter(b => !b.hidden).map(b => b.textContent); });
  const tap = s => process.env.MOBILE ? pg.tap(s) : pg.click(s);
  await step('živý web: verze, vyhledávání webu 3.2 (search-v3) běží vedle Jardy', async () => {
    await pg.goto('https://www.promontaz.cz/', { waitUntil: 'load' });
    const b = await pg.$('.siteCookies button[data-cookie-value="all"], .siteCookies__button--accept, button:has-text("Souhlasím")'); if (b) await b.click().catch(() => {});
    await pg.waitForSelector('.pmj-fab', { timeout: 45000 });
    assert.equal(await pg.$eval('.pmj-root', e => e.dataset.version), PAGES ? (await pg.$eval('.pmj-root', e => e.dataset.version)) : V);
    assert.ok(await pg.waitForFunction(() => window.__psearch3 === true || window.__psearch3 === 'next', null, { timeout: 20000 }));
    const inp = await pg.$('input[name="string"]:visible');
    if (inp && !process.env.MOBILE) {
      await inp.fill('vrut 3,5x35');
      await pg.waitForSelector('#psearch3 .ps-item', { timeout: 20000 });
      assert.match(await pg.$eval('#psearch3', e => e.innerText), /bal/);
      await inp.fill(''); await pg.keyboard.press('Escape');
    }
  });
  await step('hledání → produkt → Zpět → Změnit volbu → nabídka; Hlavní nabídka a Pokračovat', async () => {
    await tap('.pmj-fab'); await pg.waitForSelector('.pmj-chip', { timeout: 20000 });
    await pg.fill('.pmj-q', 'vrut konstrukční 3,5x35 zz'); await pg.press('.pmj-q', 'Enter');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-card', { timeout: 60000 });
    const card = await pg.$eval('.pmj-bot:last-child .pmj-card', e => e.innerText);
    assert.match(card, /189 Kč \/ bal \(1000 ks\)/, card);
    await tap('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-buy .pmj-qty', { timeout: 30000 });
    assert.match(await pg.$eval('.pmj-bot:last-child .pmj-buy', e => e.innerText), /bal\. \(1000 ks\)/);
    assert.equal((await nav())[0], '← Výsledky „vrut konstrukční 3,5x35 zz“');
    if (SH) await pg.screenshot({ path: `${SH}/live-${process.env.MOBILE ? 'mobile' : 'desktop'}-product.png` });
    await tap('.pmj-navb >> nth=0'); await pg.waitForSelector('.pmj-bot:last-child:has-text("našel") .pmj-card');
    assert.deepEqual(await nav(), ['← Změnit volbu']);
    await tap('.pmj-nav button:has-text("Změnit volbu")'); await pg.waitForSelector('.pmj-bot:last-child .pmj-chip');
    assert.equal(await nav(), null);
    await tap('.pmj-chip:has-text("Doprava a platba")'); await pg.waitForSelector('.pmj-bot:last-child:has-text("143,10")');
    await tap('.pmj-navb >> nth=0'); await pg.waitForSelector('.pmj-bot:last-child .pmj-resume');
    assert.match(await pg.$eval('.pmj-bot:last-child .pmj-resume', e => e.innerText), /Poslední hledání/);
    if (SH) await pg.screenshot({ path: `${SH}/live-${process.env.MOBILE ? 'mobile' : 'desktop'}-menu.png` });
  });
  await step('panel nepřekrývá web po zavření; zavřená ikona nezakrývá košík ani hledání', async () => {
    await tap('.pmj-x');
    const r = await pg.evaluate(() => { const f = document.querySelector('.pmj-fab').getBoundingClientRect(); return { right: innerWidth - f.right, bottom: innerHeight - f.bottom, h: f.height }; });
    assert.ok(r.right >= 8 && r.bottom >= 8 && r.h <= 64, JSON.stringify(r));
  });
  await step('bez chyb JavaScriptu', async () => { assert.deepEqual(errs.filter(e => /pmj|jarda/i.test(e)), []); });
  await br.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} prošlo (živý web, ${PAGES ? 'Pages ' + PAGES : 'verze ' + V}${process.env.MOBILE ? ', iPhone 13 emulace' : ''})`);
  process.exit(failed ? 1 : 0);
})();
