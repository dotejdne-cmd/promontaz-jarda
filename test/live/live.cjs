/* Ověření v3 na ŽIVÉM promontaz.cz bez zásahu do webu: v prohlížeči se zablokuje produkční Jarda
   a místo něj se podstrčí soubory z tohoto repa. Poptávka se neodesílá (dry_run). Vkládání do košíku
   jde jen do košíku testovacího prohlížeče (bez objednávky).
   Spuštění: node test/live/live.cjs   (potřebuje přístup na www.promontaz.cz a cdn.myshoptet.com) */
const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
const REPO = path.resolve(__dirname, '../..'), SH = process.env.SHOTS;
const V = JSON.parse(fs.readFileSync(REPO + '/package.json')).version;
const SRC = `https://dotejdne-cmd.github.io/promontaz-jarda/dist/${V}/jarda.min.js`;
const TYPES = { js: 'application/javascript', json: 'application/json', webp: 'image/webp', jpg: 'image/jpeg', css: 'text/css' };
const results = []; let failed = 0;
async function step(n, f) { // živý web přes proxy občas nenačte zdroj → jeden opakovaný pokus (vypíše se)
  for (let a = 0; a < 2; a++) { try { await f(); results.push('✓ ' + n + (a ? ' (na 2. pokus)' : '')); return; } catch (e) { if (a) { failed++; results.push('✗ ' + n + '\n    ' + String(e.message).split('\n').slice(0, 3).join('\n    ')); } } }
}
async function setup(ctx, reqs, errs) {
  // Produkční cesta: Zápatí = kanál dist/stable; verze pro test se vybere jako u testera (localStorage pmj_ver).
  // Soubory jdou ze skutečných GitHub Pages. TARGET=stable → testuje výchozí verzi kanálu (po přepnutí).
  await ctx.addInitScript(v => {
    window.PMJ_CONFIG_OVERRIDE = { dry_run: true };
    try { if (location.hostname === 'www.promontaz.cz') { if (v) localStorage.setItem('pmj_ver', v); else localStorage.removeItem('pmj_ver'); } } catch (e) {}
  }, process.env.TARGET === 'stable' ? '' : V);
  ctx.on('request', q => { const u = q.url(); if (/promontaz-jarda|promontaz-search\/index|user\/shop\/related/.test(u)) reqs.push(u.replace(/^https:\/\//, '').replace(/\?.*$/, '')); });
  ctx.on('page', p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && /pmj|jarda/i.test(m.text())) errs.push(m.text()); }); });
}
const lastBot = pg => pg.evaluate(() => { const b = [...document.querySelectorAll('.pmj-bot')]; return b.length ? b[b.length - 1].innerText : ''; });
async function ask(pg, t) { await pg.fill('.pmj-q', t); await pg.press('.pmj-q', 'Enter'); }

(async () => {
  const br = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const reqs = [], errs = [];
  const ctx = await br.newContext({ viewport: { width: 1366, height: 860 } }); await setup(ctx, reqs, errs);
  const pg = await ctx.newPage();

  await step('stránka produktu: kanál → v3 (jedna instance), při načtení jen zavaděč + config + logo', async () => {
    await pg.goto('https://www.promontaz.cz/kramle/kramle-tesarska-10x200/', { waitUntil: 'load' });
    await pg.waitForSelector('.pmj-fab', { timeout: 45000 }); await pg.waitForTimeout(1000);
    const got = reqs.splice(0).filter(u => /promontaz-jarda/.test(u)).map(u => u.replace('dotejdne-cmd.github.io/promontaz-jarda/', '')).sort();
    results.push('    načteno: ' + got.join(', '));
    assert.ok(!got.some(u => /jarda-app|config\.app|index\.json|jarda\.css/.test(u)), 'aplikace/katalog se nesmí stahovat před interakcí');
    assert.ok(got.length <= 4);
    assert.equal(await pg.$$eval('.pmj-fab', a => a.length), 1);
    assert.equal(await pg.$eval('.pmj-root', e => e.dataset.version), V);
  });
  await step('otevření nad cookie lištou, čip „Větší množství“ s produktem ze Shoptetu', async () => {
    await pg.click('.pmj-fab'); await pg.waitForSelector('.pmj-chip');
    const z = await pg.evaluate(() => { const r = document.querySelector('.pmj-q').getBoundingClientRect(); const el = document.elementFromPoint(r.x + 20, r.y + 10); return !!el.closest('.pmj-root'); });
    assert.ok(z, 'pole pro dotaz musí být nad cookie lištou');
    await pg.click('.pmj-chip-hot');
    const l = await pg.evaluate(() => JSON.parse(localStorage.pmj2_list));
    assert.equal(l[0].c, 'HR_10075');
    if (SH) await pg.screenshot({ path: SH + '/live-v3-open.png' });
  });
  await step('hledání na živém indexu: fotky (100×100 ze Shoptetu), ceny, kódy', async () => {
    const t0 = Date.now(); await ask(pg, 'vrut 5x60'); await pg.waitForSelector('.pmj-card', { timeout: 60000 });
    results.push(`    první hledání vč. stažení indexu: ${Date.now() - t0} ms`);
    await pg.waitForTimeout(1500);
    const imgs = await pg.$$eval('.pmj-cards:last-of-type .pmj-thumb', a => a.map(i => [i.naturalWidth, i.src.slice(0, 60)]));
    assert.ok(imgs.length === 5 && imgs.every(i => i[0] === 100), JSON.stringify(imgs));
    assert.match(await lastBot(pg), /Vrut konstrukční 5,0x60.*\n?.*Kč/);
    if (SH) await pg.screenshot({ path: SH + '/live-v3-search.png' });
  });
  await step('Do košíku: skutečné shoptet.cartShared.addToCart a potvrzení ze Shoptetu', async () => {
    const b = await pg.$('.pmj-bot:last-of-type .pmj-card button:has-text("Do košíku")');
    assert.ok(b, 'tlačítko Do košíku chybí');
    await b.click(); await pg.waitForSelector('button:has-text("✓ V košíku")', { timeout: 10000 });
    await pg.goto('https://www.promontaz.cz/kosik/');
    const items = await pg.evaluate(() => dataLayer.find(o => o.shoptet).shoptet.cartInfo.cartItems.map(i => i.code));
    assert.ok(items.length >= 1, JSON.stringify(items));
    results.push('    v košíku: ' + items.join(', '));
  });
  await step('košík: hláška do minima, košík → poptávka', async () => {
    await pg.waitForSelector('.pmj-fab', { timeout: 45000 }); await pg.click('.pmj-fab'); await pg.waitForSelector('.pmj-chip');
    const intro = await pg.$eval('.pmj-bot', e => e.innerText);
    assert.match(intro, /Do minimální objednávky chybí|Velký nákup/);
    await pg.click('.pmj-chip:has-text("Poslat košík k nacenění")'); await pg.waitForSelector('.pmj-form');
    assert.match(await pg.inputValue('.pmj-form textarea'), /\(kód /);
  });
  await step('montážní sada: komponenty podle SKU z popisu', async () => {
    await pg.goto('https://www.promontaz.cz/montazni-sady/sada-tesarske-kovani---1-000-vrutu-4-8--35-40-bit-tx20/');
    await pg.waitForSelector('.pmj-fab', { timeout: 45000 }); await pg.click('.pmj-fab'); await pg.waitForSelector('.pmj-chip');
    await pg.click('.pmj-chip:has-text("Co obsahuje sada")'); await pg.waitForSelector('.pmj-bot:last-of-type .pmj-cards', { timeout: 60000 });
    const n = await pg.$$eval('.pmj-bot:last-of-type .pmj-card-name', a => a.map(x => x.textContent));
    results.push('    komponenty: ' + n.join(' | '));
    assert.ok(n.length >= 2);
  });
  await step('dotazy: doprava, objednávka, produkt s jedním „rizikovým“ slovem', async () => {
    await ask(pg, 'kolik stojí doprava'); await pg.waitForTimeout(300); assert.match(await lastBot(pg), /133,10/);
    await ask(pg, 'kde je moje objednávka'); await pg.waitForTimeout(300); assert.match(await lastBot(pg), /zákaznickém účtu/);
    await ask(pg, 'telefonní kabel'); await pg.waitForTimeout(1500);
    const two = await pg.$$eval('.pmj-bot', b => b.slice(-2).map(x => x.innerText).join('|'));
    assert.match(two, /katalog/i);
  });
  await step('poptávka (dry run): formulář, návrat, poděkování, měření bez osobních údajů', async () => {
    await pg.click('.pmj-chip:has-text("Nacenit seznam nebo fotku")').catch(async () => { await ask(pg, 'nacenit seznam'); });
    await pg.waitForSelector('.pmj-form');
    await pg.fill('.pmj-form textarea', '20× vrut 5x60'); await pg.fill('.pmj-form input[type=email]', 'test@example.com');
    await Promise.all([pg.waitForNavigation(), pg.click('.pmj-send')]);
    await pg.waitForSelector('.pmj-panel:not([hidden])', { timeout: 20000 });
    assert.match(await pg.$$eval('.pmj-bot', b => b.map(x => x.innerText).join('|')), /jsme přijali/);
    // gtag() na webu ukládá volání do dataLayer jako objekty arguments → přečteme je odtud
    const g = await pg.evaluate(() => dataLayer.filter(c => c && typeof c === 'object' && !Array.isArray(c) && c[0] === 'event' && /^jarda_/.test(c[1])).map(c => [c[0], c[1], c[2]]));
    assert.ok(g.some(c => c[1] === 'jarda_quote_accepted'));
    assert.ok(g.every(c => c[2].send_to === 'GA4' && !/@/.test(JSON.stringify(c[2]))));
  });
  await step('pokladna: Jarda se nezobrazí', async () => {
    for (let i = 0; i < 1; i++) await pg.evaluate(() => fetch('/action/Cart/addCartItem/', { method: 'POST', body: new URLSearchParams({ productId: '52119', priceId: '52122', amount: '10', language: 'cs' }) }));
    await pg.goto('https://www.promontaz.cz/objednavka/krok-1/'); await pg.waitForTimeout(4000);
    assert.match(pg.url(), /objednavka/); assert.equal(await pg.$('.pmj-root'), null);
  });
  const m = await br.newContext({ ...devices['Pixel 7'] }); await setup(m, [], errs);
  const mp = await m.newPage();
  await step('mobil (Pixel 7 emulace): ikona, panel přes obrazovku, hledání s fotkami', async () => {
    await mp.goto('https://www.promontaz.cz/'); await mp.waitForSelector('.pmj-fab', { timeout: 45000 });
    const acc = await mp.$('.siteCookies__button--accept, button.js-cookiesConsentSubmit[value="all"]'); if (acc) await acc.click().catch(() => {});
    await mp.tap('.pmj-fab'); await mp.waitForSelector('.pmj-chip');
    await mp.fill('.pmj-q', 'cyky 3x2,5'); await mp.press('.pmj-q', 'Enter'); await mp.waitForSelector('.pmj-card', { timeout: 60000 });
    const [sw, iw] = await mp.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.equal(sw, iw);
    if (SH) { await mp.waitForTimeout(1000); await mp.screenshot({ path: SH + '/live-v3-mobile.png' }); }
  });
  await step('bez chyb JavaScriptu Jardy', async () => assert.deepEqual(errs, [], JSON.stringify(errs).slice(0, 400)));
  await br.close();
  console.log(results.join('\n')); console.log(`\n${results.filter(r => r[0] === '✓').length}/${results.filter(r => /^[✓✗]/.test(r)).length} prošlo`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
