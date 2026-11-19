/* Neveřejnou (ještě nenasazenou) verzi ověří na ŽIVÉM promontaz.cz: produkční Jarda se v testovacím prohlížeči
   nahradí soubory z tohoto repa (dist/<verze z package.json>, config*.json, assets). Web se nemění, poptávka
   se neodesílá (dry_run), košík je jen košík testovacího prohlížeče (bez objednávky).
   Spuštění: npm run build && node test/live/local.cjs   (MOBILE=1 → iPhone 13; SHOTS=adresář → snímky) */
const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
const REPO = path.resolve(__dirname, '../..'), V = require(REPO + '/package.json').version, SH = process.env.SHOTS;
const TYPES = { js: 'application/javascript', json: 'application/json', webp: 'image/webp', jpg: 'image/jpeg' };
const results = []; let failed = 0;
async function step(n, f) { for (let a = 0; a < 2; a++) { try { await f(); results.push('✓ ' + n + (a ? ' (2. pokus)' : '')); return; } catch (e) { if (a) { failed++; results.push('✗ ' + n + '\n    ' + String(e.message).split('\n').slice(0, 4).join('\n    ')); } } } }
const lastBot = pg => pg.evaluate(() => { const b = [...document.querySelectorAll('.pmj-bot')]; return b.length ? b[b.length - 1].innerText : ''; });
async function ask(pg, t) { await pg.fill('.pmj-q', t); await pg.press('.pmj-q', 'Enter'); }
const cart = pg => pg.evaluate(() => { const s = (window.dataLayer || []).find(x => x && x.shoptet); return s.shoptet.cartInfo.cartItems.map(i => [i.code, i.quantity]); });

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext(process.env.MOBILE ? { ...devices['iPhone 13'] } : { viewport: { width: 1366, height: 860 } });
  const errs = [];
  await ctx.addInitScript(() => { window.PMJ_CONFIG_OVERRIDE = { dry_run: true }; try { localStorage.removeItem('pmj_ver'); } catch (e) {} });
  await ctx.route(/dotejdne-cmd\.github\.io\/promontaz-jarda\/(.*?)(\?.*)?$/, r => {
    let f = /promontaz-jarda\/([^?]*)/.exec(r.request().url())[1];
    if (f === 'dist/stable/jarda.min.js') f = `dist/${V}/jarda.min.js`; // Zápatí → testovaná verze
    const p = path.join(REPO, f);
    if (!p.startsWith(REPO) || !fs.existsSync(p)) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ path: p, headers: { 'content-type': TYPES[path.extname(p).slice(1)] || 'application/octet-stream', 'access-control-allow-origin': '*' } });
  });
  ctx.on('page', p => p.on('pageerror', e => errs.push(e.message)));
  const pg = await ctx.newPage();
  const open = async () => { await pg.waitForSelector('.pmj-fab', { timeout: 45000 }); const ok = await pg.$('#pmj-panel:not([hidden])'); if (!ok) await pg.click('.pmj-fab'); await pg.waitForSelector('.pmj-chip', { timeout: 20000 }); };
  const accept = async () => { const b = await pg.$('.siteCookies button[data-cookie-value="all"], .siteCookies__button--accept, button:has-text("Souhlasím")'); if (b) { await b.click().catch(() => {}); await pg.waitForTimeout(500); } };

  await step(`verze ${V} běží na živém webu (jedna instance)`, async () => {
    await pg.goto('https://www.promontaz.cz/kalkulacky/', { waitUntil: 'load' }); await accept(); await open();
    assert.equal(await pg.$$eval('.pmj-root', a => a.map(x => x.dataset.version).join()), V);
  });
  await step('„250 ks vrut konstrukční 3,5x35“: najde produkt, ze stránky produktu zjistí balení 1000 ks → 1 bal., vloží do košíku Shoptetu', async () => {
    await ask(pg, '250 ks vrut konstrukční 3,5x35 zz');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-card', { timeout: 60000 });
    assert.match(await lastBot(pg), /Pro 250 ks/);
    const card = await pg.$('.pmj-bot:last-child .pmj-card:has(.pmj-code:has-text("VR_10005"))');
    assert.ok(card, 'VR_10005 ve výsledcích: ' + (await lastBot(pg)).slice(0, 300));
    await (await card.$('button:has-text("Do košíku")')).click();
    await pg.waitForSelector('.pmj-buy .pmj-qty', { timeout: 20000 });
    const t = await pg.$eval('.pmj-buy', e => e.innerText); results.push('    ' + t.replace(/\n+/g, ' | '));
    assert.match(t, /Prodává se po bal\. \(1000 ks\)/); assert.match(t, /Na 250 ks stačí 1 bal\./);
    assert.equal(await pg.$eval('.pmj-buy .pmj-qty', e => e.value), '1');
    if (SH) await pg.screenshot({ path: SH + '/live-buy.png' });
    await pg.click('.pmj-buy button:has-text("Vložit do košíku")');
    await pg.waitForFunction(() => /Vloženo do košíku: 1 bal\./.test([...document.querySelectorAll('.pmj-bot')].pop().innerText), null, { timeout: 15000 });
  });
  await step('„kabel cyky-j 3x2,5 25 m“: kabel po metrech → 25 m do košíku', async () => {
    await ask(pg, 'kabel cyky-j 3x2,5 25 m');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-card', { timeout: 30000 });
    const names = await pg.$$eval('.pmj-bot:last-child .pmj-card-name', a => a.map(x => x.textContent));
    assert.ok(names.every(n => /CYKY-J 3x2,5/.test(n)), names.join(' | '));
    await pg.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-buy .pmj-qty', { timeout: 20000 });
    results.push('    ' + (await pg.$eval('.pmj-bot:last-child .pmj-buy', e => e.innerText)).replace(/\n+/g, ' | '));
    assert.equal(await pg.$eval('.pmj-bot:last-child .pmj-buy .pmj-qty', e => e.value), '25');
    await pg.click('.pmj-bot:last-child .pmj-buy button:has-text("Vložit do košíku")');
    await pg.waitForFunction(() => /Vloženo do košíku: 25 m/.test([...document.querySelectorAll('.pmj-bot')].pop().innerText), null, { timeout: 15000 });
  });
  await step('košík Shoptetu obsahuje přesně 1 bal. VR_10005 a 25 m kabelu', async () => {
    await pg.goto('https://www.promontaz.cz/kosik/', { waitUntil: 'load' });
    const c = await cart(pg); results.push('    košík: ' + JSON.stringify(c));
    assert.deepEqual(c.find(x => x[0] === 'VR_10005'), ['VR_10005', 1]);
    assert.equal(c.filter(x => /^EL_KAB/.test(x[0])).map(x => x[1]).join(), '25');
  });
  await step('košík: doprava podle Shoptetu (zdarma od hodnoty z cartInfo), minimum 450 Kč', async () => {
    await open();
    await pg.click('.pmj-chip:has-text("Doprava a platba")'); await pg.waitForTimeout(400);
    const t = await lastBot(pg);
    assert.match(t, /Minimální objednávka je 450 Kč/); assert.match(t, /143,10 Kč/); assert.match(t, /Doprava zdarma od 5\s999 Kč/);
  });
  await step('vložený seznam na živém katalogu', async () => {
    await pg.click('.pmj-bot .pmj-chip:has-text("Vložit seznam materiálu")');
    await pg.fill('.pmj-bot:last-child textarea', '200 ks vrut konstrukční 3,5x35 zz\nkabel cyky-o 3x1,5 50 m\nhmoždinka\nosb 2500/1250/18\nzlatý hřebík 3x50');
    await pg.click('button:has-text("Najít v katalogu")');
    await pg.waitForSelector('.pmj-imp', { timeout: 60000 });
    const rows = await pg.$$eval('.pmj-imp-row', a => a.map(r => r.className.replace('pmj-imp-row pmj-imp-', '') + ': ' + r.innerText.replace(/\n+/g, ' | ')));
    rows.forEach(r => results.push('    ' + r));
    assert.deepEqual(rows.map(r => r.split(':')[0]), ['ok', 'ok', 'check', 'ok', 'none']);
    const vis = await pg.$$eval('.pmj-imp .pmj-cbx', a => a.map(c => c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== 'none'));
    assert.ok(vis.length === 3 && vis.every(Boolean), 'zaškrtávací políčka musí být vidět i se styly Merkuru: ' + vis);
    if (SH) await pg.screenshot({ path: SH + '/live-import.png' });
  });
  await step('produkt s variantami: Jarda nevloží, pošle na výběr varianty', async () => {
    await ask(pg, 'MAMUT GLUE FLEXI S2 20 kg');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-card', { timeout: 30000 });
    const t = await lastBot(pg);
    assert.ok(!/Do košíku/.test(t) || /Vybrat variantu/.test(t), t.slice(0, 200));
  });
  await step('bez chyb JavaScriptu', async () => { assert.deepEqual(errs, []); });
  await br.close();
  console.log(results.join('\n')); console.log(`\n${results.filter(r => r[0] === '✓').length}/${results.filter(r => /^[✓✗]/.test(r)).length} prošlo (živý web, verze ${V}${process.env.MOBILE ? ', iPhone 13' : ''})`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
