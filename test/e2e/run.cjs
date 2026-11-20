/* Regresní testy v prohlížeči (Playwright, Chromium) nad demo.html.
   Index se podstrkuje z test/fixture-index.json, takže test nepotřebuje síť ani živý e-shop.
   Spuštění: npm run build && npm run test:e2e   (VERBOSE=1 vypíše události) */
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const PORT = 8790 + Math.floor(Math.random() * 100);
const B = `http://127.0.0.1:${PORT}/demo.html`;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  let pn = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (pn.startsWith('/nacenit-material/')) pn = '/test/e2e/nacenit.html';
  const f = path.join(ROOT, pn);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const results = []; let failed = 0;
// Stránky produktů pro ověřený nákup: zjednodušený Shoptet (Merkur) – stejné značky, jaké čte src/buy.js
// (ověřeno proti skutečným stránkám v test/fixtures/*.html.gz jednotkovými testy test/buy.test.mjs).
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixture-index.json'), 'utf8'));
const PRODUCT = {}; // slug → přepis {unit, pack, min, step, max, variants, code, status}
function productHtml(slug) {
  const it = FIX.items.find(x => x[1] === slug + '/'); if (!it) return null;
  const o = Object.assign({ code: String(it[5]).split(' ')[0], price: it[3], unit: 'ks', pack: null, min: 1, step: 1, max: 9999, variants: !!it[8] }, PRODUCT[slug] || {});
  const m = /bal\. (\d+) ks/.exec(it[0]); if (m && !PRODUCT[slug]) { o.unit = 'bal'; o.pack = m[1] + ' ks'; }
  return `<html><body><div class="p-final-price-wrapper"><strong class="price-final"><span class="price-final-holder">${o.price} Kč<span class="pr-list-unit">/&nbsp;${o.unit}</span></span></strong></div>
  <span class="p-code"><span class="p-code-label">Kód:</span><span>${o.code}</span></span>
  <form action="/action/Cart/addCartItem/" method="post" id="product-detail-form"><meta itemprop="sku" content="${o.code}" /><meta itemprop="price" content="${o.price}.00" />
  ${o.variants ? '<select name="priceId"><option>A</option></select>' : ''}<input type="number" name="amount" value="1" class="amount" data-decimals="0" step="${o.step}" min="${o.min}" max="${o.max}" /></form>
  ${o.pack ? `<table><tr><th><span class="row-header-label">Obsah balení<span class="row-header-label-colon">:</span></span></th><td> ${o.pack} </td></tr></table>` : ''}</body></html>`;
}
const VER = require('../../package.json').version;
const STABLE = String((require('../../package.json').jarda || {}).stable || '2'), DEF = STABLE === '2' ? 'v2' : STABLE; // výchozí verze kanálu
async function step(name, fn) {
  try { await fn(); results.push('✓ ' + name); }
  catch (e) { failed++; results.push('✗ ' + name + '\n    ' + String(e.message).split("\n").slice(0, +(process.env.ELINES || 4)).join('\n    ')); }
}

async function ctxSetup(ctx, errs) {
  // Playwright: později přidané pravidlo má přednost → nejdřív obecné blokování sítě, pak podstrčené soubory
  await ctx.route(/^https:\/\/(?!127\.0\.0\.1)/, r => r.abort()); // nic dalšího ze sítě
  await ctx.route(/promontaz-search\/index\.json/, r => r.fulfill({ path: path.join(ROOT, 'test/fixture-index.json'), headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' } }));
  await ctx.route(/neexistuje\.json/, r => r.fulfill({ status: 404, body: 'nf' }));
  await ctx.route(/^https:\/\/www\.promontaz\.cz\/([a-z]+)\/$/, r => {
    const slug = /cz\/([a-z]+)\/$/.exec(r.request().url())[1], o = PRODUCT[slug] || {}, html = productHtml(slug);
    if (!html || o.status) return r.fulfill({ status: o.status || 404, body: 'nf', headers: { 'access-control-allow-origin': '*' } });
    r.fulfill({ body: html, headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' } });
  });
  await ctx.addInitScript(() => {
    window.__gtag = [];
    window.gtag = function () { window.__gtag.push(Array.from(arguments)); };
  });
  ctx.on('page', pg => {
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|404/.test(m.text())) errs.push(m.text()); });
  });
}
const events = pg => pg.evaluate(() => dataLayer.filter(o => o && /^jarda_/.test(o.event || '')).map(o => o.event));
const lastBot = pg => pg.evaluate(() => { const b = [...document.querySelectorAll('.pmj-bot')]; return b.length ? b[b.length - 1].innerText : ''; });
async function ask(pg, text) { await pg.fill('.pmj-q', text); await pg.press('.pmj-q', 'Enter'); await pg.waitForTimeout(250); }
async function openJarda(pg) { await pg.waitForSelector('.pmj-fab'); await pg.click('.pmj-fab'); await pg.waitForSelector('.pmj-chip'); }

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const br = await chromium.launch();
  const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 } }); await ctxSetup(ctx, errs);
  const pg = await ctx.newPage();
  const reqs = []; pg.on('request', q => reqs.push(q.url().replace(/^https?:\/\/[^/]+\//, '')));

  await step('zavaděč: při načtení jen zavaděč, config a logo (žádná aplikace, styly ani index)', async () => {
    await pg.goto(B + '?page=product'); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(500);
    const w = reqs.filter(u => /dist\/3|config|assets|index\.json/.test(u));
    assert.deepEqual(w.sort(), ['assets/jarda-128.webp', 'config.json', 'dist/' + VER + '/jarda.min.js']);
    assert.equal(await pg.$eval('.pmj-root', e => e.dataset.version), VER);
  });
  await step('otevření: stáhne aplikaci + config.app.json, kontextové čipy, fokus do pole', async () => {
    await openJarda(pg);
    const w = reqs.filter(u => /jarda-app|config\.app/.test(u));
    assert.equal(w.length, 2);
    const chips = await pg.$$eval('.pmj-chip', a => a.map(x => x.textContent));
    assert.equal(chips[0], 'Větší množství? Naceníme');
    assert.ok(chips.includes('Moje objednávka') && chips.includes('Napsat obchodníkovi'));
    assert.ok(await pg.evaluate(() => document.activeElement.classList.contains('pmj-q')));
    assert.equal(await pg.getAttribute('.pmj-fab', 'aria-expanded'), 'true');
  });
  await step('katalog: otevření ho nestahuje, začne se stahovat s prvním napsaným znakem', async () => {
    assert.ok(!reqs.some(u => /index\.json/.test(u)), 'po otevření bez psaní se katalog nestahuje');
    await pg.type('.pmj-q', 'k'); await pg.waitForTimeout(300);
    assert.equal(reqs.filter(u => /index\.json/.test(u)).length, 1);
    await pg.fill('.pmj-q', '');
  });
  await step('produkt: větší množství přidá produkt s množstvím z pole Množství', async () => {
    await pg.click('.pmj-chip-hot');
    const l = await pg.evaluate(() => JSON.parse(localStorage.pmj2_list));
    assert.equal(l[0].c, 'HR_10075'); assert.equal(l[0].q, 12);
    assert.equal(await pg.textContent('.pmj-badge'), '1');
  });
  await step('hledání: karta s cenou s DPH, kódem, „k nacenění“ a „Do košíku“', async () => {
    await ask(pg, 'turbo šroub 7,5 x 92'); await pg.waitForSelector('.pmj-card');
    const t = await pg.$eval('.pmj-cards .pmj-card', e => e.innerText);
    assert.match(t, /Turbo šroub/); assert.match(t, /319 Kč \/ bal \(100 ks\)\s+s DPH/); assert.match(t, /Kód: 8061BD/);
    assert.ok(await pg.$('.pmj-cards .pmj-card:first-child button:has-text("Do košíku")'));
  });
  await step('košík: nejdřív ověření balení na stránce produktu, vložení přes Shoptet API, potvrzení až po ShoptetCartUpdated', async () => {
    await pg.click('.pmj-cards .pmj-card:first-child button:has-text("Do košíku")');
    await pg.waitForSelector('.pmj-buy .pmj-qty', { timeout: 4000 });
    const t = await pg.$eval('.pmj-buy', e => e.innerText);
    assert.match(t, /Prodává se po bal\. \(100 ks\)/); assert.match(t, /= 319 Kč s DPH/);
    assert.equal(await pg.evaluate(() => window.__demoCart), undefined, 'bez potvrzení se nic nevkládá');
    await pg.click('.pmj-buy button:has-text("Vložit do košíku")');
    await pg.waitForSelector('button:has-text("✓ V košíku")', { timeout: 3000 });
    assert.deepEqual(await pg.evaluate(() => window.__demoCart), [{ productCode: '8061BD', amount: 1 }]);
    assert.match(await lastBot(pg), /Vloženo do košíku: 1 bal\. – Den Braven Turbo šroub/);
    const ev = await pg.evaluate(() => dataLayer.filter(o => o.event === 'jarda_add_to_cart').pop());
    assert.deepEqual([ev.result, ev.quantity, ev.item_id], ['ok', 1, '8061BD']);
  });
  await step('množství v dotazu: „250 ks turbo šroub 7,5x92“ najde produkt a navrhne 3 balení po 100 ks', async () => {
    await pg.evaluate(() => { window.__demoCart = []; });
    await ask(pg, '250 ks turbo šroub 7,5x92'); await pg.waitForSelector('.pmj-bot:last-child .pmj-card');
    assert.match(await lastBot(pg), /Pro 250 ks jsem v katalogu našel/);
    await pg.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-buy .pmj-qty');
    assert.equal(await pg.$eval('.pmj-bot:last-child .pmj-buy .pmj-qty', e => e.value), '3');
    assert.match(await pg.$eval('.pmj-bot:last-child .pmj-buy', e => e.innerText), /Na 250 ks stačí 3 bal\. \(300 ks\)/);
    await pg.click('.pmj-bot:last-child .pmj-buy button:has-text("Vložit do košíku")');
    await pg.waitForFunction(() => /Vloženo do košíku: 3 bal\./.test([...document.querySelectorAll('.pmj-bot')].pop().innerText));
    assert.deepEqual(await pg.evaluate(() => window.__demoCart), [{ productCode: '8061BD', amount: 3 }]);
  });
  await step('ověřený nákup: neplatné množství se nevloží; chybná stránka / jiný kód / varianty → jen odkaz, nic do košíku', async () => {
    await pg.evaluate(() => { window.__demoCart = []; });
    PRODUCT.ai = { min: 5, step: 5 }; // hmoždinka 10x35 nylon: min 5, po 5
    await ask(pg, 'hmoždinka turbo 10x35 nylon'); await pg.waitForSelector('.pmj-bot:last-child .pmj-card');
    await pg.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
    await pg.waitForSelector('.pmj-bot:last-child .pmj-buy .pmj-qty');
    assert.equal(await pg.$eval('.pmj-bot:last-child .pmj-buy .pmj-qty', e => e.value), '5');
    await pg.fill('.pmj-bot:last-child .pmj-buy .pmj-qty', '7');
    await pg.click('.pmj-bot:last-child .pmj-buy button:has-text("Vložit do košíku")');
    assert.match(await pg.$eval('.pmj-bot:last-child .pmj-buy', e => e.innerText), /od 5 do 9999 ks po 5/);
    assert.deepEqual(await pg.evaluate(() => window.__demoCart), []);
    // (výsledek ověření se pamatuje podle adresy → každý případ na jiném produktu)
    for (const [slug, q, o, re] of [['aj', 'hmoždinka turbo 10x35 Al', { status: 500 }, /nepodařilo ověřit/], ['ak', 'Turbo Speed MAMUTÍ', { code: 'JINY_KOD' }, /nepodařilo ověřit/], ['al', 'Turbo Speed COMBO', { variants: true }, /varianty/]]) {
      PRODUCT[slug] = o;
      await ask(pg, q); await pg.waitForSelector('.pmj-bot:last-child .pmj-card');
      await pg.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
      await pg.waitForFunction(() => { const b = [...document.querySelectorAll('.pmj-buy')].pop(); return b && !/Ověřuji/.test(b.innerText); });
      const t = await pg.$eval('.pmj-bot:last-child .pmj-buy', e => e.innerText);
      assert.match(t, re, JSON.stringify(o)); assert.ok(!/Vložit do košíku/.test(t));
    }
    assert.deepEqual(await pg.evaluate(() => window.__demoCart), []);
    for (const k of ['ai', 'aj', 'ak', 'al']) delete PRODUCT[k];
  });
  await step('kliknutí na produkt se měří (pozice, kód, dotaz)', async () => {
    await pg.$eval('.pmj-cards .pmj-card:first-child .pmj-card-name', a => { a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); });
    const ev = await pg.evaluate(() => dataLayer.filter(o => o.event === 'jarda_product_click').pop());
    assert.equal(ev.item_id, '8061BD'); assert.equal(ev.index, 1); assert.equal(ev.search_term, 'turbo šroub 7,5 x 92');
  });
  await step('nenalezeno: chybějící slovo, nabídka bez něj (na kliknutí), přidání k nacenění', async () => {
    await ask(pg, 'kotva m8 nerez'); await pg.waitForTimeout(200);
    assert.match(await lastBot(pg), /„nerez“/);
    await pg.click('button:has-text("Ukázat výsledky jen pro")');
    assert.match(await lastBot(pg), /Výsledky bez „nerez“/);
    assert.match(await lastBot(pg), /M8x80/);
    const nr = await pg.evaluate(() => dataLayer.filter(o => o.event === 'jarda_search_no_results').pop());
    assert.equal(nr.missing_term, 'nerez');
  });
  await step('záměry: doprava, objednávka, faktura, B2B, obchodník; produkt se nepřesměruje', async () => {
    await ask(pg, 'kolik stojí poštovné?'); assert.match(await lastBot(pg), /Minimální objednávka je 450 Kč/);
    await ask(pg, 'kde je moje objednávka'); assert.match(await lastBot(pg), /Stav objednávky/);
    await ask(pg, 'pošlete mi kopii faktury'); assert.match(await lastBot(pg), /S fakturou/);
    await ask(pg, 'chci mluvit s obchodníkem'); assert.match(await lastBot(pg), /WhatsApp/);
    await ask(pg, 'telefonní kabel'); await pg.waitForTimeout(200);
    const all = await pg.$$eval('.pmj-bot', b => b.slice(-2).map(x => x.innerText).join('|'));
    assert.match(all, /nevidím|katalogu/); assert.match(all, /Chcete spíš poradit/);
    await ask(pg, 'faktura objednávka'); assert.match(await lastBot(pg), /Upřesněte/);
  });
  await step('seznam: úprava množství a mazání', async () => {
    await pg.click('.pmj-listbtn');
    await pg.fill('.pmj-list .pmj-row:first-child .pmj-qty', '30'); await pg.press('.pmj-list .pmj-row:first-child .pmj-qty', 'Tab');
    assert.equal((await pg.evaluate(() => JSON.parse(localStorage.pmj2_list)))[0].q, 30);
  });
  await step('poptávka: validace kontaktu, PSČ, IČO a příloh (ZIP, podvržený XLSX)', async () => {
    await pg.click('.pmj-list .pmj-btn-primary'); await pg.waitForSelector('.pmj-form');
    assert.match(await pg.textContent('.pmj-form .pmj-qsum'), /30× Kramle tesařská 10x200 \(HR_10075\)/, 'kontrola seznamu přímo ve formuláři');
    assert.equal(await pg.inputValue('.pmj-form textarea'), '', 'pole je jen pro doplnění, seznam se do něj neopisuje');
    await pg.click('.pmj-send'); assert.match(await pg.textContent('.pmj-err'), /e-mail nebo telefon/);
    await pg.fill('.pmj-form input[type=tel]', '722 111 222');
    await pg.fill('.pmj-form input[autocomplete=postal-code]', '1100'); await pg.click('.pmj-send');
    assert.match(await pg.textContent('.pmj-err'), /PSČ/);
    await pg.fill('.pmj-form input[autocomplete=postal-code]', '11000');
    await pg.click('.pmj-more summary'); await pg.fill('.pmj-more input', '12345678'); await pg.click('.pmj-send');
    assert.match(await pg.textContent('.pmj-err'), /IČO/);
    await pg.fill('.pmj-more input', '27082440');
    await pg.setInputFiles('.pmj-form input[type=file]', [
      { name: 'foto.png', mimeType: 'image/png', buffer: PNG },
      { name: 'podklady.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04zip') },
      { name: 'falesny.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not a zip') }]);
    await pg.waitForTimeout(300);
    assert.equal(await pg.$$eval('.pmj-files li', l => l.length), 1);
    const e = await pg.textContent('.pmj-err');
    assert.match(e, /ZIP nepřijímáme/); assert.match(e, /falesny\.xlsx.*neodpovídá/);
  });
  await step('poptávka: rozepsaná se uloží (sessionStorage), ne do localStorage', async () => {
    await pg.waitForTimeout(500);
    const d = await pg.evaluate(() => JSON.parse(sessionStorage.pmj2_draft));
    assert.equal(d.zip, '11000'); assert.equal(d.ico, '27082440');
    assert.ok(!(await pg.evaluate(() => JSON.stringify(localStorage))).includes('722 111 222'));
  });
  await step('odeslání: skrytý formulář s poli FormSubmit, návrat = přijato, seznam a koncept smazány', async () => {
    let fields = null;
    await pg.exposeFunction('__capture', f => { fields = f; });
    await pg.evaluate(() => { const o = HTMLFormElement.prototype.submit; HTMLFormElement.prototype.submit = function () { window.__capture([...new FormData(this).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'FILE:' + v.name])); return o.call(this); }; });
    await Promise.all([pg.waitForNavigation(), pg.click('.pmj-send')]);
    await pg.waitForSelector('.pmj-panel:not([hidden])');
    assert.match(await lastBot(pg), /poptávku č\. PM-\d{6}-J[A-Z0-9]{6} jsme přijali/);
    assert.equal(await pg.evaluate(() => localStorage.pmj2_list || null), null);
    assert.equal(await pg.evaluate(() => sessionStorage.pmj2_draft || null), null);
    assert.ok(!/pmj_sent/.test(pg.url()));
    const ev = await events(pg);
    assert.ok(ev.includes('jarda_quote_accepted') && ev.includes('jarda_quote_sent'));
    assert.equal(fields, null, 'dry_run nesmí volat submit');
  });
  await step('duplicita: obnovení stránky se stejným číslem nezapočítá poptávku znovu', async () => {
    const id = await pg.evaluate(() => JSON.parse(sessionStorage.pmj2_sent)[0]);
    await pg.goto(B + '?page=product&pmj_sent=' + id); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(800);
    assert.ok(!(await events(pg)).includes('jarda_quote_accepted'));
  });
  // formsubmit.co v testu: 'hang' = výpadek (522 po ~20 s → kontrola po 6 s), 'fail' = rychlá chyba 522, 'ok' = přijato (302 na _next)
  const window_log = [];
  async function formsubmit(page, mode) {
    await page.unroute(/formsubmit\.co/).catch(() => {});
    await page.route(/^https:\/\/formsubmit\.co\//, async r => {
      const q = r.request();
      if (mode === 'hang') return; // nikdy neodpoví
      if (q.method() === 'HEAD') return r.fulfill({ status: mode === 'fail' ? 522 : 200, body: '' });
      if (/\/ajax\//.test(q.url())) { // AJAX endpoint (od 3.0.5)
        const cors = { 'access-control-allow-origin': '*' };
        if (q.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { ...cors, 'access-control-allow-headers': 'Content-Type, Accept' }, body: '' });
        window_log.push({ url: q.url(), body: q.postData() || '' });
        if (mode === 'nores') return; // bez odpovědi
        if (mode === 'reject') return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"success":"false","message":"This form needs Activation"}' });
        if (mode === 'fail') return r.fulfill({ status: 522, headers: cors, contentType: 'text/html', body: 'error code: 522' });
        return r.fulfill({ status: 200, headers: cors, contentType: 'text/html; charset=UTF-8', body: '{"success":"true","message":"The form was submitted successfully."}' });
      }
      if (mode === 'fail') return r.fulfill({ status: 522, contentType: 'text/html', body: '<h1>Error 522 Connection timed out</h1>' });
      window_log.push({ url: q.url(), body: (q.postDataBuffer() || Buffer.alloc(0)).toString('latin1') }); // surové bajty (soubory)
      const next = /name="_next"\r\n\r\n([^\r]+)/.exec(q.postData() || '');
      return r.fulfill({ status: 302, headers: { location: next ? next[1] : '/' }, body: '' });
    });
  }
  async function quoteForm(page, url, noFiles) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(url); await openJarda(page);
    await page.click('.pmj-chip-hot'); await page.click('.pmj-chip:has-text("Nacenit seznam nebo fotku")'); await page.waitForSelector('.pmj-form');
    await page.fill('.pmj-form input[type=tel]', '000 000 000');
    if (!noFiles) { await page.setInputFiles('.pmj-form input[type=file]', [{ name: 'foto.png', mimeType: 'image/png', buffer: PNG }]); await page.waitForTimeout(300); }
  }
  await step('výpadek FormSubmitu (522): neodejde se ze stránky, „NEBYLA odeslána“, připravený e-mail se seznamem, nic jako odeslané', async () => {
    await formsubmit(pg, 'hang');
    await quoteForm(pg, B + '?page=product&live=1');
    const t0 = Date.now(); await pg.click('.pmj-send');
    await pg.waitForSelector('.pmj-bot:has-text("NEBYLA odeslána")', { timeout: 20000 });
    const lim = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.app.json'), 'utf8')).quote.probe_timeout_ms; // 12 s od 3.1.1 (FormSubmit odpovídá i za 5–6 s)
    assert.ok(Date.now() - t0 < lim + 3000, `kontrola služby má skončit do ~${lim / 1000} s`);
    assert.match(pg.url(), /demo\.html/);
    const href = await pg.$eval('a:has-text("Otevřít připravený e-mail")', a => a.href);
    assert.match(decodeURIComponent(href), /^mailto:info@promontaz\.cz\?subject=Poptávka PM-\d{6}-J\w{6} \(záložní e-mail\)&body=/);
    const body = decodeURIComponent(href.split('&body=')[1]);
    assert.match(body, /Kramle tesařská 10x200/); assert.match(body, /Telefon: 000 000 000/); assert.match(body, /Přílohy \(přikládám k tomuto e-mailu\): foto\.png/);
    assert.match(await lastBot(pg), /Přílohy do e-mailu přiložte ručně: foto\.png/);
    assert.equal(await pg.$eval('.pmj-send', b => b.disabled), false);
    const ev = await events(pg);
    assert.ok(ev.includes('jarda_quote_fallback') && !ev.includes('jarda_quote_submit') && !ev.includes('jarda_quote_accepted'));
    assert.equal(await pg.evaluate(() => sessionStorage.pmj2_pending || null), null);
    assert.equal(JSON.parse(await pg.evaluate(() => localStorage.pmj2_list)).length, 1);
    await pg.click('button:has-text("Zkopírovat poptávku")'); await pg.waitForTimeout(200);
    assert.match(await pg.textContent('button:has-text("Zkopír")'), /Zkopírováno|použijte e-mail/);
  });
  await step('s přílohou: klasický multipart s _captcha=false a souborem, návrat přes _next → české potvrzení, jeden POST', async () => {
    await formsubmit(pg, 'ok'); window_log.length = 0;
    await quoteForm(pg, B + '?page=product&live=1');
    await Promise.all([pg.waitForNavigation(), pg.click('.pmj-send')]);
    await pg.waitForSelector('.pmj-bot:has-text("jsme přijali")', { timeout: 10000 });
    assert.equal(window_log.length, 1, 'právě jeden POST');
    assert.match(window_log[0].url, /^https:\/\/formsubmit\.co\/info@promontaz\.cz$/);
    const body = window_log[0].body;
    assert.match(body, /name="_captcha"\r\n\r\nfalse/); assert.match(body, /name="attachment"; filename="foto\.png"/); assert.match(body, /Content-Type: image\/png/);
    assert.ok(body.includes(PNG.toString('latin1').slice(0, 8)), 'obsah souboru v těle požadavku');
    // žádné odkazy v polích (jinak FormSubmit nepřesměruje): stránka i produkty jako cesta
    const fields = body.split(/-{6,}\S+/).filter(x => /name="[^_]/.test(x) && !/filename=/.test(x)).map(x => x.split('\r\n\r\n').slice(1).join(''));
    assert.ok(fields.length > 5 && fields.every(v => !/https?:\/\/\S|\bwww\.\S/i.test(v)), fields.filter(v => /https?:\/\/\S|www\.\S/.test(v)).join(' | ')); // odkaz, který FormSubmitu vadí
    assert.match(body, /name="Str\xc3\xa1nka"\r\n\r\nhttp:\/\/ 127\.0\.0\.1:\d+\/demo\.html/); // cizí doména jen rozbitá mezerou
    assert.ok((await events(pg)).includes('jarda_quote_accepted'));
    assert.equal(await pg.evaluate(() => localStorage.pmj2_list || null), null);
  });
  await step('bez přílohy: AJAX, potvrzení až po odpovědi success, zákazník zůstává na stránce', async () => {
    await formsubmit(pg, 'ok'); window_log.length = 0;
    await quoteForm(pg, B + '?page=product&live=1', true);
    await pg.click('.pmj-send');
    await pg.waitForSelector('.pmj-bot:has-text("jsme přijali")', { timeout: 10000 });
    assert.match(pg.url(), /demo\.html\?page=product/);
    assert.equal(window_log.length, 1); assert.match(window_log[0].url, /formsubmit\.co\/ajax\/info@promontaz\.cz/);
    assert.equal(await pg.$('.pmj-form'), null, 'formulář po přijetí zmizí');
  });
  await step('služba poptávku odmítne ({"success":"false"}): nic se nepotvrdí, záložní e-mail, údaje zůstávají', async () => {
    await formsubmit(pg, 'reject'); window_log.length = 0;
    await quoteForm(pg, B + '?page=product&live=1', true);
    await pg.click('.pmj-send');
    await pg.waitForSelector('.pmj-bot:has-text("nepřijala")', { timeout: 10000 });
    assert.match(await lastBot(pg), /NEBYLA odeslána/); assert.match(await lastBot(pg), /needs Activation/);
    const ev = await events(pg); assert.ok(!ev.includes('jarda_quote_accepted') && ev.includes('jarda_quote_fallback'));
    assert.equal(JSON.parse(await pg.evaluate(() => localStorage.pmj2_list)).length, 1);
    assert.equal(await pg.$eval('.pmj-send', b => b.disabled), false);
    assert.equal(window_log.length, 1, 'žádné automatické opakování');
  });
  await step('služba neodpoví (časový limit): „nepodařilo se ověřit“, žádné automatické opakování, údaje zůstávají', async () => {
    await formsubmit(pg, 'nores'); window_log.length = 0;
    await quoteForm(pg, B + '?page=product&live=1', true);
    await pg.evaluate(() => { window.PMJ_APP_CONFIG_OVERRIDE = { quote: { send_timeout_ms: 1500 } }; });
    await pg.click('.pmj-send');
    await pg.waitForSelector('.pmj-bot:has-text("Nepodařilo se ověřit")', { timeout: 100000 });
    assert.equal(window_log.length, 1);
    assert.ok(!(await events(pg)).includes('jarda_quote_accepted'));
    assert.equal(JSON.parse(await pg.evaluate(() => localStorage.pmj2_list)).length, 1);
    await pg.unroute(/formsubmit\.co/);
  });
  await step('/nacenit-material/ s ochranou: výpadek → nic se neodešle, e-mail se seznamem a přílohou, údaje zůstávají', async () => {
    const np = await ctx.newPage(); await formsubmit(np, 'hang');
    const posts = []; np.on('request', q => { if (/formsubmit\.co/.test(q.url()) && q.method() === 'POST') posts.push(1); });
    await np.goto(B.replace('demo.html', 'nacenit-material/')); await np.waitForFunction(() => window.__pmjGuardOn, null, { timeout: 15000 });
    await np.setInputFiles('#pmq-files', [{ name: 'seznam.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK\x03\x04x') }]);
    await np.click('#pmq-send');
    await np.waitForSelector('#pmj-guard-box', { timeout: 12000 });
    const r = await np.evaluate(() => ({ url: location.pathname, btn: document.getElementById('pmq-send').disabled, msg: document.getElementById('pmq-message').value,
      text: document.getElementById('pmj-guard-box').innerText, href: document.querySelector('#pmj-guard-box a').href }));
    assert.equal(r.url, '/nacenit-material/'); assert.equal(r.msg, '20× vrut 5x60'); assert.match(r.text, /Obnovte stránku/);
    assert.match(r.text, /NEBYLA odeslána/); assert.match(r.text, /seznam\.xlsx/);
    const body = decodeURIComponent(r.href.split('&body=')[1]); assert.match(body, /PM-261107-ABCDEF/); assert.match(body, /Text poptávky: 20× vrut 5x60/);
    assert.equal(posts.length, 0);
    await np.close();
  });
  await step('/nacenit-material/ s nacenit_direct: _captcha=false, příloha v POSTu, návrat na vlastní poděkování (?odeslano=ID)', async () => {
    const np = await ctx.newPage(); await formsubmit(np, 'ok'); window_log.length = 0;
    await np.goto(B.replace('demo.html', 'nacenit-material/') + '?direct=1'); await np.waitForFunction(() => window.__pmjGuardOn, null, { timeout: 15000 });
    await np.fill('#pmq-message', 'výkres: https://www.uschovna.cz/zasilka/ABC');
    await np.setInputFiles('#pmq-files', [{ name: 'rozpocet.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }]);
    await np.click('#pmq-send'); await np.waitForURL(/odeslano=PM-261107-ABCDEF/, { timeout: 15000 });
    assert.equal(window_log.length, 1); assert.match(window_log[0].url, /^https:\/\/formsubmit\.co\/info@promontaz\.cz$/);
    assert.match(window_log[0].body, /name="_captcha"\r\n\r\nfalse/); assert.match(window_log[0].body, /filename="rozpocet\.pdf"/); assert.match(window_log[0].body, /%PDF-1\.4 test/);
    assert.match(window_log[0].body, /https:\/\/ www \.uschovna\.cz/); assert.ok(!/https:\/\/www\./.test(window_log[0].body.replace(/name="_next"[^-]*/, '')));
    await np.close();
  });
  await step('/nacenit-material/ bez nacenit_direct: odeslání beze změny (bez _captcha)', async () => {
    const np = await ctx.newPage(); await formsubmit(np, 'ok'); window_log.length = 0;
    await np.goto(B.replace('demo.html', 'nacenit-material/')); await np.waitForFunction(() => window.__pmjGuardOn, null, { timeout: 15000 });
    await np.click('#pmq-send'); await np.waitForURL(/odeslano=/, { timeout: 15000 });
    assert.ok(!/name="_captcha"/.test(window_log[0].body));
    await np.close();
  });
  await step('/nacenit-material/ bez zapnutí v configu: ochrana se nenačte (formulář beze změny)', async () => {
    const np = await ctx.newPage();
    await np.addInitScript(() => { Object.defineProperty(window, 'PMJ_CONFIG_OVERRIDE', { configurable: true, get: () => ({ formsubmit_guard: { nacenit: false } }), set: () => {} }); });
    await np.goto(B.replace('demo.html', 'nacenit-material/')); await np.waitForSelector('.pmj-fab'); await np.waitForTimeout(500);
    assert.equal(await np.evaluate(() => !!window.__pmjGuardOn), false);
    await np.close();
  });
  await step('neověřené odeslání: bez návratu z FormSubmitu upozorní, seznam zůstává', async () => {
    await pg.evaluate(() => { sessionStorage.pmj2_pending = JSON.stringify({ id: 'PM-261106-JTEST01', t: Date.now() - 60000, n: 2, f: 0 }); localStorage.pmj2_list = JSON.stringify([{ n: 'Test', q: 2 }]); });
    await pg.reload(); await openJarda(pg);
    assert.match(await pg.$$eval('.pmj-bot', b => b.map(x => x.innerText).join('|')), /PM-261106-JTEST01 se možná neodeslala/);
    assert.ok((await events(pg)).includes('jarda_quote_unconfirmed'));
  });
  await step('GA4: události jdou jen do skupiny GA4, bez e-mailu a telefonu', async () => {
    const g = await pg.evaluate(() => window.__gtag);
    assert.ok(g.length > 0);
    for (const c of g) { assert.equal(c[0], 'event'); assert.equal(c[2].send_to, 'GA4'); assert.ok(!/@|722 111 222|\d{3} \d{3} \d{3}/.test(JSON.stringify(c[2])), JSON.stringify(c)); }
  });
  await step('žádný <form> uvnitř Jardy (automatické sledování formulářů gtag → Ads)', async () => {
    await pg.click('.pmj-fab').catch(() => {});
    assert.equal(await pg.$$eval('#pmj-jarda form', f => f.length), 0);
    await pg.keyboard.press('Escape');
    await pg.click('.pmj-fab'); await pg.waitForSelector('.pmj-panel:not([hidden])');
  });
  await step('Esc zavře panel a vrátí fokus na ikonu', async () => {
    await pg.keyboard.press('Escape');
    assert.ok(await pg.isHidden('.pmj-panel'));
    assert.ok(await pg.evaluate(() => document.activeElement.classList.contains('pmj-fab')));
  });
  await step('košík: hláška do minima a „Poslat košík k nacenění“ převezme položky', async () => {
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await pg.goto(B + '?page=cart'); await openJarda(pg);
    assert.match(await lastBot(pg), /Do minimální objednávky chybí 346 Kč/);
    await pg.click('.pmj-chip:has-text("Poslat košík k nacenění")'); await pg.waitForSelector('.pmj-form');
    assert.match(await pg.textContent('.pmj-form .pmj-qsum'), /2× Kramle tesařská 10x200 \(HR_10075\)/);
  });
  await step('košík: bez automatické bubliny', async () => {
    await pg.evaluate(() => sessionStorage.clear());
    await pg.goto(B + '?page=cart&auto=fast'); await pg.waitForTimeout(4500);
    assert.ok(await pg.isHidden('.pmj-teaser'));
  });
  await step('montážní sada: komponenty jen podle SKU v popisu', async () => {
    await pg.goto(B + '?page=sada'); await openJarda(pg);
    await pg.click('.pmj-chip:has-text("Co obsahuje sada")'); await pg.waitForSelector('.pmj-cards');
    const n = await pg.$$eval('.pmj-bot:last-child .pmj-card-name', a => a.map(x => x.textContent));
    assert.equal(n.length, 2); assert.match(n.join('|'), /Vrut univerzální 4,0x40/); assert.match(n.join('|'), /Okenní šroub/);
  });
  await step('varianty a chybějící Shoptet API: bez tlačítka Do košíku', async () => {
    await pg.goto(B + '?page=category&nocart=1'); await openJarda(pg);
    await ask(pg, 'osb 18'); await pg.waitForSelector('.pmj-card');
    assert.equal(await pg.$$eval('button:has-text("Do košíku")', a => a.length), 0);
  });
  await step('nedostupný index: srozumitelná hláška a nacenění dál funguje', async () => {
    await pg.goto(B + '?page=category&index=broken'); await openJarda(pg);
    await ask(pg, 'osb 18'); await pg.waitForTimeout(400);
    assert.match(await lastBot(pg), /nepodařilo načíst/);
  });
  await step('bublina: jednou za relaci, „Neotevírat automaticky“ ji vypne', async () => {
    await pg.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await pg.goto(B + '?page=category&auto=fast'); await pg.waitForSelector('.pmj-teaser:not([hidden])', { timeout: 6000 });
    assert.match(await pg.textContent('.pmj-teaser'), /Hledáte konkrétní rozměr/);
    await pg.reload(); await pg.waitForTimeout(4500); assert.ok(await pg.isHidden('.pmj-teaser'));
    await pg.evaluate(() => sessionStorage.clear()); await pg.reload();
    await pg.waitForSelector('.pmj-teaser:not([hidden])', { timeout: 6000 }); await pg.click('.pmj-toff');
    await pg.evaluate(() => sessionStorage.clear()); await pg.reload(); await pg.waitForTimeout(4500);
    assert.ok(await pg.isHidden('.pmj-teaser'));
  });
  await step('přístupnost (axe-core, WCAG 2.1 AA) v otevřeném panelu s výsledky a formulářem', async () => {
    await pg.goto(B + '?page=product'); await openJarda(pg);
    await ask(pg, 'osb 18'); await pg.waitForSelector('.pmj-card');
    await pg.click('.pmj-chip:has-text("Nacenit seznam nebo fotku")'); await pg.waitForSelector('.pmj-form');
    await pg.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const r = await pg.evaluate(() => axe.run('#pmj-jarda', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
    const v = r.violations.map(x => `${x.id} (${x.impact}): ${x.nodes.length}× ${x.nodes[0].target}`);
    assert.deepEqual(v, []);
  });

  const inst = p2 => p2.evaluate(() => ({ fabs: document.querySelectorAll('.pmj-fab').length, ver: (document.querySelector('.pmj-root') || {}).dataset ? document.querySelector('.pmj-root').dataset.version || 'v2' : '' }));
  await step('kanál stable: všichni zákazníci dostanou výchozí verzi (jedna instance)', async () => {
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await pg.goto(B + '?page=category&ch=1'); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(800);
    assert.deepEqual(await inst(pg), { fabs: 1, ver: DEF });
  });
  await step('kanál: ?pmj_ver=<verze> zapne v3 jen v tomto prohlížeči a pamatuje si to', async () => {
    await pg.goto(B + '?page=category&ch=1&pmj_ver=' + VER); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(800);
    assert.deepEqual(await inst(pg), { fabs: 1, ver: VER });
    await pg.goto(B + '?page=category&ch=1'); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(800);
    assert.deepEqual(await inst(pg), { fabs: 1, ver: VER });
    const ctx2 = await br.newContext(); const o = await ctx2.newPage();  // jiný prohlížeč = jiný zákazník
    await ctxSetup(ctx2, errs); await o.goto(B + '?page=category&ch=1'); await o.waitForSelector('.pmj-fab'); await o.waitForTimeout(800);
    assert.deepEqual(await inst(o), { fabs: 1, ver: DEF }); await ctx2.close();
  });
  await step('kanál: ?pmj_ver=reset vrátí výchozí; neexistující verze spadne na výchozí', async () => {
    await pg.goto(B + '?page=category&ch=1&pmj_ver=reset'); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(800);
    assert.deepEqual(await inst(pg), { fabs: 1, ver: DEF });
    await pg.goto(B + '?page=category&ch=1&pmj_ver=9.9.9'); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(1200);
    assert.deepEqual(await inst(pg), { fabs: 1, ver: DEF });
    assert.equal(await pg.evaluate(() => localStorage.pmj_ver || null), null);
    await pg.goto(B + '?page=category&pmj_ver=9.9.9'); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(1200); // přímý řádek v3
    assert.deepEqual(await inst(pg), { fabs: 1, ver: VER });
  });
  await step('kanál: v3 → ?pmj_ver=2 načte v2; dva řádky v Zápatí = stále jedna instance', async () => {
    await pg.goto(B + '?page=category&pmj_ver=2'); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(800);
    assert.deepEqual(await inst(pg), { fabs: 1, ver: 'v2' });
    for (const v of ['2', VER]) {
      await pg.goto(B + '?page=category&ch=1&both=1&pmj_ver=' + v); await pg.waitForSelector('.pmj-fab'); await pg.waitForTimeout(1200);
      assert.equal((await inst(pg)).fabs, 1, 'pmj_ver=' + v);
    }
    await pg.goto(B + '?page=category&pmj_ver=reset');
  });

  const c3 = await br.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true }); await ctxSetup(c3, errs);
  const p3 = await c3.newPage();
  await step('vložený seznam: řádky → produkty z katalogu, upozornění na chybějící počet a nejasné položky, přidání k nacenění', async () => {
    await p3.goto(B + '?page=category'); await openJarda(p3);
    await p3.click('.pmj-chip:has-text("Vložit seznam materiálu")');
    await p3.fill('.pmj-bot:last-child textarea', '1. 250 ks turbo šroub 7,5x92\n- kabel CYKY-J 3x2,5 50 m\nkabel\nkramle tesařská 10x200\nzlatý hřebík 3x50 20 ks');
    await p3.click('button:has-text("Najít v katalogu")');
    await p3.waitForSelector('.pmj-imp');
    const rows = await p3.$$eval('.pmj-imp-row', a => a.map(r => [r.className.replace('pmj-imp-row pmj-imp-', ''), r.querySelector('.pmj-imp-q').textContent, (r.querySelector('.pmj-cbx') || {}).checked === true]));
    assert.deepEqual(rows, [['ok', '250 ks', true], ['ok', '50 m', true], ['check', '?', false], ['none', '?', false], ['none', '20 ks', false]]);
    assert.match(await lastBot(p3), /chybí počet/); assert.match(await lastBot(p3), /upřesněte rozměr nebo typ/);
    assert.match(await p3.$eval('.pmj-imp-check a', a => a.getAttribute('href')), /^\/vyhledavani\/\?string=kabel$/);
    const ev = await p3.evaluate(() => dataLayer.filter(o => o.event === 'jarda_list_import').pop());
    assert.deepEqual([ev.lines, ev.matched, ev.ambiguous, ev.unmatched, ev.missing_qty], [5, 2, 1, 2, 2]);
    await p3.click('button:has-text("Přidat vše k nacenění (5)")');
    const l = await p3.evaluate(() => JSON.parse(localStorage.pmj2_list));
    // 3.2: nezadaný počet zůstává neuvedený (q = 0), nikdy 1 ks; u textové položky se počet z řádku převezme zvlášť
    assert.deepEqual(l.map(x => [x.q, x.un, x.c, x.f, x.n]).slice(2), [[0, '', '', 1, 'kabel'], [0, '', '', 1, 'kramle tesařská 10x200'], [20, 'ks', '', 1, 'zlatý hřebík 3x50']]);
    assert.deepEqual(l.map(x => [x.q, x.un, x.c, x.f]).slice(0, 2), [[250, 'ks', '8061BD', 0], [50, 'm', 'EL_KAB_17022', 0]]);
    const sum = await p3.$eval('.pmj-form .pmj-qsum', e => e.innerText);
    assert.match(sum, /250 ks Den Braven Turbo šroub[^\n]*\n50 m Kabel CYKY-J 3x2,5 \(C\)[^\n]*\nkabel – počet neuveden/);
    assert.match(sum, /U 2 položek chybí počet/);
  });
  await step('seznam: export do CSV pro Excel (UTF-8, středníky) a vložení víceřádkového textu do pole', async () => {
    await p3.click('.pmj-listbtn');
    const [dl] = await Promise.all([p3.waitForEvent('download'), p3.click('.pmj-list button:has-text("Stáhnout pro Excel (CSV)")')]);
    assert.equal(dl.suggestedFilename(), 'promontaz-seznam-materialu.csv');
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(csv.startsWith('﻿Množství;Jednotka;Název;Kód;Odkaz\r\n250;ks;Den Braven Turbo šroub'), csv.slice(0, 120));
    await p3.focus('.pmj-q');
    await p3.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'OSB 18\t12\nkramle 10x200 5 ks'); document.querySelector('.pmj-q').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await p3.waitForSelector('.pmj-bot:last-child .pmj-imp');
    assert.deepEqual(await p3.$$eval('.pmj-bot:last-child .pmj-imp-q', a => a.map(x => x.textContent)), ['12×', '5 ks']);
    assert.equal(await p3.$eval('.pmj-q', e => e.value), '');
  });
  await step('kalkulačky: window.PMJ.add (i fronta před načtením) přidá výsledek, cizí odkazy zahodí, otevře seznam', async () => {
    await p3.evaluate(() => localStorage.removeItem('pmj2_list'));
    await p3.goto(B + '?page=category'); await p3.waitForSelector('.pmj-fab');
    const n = await p3.evaluate(() => window.PMJ.add({ source: 'kalk-osb', items: [
      { n: 'OSB 2500/1250/18 RH', c: 'J_00076', u: 'https://www.promontaz.cz/v/', q: 14, un: 'ks' },
      { n: '<img src=x onerror=alert(1)>', u: 'https://evil.example/x', q: -5, un: 'kg' }, { n: '' }] }));
    assert.equal(n, 2);
    await p3.waitForSelector('.pmj-list .pmj-row');
    const l = await p3.evaluate(() => JSON.parse(localStorage.pmj2_list));
    assert.deepEqual(l, [{ n: 'OSB 2500/1250/18 RH', c: 'J_00076', u: 'https://www.promontaz.cz/v/', q: 14, un: 'ks', f: 0 }, { n: '<img src=x onerror=alert(1)>', c: '', u: '', q: 0, un: '', f: 0 }]); // neplatný počet = neuveden (3.2), ne 1 ks
    assert.equal(await p3.$$eval('.pmj-list img', a => a.length), 0, 'název se vkládá jako text');
    assert.equal(await p3.textContent('.pmj-badge'), '2');
    const ev = await p3.evaluate(() => dataLayer.filter(o => o.event === 'jarda_api_add').pop());
    assert.deepEqual([ev.api_source, ev.items_added], ['kalk-osb', 2]);
    // fronta: kalkulačka zavolá dřív, než se Jarda načte
    await p3.addInitScript(() => { window.pmjQueue = [{ source: 'kalk-vruty', open: false, items: [{ n: 'Vrut 5x60', q: 3, un: 'bal' }] }]; });
    await p3.goto(B + '?page=category'); await p3.waitForFunction(() => (JSON.parse(localStorage.pmj2_list || '[]')).length === 3);
  });
  await step('doprava: ověřené podmínky (143,10 Kč, zdarma od 5 999 Kč s výjimkami, dřevo, palety), žádné termíny', async () => {
    await p3.goto(B + '?page=category'); await openJarda(p3);
    await p3.click('.pmj-chip:has-text("Doprava a platba")'); await p3.waitForTimeout(150);
    const t = await lastBot(p3);
    for (const re of [/Minimální objednávka je 450 Kč/, /143,10 Kč/, /Doprava zdarma od 5\s999 Kč/, /Neplatí pro individuální dopravu dřeva/, /Dřevo \(KVH, OSB, řezivo\)/, /paletového a nadrozměrného/, /Kabely posíláme jen na adresu/]) assert.match(t, re);
    assert.ok(!/48|do \d+ (hodin|dnů)|skladem|společn/i.test(t), t);
    await ask(p3, 'kolik stojí doprava dřeva na stavbu'); assert.match(await lastBot(p3), /Doprava a platba/);
  });
  await step('kalkulačky: čip Spočítat spotřebu vypíše kalkulačky, hledání OSB nabídne kalkulačku OSB', async () => {
    await p3.click('.pmj-bot .pmj-chip:has-text("Spočítat spotřebu")'); await p3.waitForTimeout(150);
    assert.equal(await p3.$$eval('.pmj-bot:last-child .pmj-calcs a', a => a.length), 12);
    await ask(p3, 'osb 18'); await p3.waitForSelector('.pmj-bot:last-child .pmj-card');
    assert.equal(await p3.$eval('.pmj-bot:last-child a[href="/kalkulacky/kalkulacka-osb/"]', a => a.textContent), 'Kalkulačka OSB desek');
  });
  await c3.close();

  const m = await br.newContext({ ...devices['iPhone 13'] }); await ctxSetup(m, errs);
  const mp = await m.newPage();
  await step('mobil (iPhone 13, emulace v Chromiu): panel přes celou obrazovku, bez vodorovného posunu', async () => {
    await mp.goto(B + '?page=product'); await mp.waitForSelector('.pmj-fab'); await mp.tap('.pmj-fab'); await mp.waitForSelector('.pmj-chip');
    await mp.fill('.pmj-q', 'cyky 3x2,5'); await mp.press('.pmj-q', 'Enter');
    await mp.waitForSelector('.pmj-card', { timeout: 8000 }).catch(async e => { throw new Error(e.message.split('\n')[0] + ' | ' + await lastBot(mp)); });
    await mp.tap('.pmj-card:first-child button:has-text("Do košíku")'); await mp.waitForSelector('.pmj-buy .pmj-qty');
    const [sw, iw, pw] = await mp.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('.pmj-panel').getBoundingClientRect().width]);
    assert.ok(await mp.evaluate(() => { const b = document.querySelector('.pmj-buy').getBoundingClientRect(); return b.right <= innerWidth && b.left >= 0; }), 'nákupní řádek se vejde na šířku');
    assert.equal(sw, iw); assert.equal(pw, iw);
    const fs16 = await mp.$eval('.pmj-q', e => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(fs16 >= 16, 'pole musí mít ≥16 px kvůli zoomu v iOS');
    if (process.env.SHOTS) await mp.screenshot({ path: process.env.SHOTS + '/e2e-mobile.png' });
  });
  /* ---------- 3.2: navigace bez slepých uliček, stav poptávky, duplicity ---------- */
  const c4 = await br.newContext({ viewport: { width: 1280, height: 860 } }); await ctxSetup(c4, errs);
  const p4 = await c4.newPage();
  const navTxt = () => p4.evaluate(() => { const n = document.querySelector('.pmj-nav'); return n.hidden ? null : [...n.querySelectorAll('button')].filter(b => !b.hidden).map(b => b.textContent); });
  const cnt = async name => (await p4.evaluate(() => dataLayer.filter(o => o && o.event).map(o => o.event))).filter(e => e === name).length;
  await step('3.2 přímé hledání bez nabídky; karta s jednotkou z indexu („319 Kč / bal (100 ks)“)', async () => {
    await p4.goto(B + '?page=category'); await openJarda(p4);
    assert.equal(await navTxt(), null, 'v nabídce žádná navigace');
    await p4.fill('.pmj-q', 'turbo šroub 7,5x92'); await p4.press('.pmj-q', 'Enter');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-card');
    assert.match(await p4.$eval('.pmj-bot:last-child .pmj-card', e => e.innerText), /319 Kč \/ bal \(100 ks\)\s*s DPH/);
    assert.deepEqual(await navTxt(), ['← Změnit volbu']);
  });
  await step('3.2 hledání → výsledky → produkt → Zpět na výsledky → Zpět → nabídka (nic se znovu neměří ani nevkládá)', async () => {
    await p4.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-buy .pmj-qty');
    assert.deepEqual(await navTxt(), ['← Výsledky „turbo šroub 7,5x92“', 'Hlavní nabídka']);
    const [s0, v0] = [await cnt('jarda_search'), await cnt('jarda_cart_verify')];
    await p4.click('.pmj-navb >> nth=0');
    await p4.waitForSelector('.pmj-bot:last-child:has-text("našel") .pmj-cards');
    assert.match(await p4.evaluate(() => [...document.querySelectorAll('.pmj-you')].pop().textContent), /Zpět: Výsledky/);
    assert.deepEqual(await navTxt(), ['← Změnit volbu']);
    assert.equal(await p4.$$eval('.pmj-bot', a => a.filter(m => /našel/.test(m.innerText)).length), 1, 'výsledky jsou v konverzaci jednou (přesunuté dolů), ne zdvojené');
    await p4.click('.pmj-navb >> nth=0');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-chip');
    assert.equal(await navTxt(), null);
    assert.deepEqual([await cnt('jarda_search'), await cnt('jarda_cart_verify')], [s0, v0], 'Zpět nic neměří znovu');
    assert.ok(await p4.evaluate(() => dataLayer.filter(o => o.event === 'jarda_nav').every(o => Object.keys(o).every(k => ['event', 'nav', 'from', 'to', 'jarda_version'].includes(k)))), 'jarda_nav bez osobních údajů');
    assert.equal(await p4.evaluate(() => window.__demoCart), undefined);
  });
  await step('3.2 doprava → Změnit volbu → nabídka; nejasný dotaz → volba → Změnit volbu vrátí volby', async () => {
    await p4.click('.pmj-chip:has-text("Doprava a platba")'); await p4.waitForSelector('.pmj-bot:last-child:has-text("143,10")');
    assert.deepEqual(await navTxt(), ['← Změnit volbu']);
    await p4.click('.pmj-navb >> nth=0'); await p4.waitForSelector('.pmj-bot:last-child .pmj-chip:has-text("Najít materiál")');
    await p4.fill('.pmj-q', 'faktura objednávka'); await p4.press('.pmj-q', 'Enter');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-chip:has-text("Faktura k objednávce")');
    await p4.click('.pmj-bot:last-child .pmj-chip:has-text("Faktura k objednávce")');
    await p4.waitForSelector('.pmj-bot:last-child:has-text("číslo objednávky")');
    assert.deepEqual(await navTxt(), ['← Změnit volbu', 'Hlavní nabídka']);
    await p4.click('.pmj-navb >> nth=0');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-chip:has-text("Moje objednávka")');
    assert.match(await lastBot(p4), /Upřesněte/);
  });
  await step('3.2 množství: „250 ks …“ → k nacenění → úprava počtu bez nového hledání; Zpět na výsledky ukáže „✓ V seznamu“', async () => {
    await p4.fill('.pmj-q', '250 ks turbo šroub 7,5x92'); await p4.press('.pmj-q', 'Enter');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-card');
    const s0 = await cnt('jarda_search');
    await p4.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("+ k nacenění")');
    await p4.waitForSelector('.pmj-added .pmj-qty');
    assert.equal(await p4.inputValue('.pmj-added .pmj-qty'), '250');
    await p4.fill('.pmj-added .pmj-qty', '300'); await p4.press('.pmj-added .pmj-qty', 'Tab');
    let l = await p4.evaluate(() => JSON.parse(localStorage.pmj2_list));
    assert.deepEqual(l.map(x => [x.q, x.un, x.c]), [[300, 'ks', '8061BD']], 'požadované množství a jednotka zůstávají (300 ks), převod na balení až v košíku');
    assert.equal(await cnt('jarda_search'), s0);
    // znovu kliknout nejde: položka je v seznamu (žádná duplicita)
    assert.equal(await p4.$eval('.pmj-bot:has-text("Pro 250 ks") .pmj-card:first-child button.pmj-btn-primary', b => [b.disabled, b.textContent].join()), 'true,✓ V seznamu');
    // hledání bez množství a „+ k nacenění“ → počet zůstane neuvedený
    await p4.fill('.pmj-q', 'turbo šroub 7,5x72'); await p4.press('.pmj-q', 'Enter');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-card');
    await p4.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("+ k nacenění")');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-added');
    assert.equal(await p4.inputValue('.pmj-bot:last-child .pmj-added .pmj-qty'), '');
    assert.match(await lastBot(p4), /Doplňte prosím počet/);
    l = await p4.evaluate(() => JSON.parse(localStorage.pmj2_list));
    assert.equal(l[1].q, 0, 'bez množství žádný falešný 1 ks');
  });
  await step('3.2 upravit poslední dotaz (tlačítko i šipka nahoru) bez nového hledání', async () => {
    await p4.click('.pmj-bot:has(.pmj-cards) >> nth=-1 >> button:has-text("Upravit hledání")').catch(async () => p4.click('button:has-text("Upravit hledání") >> nth=-1'));
    assert.equal(await p4.inputValue('.pmj-q'), 'turbo šroub 7,5x72');
    assert.ok(await p4.evaluate(() => document.activeElement.classList.contains('pmj-q')));
    await p4.fill('.pmj-q', ''); await p4.press('.pmj-q', 'ArrowUp');
    assert.equal(await p4.inputValue('.pmj-q'), 'turbo šroub 7,5x72');
    await p4.fill('.pmj-q', '');
  });
  await step('3.2 seznam: neuvedený počet označen, změna počtu, odebrání a vrácení položky', async () => {
    await p4.click('.pmj-listbtn'); await p4.waitForSelector('.pmj-list .pmj-row');
    assert.equal(await p4.$$eval('.pmj-list .pmj-row-noq', a => a.length), 1);
    assert.match(await p4.$eval('.pmj-list', e => e.innerText), /2 položky · u 1 chybí počet/);
    assert.deepEqual(await p4.$$eval('.pmj-list .pmj-tag', a => a.map(x => x.textContent)), ['produkt 8061BD', 'produkt 8060BD']);
    await p4.fill('.pmj-list .pmj-row:nth-child(2) .pmj-qty', '4'); await p4.press('.pmj-list .pmj-row:nth-child(2) .pmj-qty', 'Tab');
    assert.equal(await p4.$$eval('.pmj-list .pmj-row-noq', a => a.length), 0);
    await p4.click('.pmj-list .pmj-row:nth-child(2) .pmj-del');
    assert.equal((await p4.evaluate(() => JSON.parse(localStorage.pmj2_list))).length, 1);
    await p4.click('.pmj-list button:has-text("Vrátit")');
    assert.deepEqual((await p4.evaluate(() => JSON.parse(localStorage.pmj2_list))).map(x => x.q), [300, 4]);
  });
  await step('3.2 seznam → poptávka → Zpět → úprava seznamu → poptávka: text, kontakt i přílohy zůstávají, formulář jen jednou', async () => {
    await p4.click('.pmj-list button:has-text("Nacenit seznam")'); await p4.waitForSelector('.pmj-form');
    assert.equal(await cnt('jarda_quote_start'), 1);
    await p4.fill('.pmj-form textarea', 'ještě 2 role pásky');
    await p4.fill('.pmj-form input[type=email]', 'test@example.com');
    await p4.setInputFiles('.pmj-form input[type=file]', [{ name: 'vykres.png', mimeType: 'image/png', buffer: PNG }]);
    await p4.waitForSelector('.pmj-files li');
    assert.deepEqual(await navTxt(), ['← Seznam', 'Hlavní nabídka']);
    await p4.click('.pmj-navb >> nth=0'); await p4.waitForSelector('.pmj-bot:last-child .pmj-list');
    await p4.fill('.pmj-list .pmj-row:nth-child(1) .pmj-qty', '500'); await p4.press('.pmj-list .pmj-row:nth-child(1) .pmj-qty', 'Tab');
    await p4.click('.pmj-list button:has-text("Nacenit seznam")'); await p4.waitForSelector('.pmj-form');
    assert.match(await p4.textContent('.pmj-qsum'), /500 ks Den Braven Turbo šroub/);
    assert.equal(await p4.inputValue('.pmj-form textarea'), 'ještě 2 role pásky');
    assert.equal(await p4.inputValue('.pmj-form input[type=email]'), 'test@example.com');
    assert.deepEqual(await p4.$$eval('.pmj-files li', a => a.map(x => x.textContent.replace('×', '').trim())), ['vykres.png (1 kB)']);
    // opakované otevření poptávky (čip i tlačítko) – pořád jeden formulář, jedno tlačítko odeslání, přílohy drží
    await p4.click('.pmj-navb:has-text("Hlavní nabídka")'); await p4.waitForSelector('.pmj-bot:last-child .pmj-resume');
    assert.match(await p4.$eval('.pmj-bot:last-child .pmj-resume', e => e.innerText), /Pokračovat: Poptávka/);
    await p4.click('.pmj-bot:last-child .pmj-chip:has-text("Nacenit seznam nebo fotku")'); await p4.waitForSelector('.pmj-bot:last-child .pmj-form');
    await p4.click('.pmj-listbtn'); await p4.click('.pmj-bot:last-child .pmj-list button:has-text("Nacenit seznam")');
    assert.equal(await p4.$$eval('.pmj-form', a => a.length), 1);
    assert.equal(await p4.$$eval('.pmj-send', a => a.length), 1);
    assert.equal(await p4.$$eval('#pmj-err', a => a.length), 1);
    assert.equal(await p4.$$eval('.pmj-files li', a => a.length), 1);
    assert.equal(await cnt('jarda_quote_start'), 1, 'začátek poptávky se měří jednou');
    const d = await p4.evaluate(() => JSON.parse(sessionStorage.pmj2_draft));
    assert.deepEqual([d.t, d.email, d.fn], ['ještě 2 role pásky', 'test@example.com', ['vykres.png']]);
    assert.ok(!(await p4.evaluate(() => JSON.stringify(localStorage))).includes('test@example.com'));
  });
  await step('3.2 zavření a znovuotevření: konverzace i rozepsaná poptávka zůstávají; nová stránka nabídne pokračování', async () => {
    await p4.click('.pmj-x'); await p4.click('.pmj-fab'); await p4.waitForSelector('.pmj-panel:not([hidden])');
    assert.equal(await p4.$$eval('.pmj-form', a => a.length), 1);
    assert.equal(await p4.inputValue('.pmj-form textarea'), 'ještě 2 role pásky');
    await p4.goto(B + '?page=category'); await openJarda(p4);
    const r = await p4.$eval('.pmj-resume', e => e.innerText);
    assert.match(r, /Dokončit rozepsanou poptávku/); assert.match(r, /Poslední hledání: „turbo šroub 7,5x72“/);
    await p4.click('.pmj-resume button:has-text("Dokončit rozepsanou poptávku")'); await p4.waitForSelector('.pmj-form');
    assert.equal(await p4.inputValue('.pmj-form textarea'), 'ještě 2 role pásky');
    assert.match(await p4.textContent('.pmj-files'), /vykres\.png.*vyberte znovu/, 'po načtení nové stránky přílohy prohlížeč neuchová – Jarda to řekne');
    await p4.click('.pmj-navb:has-text("Změnit volbu")');
    await p4.click('.pmj-resume button:has-text("Poslední hledání")'); await p4.waitForSelector('.pmj-bot:last-child .pmj-card');
  });
  await step('3.2 žádné dvojí odeslání: dvojklik, Zpět a nové vykreslení během odesílání → jeden POST', async () => {
    await formsubmit(p4, 'ok'); window_log.length = 0;
    await p4.unroute(/^https:\/\/formsubmit\.co\//);
    await p4.route(/^https:\/\/formsubmit\.co\//, async r => {
      const q = r.request(), cors = { 'access-control-allow-origin': '*' };
      if (q.method() === 'HEAD') return r.fulfill({ status: 200, body: '' });
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { ...cors, 'access-control-allow-headers': 'Content-Type, Accept' }, body: '' });
      window_log.push({ url: q.url() });
      await new Promise(res => setTimeout(res, 1500));
      r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"success":"true"}' });
    });
    await p4.goto(B + '?page=category&live=1'); await openJarda(p4);
    await p4.click('.pmj-resume button:has-text("Dokončit rozepsanou poptávku")'); await p4.waitForSelector('.pmj-form');
    await p4.dblclick('.pmj-send'); await p4.waitForTimeout(150);
    assert.equal(await p4.$eval('.pmj-send', b => b.disabled), true);
    await p4.click('.pmj-navb >> nth=0'); await p4.click('.pmj-chip:has-text("Nacenit seznam nebo fotku")'); await p4.waitForSelector('.pmj-form');
    assert.deepEqual(await p4.$eval('.pmj-send', b => [b.disabled, b.textContent]), [true, 'Odesílám…'], 'nově vykreslený formulář je také zamčený');
    await p4.click('.pmj-send', { force: true }).catch(() => {});
    await p4.waitForSelector('.pmj-bot:has-text("jsme přijali")', { timeout: 10000 });
    assert.equal(window_log.length, 1, 'právě jeden POST');
    assert.equal(await cnt('jarda_quote_accepted'), 1);
    assert.equal(await navTxt(), null, 'po přijetí nevede Zpět zpátky do odeslané poptávky');
    assert.equal(await p4.evaluate(() => sessionStorage.pmj2_draft || null), null);
  });
  await step('3.2 žádné dvojí vložení do košíku: dvojklik = jedno volání Shoptetu; po vložení „Pokračovat v nákupu“ a „Zobrazit košík“', async () => {
    await p4.evaluate(() => { window.__demoCart = []; });
    await p4.fill('.pmj-q', 'turbo šroub 7,5x92'); await p4.press('.pmj-q', 'Enter');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-card');
    await p4.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-buy .pmj-qty');
    await p4.dblclick('.pmj-bot:last-child .pmj-buy button:has-text("Vložit do košíku")');
    await p4.waitForSelector('.pmj-bot:last-child:has-text("Vloženo do košíku")');
    assert.deepEqual(await p4.evaluate(() => window.__demoCart), [{ productCode: '8061BD', amount: 1 }]);
    assert.ok(await p4.$('.pmj-bot:last-child a:has-text("Zobrazit košík")'));
    await p4.click('.pmj-bot:last-child button:has-text("Pokračovat v nákupu")');
    await p4.waitForSelector('.pmj-bot:last-child:has-text("našel") .pmj-cards');
    await p4.click('.pmj-bot:last-child .pmj-card:first-child button:has-text("Do košíku")');
    await p4.waitForSelector('.pmj-bot:last-child .pmj-buy .pmj-qty');
    assert.match(await p4.$eval('.pmj-bot:last-child .pmj-buy', e => e.innerText), /Z Jardy už máte v košíku 1 bal\./);
    assert.equal((await p4.evaluate(() => window.__demoCart)).length, 1);
  });
  await step('3.2 nedostupný index: chyba je obrazovka se Zpět, nacenění funguje', async () => {
    await p4.goto(B + '?page=category&index=broken'); await openJarda(p4);
    await p4.fill('.pmj-q', 'vrut 5x60'); await p4.press('.pmj-q', 'Enter');
    await p4.waitForSelector('.pmj-bot:last-child button:has-text("k nacenění")');
    assert.deepEqual(await navTxt(), ['← Změnit volbu']);
    await p4.click('.pmj-bot:last-child button:has-text("k nacenění")');
    const l = await p4.evaluate(() => JSON.parse(localStorage.pmj2_list));
    assert.deepEqual([l[l.length - 1].n, l[l.length - 1].q], ['vrut 5x60', 0]);
  });
  await step('3.2 vložený seznam → Kontrola → Zpět → úprava textu zůstane; přidání jen jednou', async () => {
    await p4.goto(B + '?page=category'); await openJarda(p4);
    await p4.evaluate(() => localStorage.removeItem('pmj2_list'));
    await p4.click('.pmj-chip:has-text("Vložit seznam materiálu")');
    await p4.fill('.pmj-bot:last-child textarea', 'kramle tesařská 10x200 5 ks\nhmoždinka');
    await p4.click('button:has-text("Najít v katalogu")'); await p4.waitForSelector('.pmj-imp');
    await p4.click('.pmj-navb >> nth=0'); await p4.waitForSelector('.pmj-bot:last-child textarea');
    assert.equal(await p4.inputValue('.pmj-bot:last-child textarea'), 'kramle tesařská 10x200 5 ks\nhmoždinka');
    await p4.click('button:has-text("Najít v katalogu")'); await p4.waitForSelector('.pmj-bot:last-child .pmj-imp');
    await p4.click('.pmj-bot:last-child button:has-text("Přidat vše k nacenění")'); await p4.waitForSelector('.pmj-form');
    await p4.click('.pmj-navb >> nth=0'); await p4.waitForSelector('.pmj-bot:last-child .pmj-imp');
    assert.equal(await p4.$eval('.pmj-bot:last-child .pmj-btn-primary', b => [b.disabled, b.textContent].join()), 'true,✓ Přidáno');
    assert.equal((await p4.evaluate(() => JSON.parse(localStorage.pmj2_list))).length, 2);
  });
  await step('3.2 přístupnost (axe) s navigací, seznamem a kontrolou poptávky', async () => {
    await p4.click('.pmj-listbtn'); await p4.waitForSelector('.pmj-bot:last-child .pmj-list');
    await p4.addScriptTag({ path: require.resolve('axe-core') });
    const r = await p4.evaluate(() => axe.run('.pmj-panel', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }));
    assert.deepEqual(r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ') + ' ' + (n.any[0] || {}).message).join(' | ')), []);
  });
  await c4.close();
  await step('3.2 mobil (emulace iPhone 13 v Chromiu): navigace nad polem, tlačítka ≥ 44 px, bez vodorovného posunu', async () => {
    const mc = await br.newContext({ ...devices['iPhone 13'] }); await ctxSetup(mc, errs);
    const mp = await mc.newPage();
    await mp.goto(B + '?page=category'); await mp.waitForSelector('.pmj-fab'); await mp.tap('.pmj-fab'); await mp.waitForSelector('.pmj-chip');
    await mp.tap('.pmj-chip:has-text("Doprava a platba")'); await mp.waitForSelector('.pmj-nav:not([hidden])');
    const m = await mp.evaluate(() => {
      const n = document.querySelector('.pmj-nav').getBoundingClientRect(), b = document.querySelector('.pmj-bar').getBoundingClientRect(), r = document.querySelector('.pmj-root').getBoundingClientRect();
      const small = [...document.querySelectorAll('.pmj-panel button, .pmj-panel a.pmj-btn')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 44 && !x.classList.contains('pmj-linkbtn')).map(x => x.textContent);
      return { navAbove: n.bottom <= b.top + 1, inView: r.bottom <= innerHeight + 1 && r.top >= 0, sw: document.documentElement.scrollWidth, iw: innerWidth, small };
    });
    assert.ok(m.navAbove && m.inView, JSON.stringify(m)); assert.equal(m.sw, m.iw); assert.deepEqual(m.small, []);
    await mp.tap('.pmj-navb'); await mp.waitForSelector('.pmj-nav[hidden]', { state: 'attached' });
    if (process.env.SHOTS) await mp.screenshot({ path: process.env.SHOTS + '/e2e-mobile-nav.png' });
    await mc.close();
  });
  await step('bez chyb JavaScriptu', async () => { assert.deepEqual(errs, []); });

  if (process.env.SHOTS) await pg.screenshot({ path: process.env.SHOTS + '/e2e-desktop.png' });
  await br.close(); server.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} prošlo`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
