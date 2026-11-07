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
const VER = require('../../package.json').version;
const STABLE = String((require('../../package.json').jarda || {}).stable || '2'), DEF = STABLE === '2' ? 'v2' : STABLE; // výchozí verze kanálu
async function step(name, fn) {
  try { await fn(); results.push('✓ ' + name); }
  catch (e) { failed++; results.push('✗ ' + name + '\n    ' + String(e.message).split('\n').slice(0, 4).join('\n    ')); }
}

async function ctxSetup(ctx, errs) {
  // Playwright: později přidané pravidlo má přednost → nejdřív obecné blokování sítě, pak podstrčené soubory
  await ctx.route(/^https:\/\/(?!127\.0\.0\.1)/, r => r.abort()); // nic dalšího ze sítě
  await ctx.route(/promontaz-search\/index\.json/, r => r.fulfill({ path: path.join(ROOT, 'test/fixture-index.json'), headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' } }));
  await ctx.route(/neexistuje\.json/, r => r.fulfill({ status: 404, body: 'nf' }));
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
  await step('produkt: větší množství přidá produkt s množstvím z pole Množství', async () => {
    await pg.click('.pmj-chip-hot');
    const l = await pg.evaluate(() => JSON.parse(localStorage.pmj2_list));
    assert.equal(l[0].c, 'HR_10075'); assert.equal(l[0].q, 12);
    assert.equal(await pg.textContent('.pmj-badge'), '1');
  });
  await step('hledání: karta s cenou s DPH, kódem, „k nacenění“ a „Do košíku“', async () => {
    await ask(pg, 'turbo šroub 7,5 x 92'); await pg.waitForSelector('.pmj-card');
    const t = await pg.$eval('.pmj-cards .pmj-card', e => e.innerText);
    assert.match(t, /Turbo šroub/); assert.match(t, /Kč\s+s DPH/); assert.match(t, /Kód: 8061BD/);
    assert.ok(await pg.$('.pmj-cards .pmj-card:first-child button:has-text("Do košíku")'));
  });
  await step('košík: vložení přes Shoptet API a potvrzení až po ShoptetCartUpdated', async () => {
    await pg.click('.pmj-cards .pmj-card:first-child button:has-text("Do košíku")');
    await pg.waitForSelector('button:has-text("✓ V košíku")', { timeout: 3000 });
    assert.deepEqual(await pg.evaluate(() => window.__demoCart), [{ productCode: '8061BD', amount: 1 }]);
    assert.match(await lastBot(pg), /Přidáno do košíku/);
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
    assert.match(await pg.inputValue('.pmj-form textarea'), /30× Kramle tesařská 10x200 \(kód HR_10075\)/);
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
      const next = /name="_next"\r\n\r\n([^\r]+)/.exec(q.postData() || '');
      return r.fulfill({ status: 302, headers: { location: next ? next[1] : '/' }, body: '' });
    });
  }
  async function quoteForm(page, url) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(url); await openJarda(page);
    await page.click('.pmj-chip-hot'); await page.click('.pmj-chip:has-text("Nacenit seznam nebo fotku")'); await page.waitForSelector('.pmj-form');
    await page.fill('.pmj-form input[type=tel]', '000 000 000');
    await page.setInputFiles('.pmj-form input[type=file]', [{ name: 'foto.png', mimeType: 'image/png', buffer: PNG }]); await page.waitForTimeout(300);
  }
  await step('výpadek FormSubmitu (522): neodejde se ze stránky, „NEBYLA odeslána“, připravený e-mail se seznamem, nic jako odeslané', async () => {
    await formsubmit(pg, 'hang');
    await quoteForm(pg, B + '?page=product&live=1');
    const t0 = Date.now(); await pg.click('.pmj-send');
    await pg.waitForSelector('.pmj-bot:has-text("NEBYLA odeslána")', { timeout: 12000 });
    assert.ok(Date.now() - t0 < 9000, 'kontrola služby má skončit do ~6 s');
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
  await step('FormSubmit funguje (AJAX): přijato až po odpovědi success, české potvrzení na stránce, přílohy odeslány, seznam smazán', async () => {
    await formsubmit(pg, 'ok'); window_log.length = 0;
    await quoteForm(pg, B + '?page=product&live=1');
    await pg.click('.pmj-send');
    await pg.waitForSelector('.pmj-bot:has-text("jsme přijali")', { timeout: 10000 });
    assert.match(pg.url(), /demo\.html\?page=product/); // zákazník zůstal na webu
    assert.equal(window_log.length, 1, 'právě jeden POST');
    assert.match(window_log[0].url, /formsubmit\.co\/ajax\/info@promontaz\.cz/);
    assert.match(window_log[0].body, /filename="foto\.png"/); assert.match(window_log[0].body, /name="Seznam materiálu"/);
    const ev = await events(pg); assert.ok(ev.includes('jarda_quote_accepted') && ev.includes('jarda_quote_submit'));
    assert.equal(await pg.evaluate(() => localStorage.pmj2_list || null), null);
    assert.equal(await pg.$('.pmj-form'), null, 'formulář po přijetí zmizí');
  });
  await step('služba poptávku odmítne ({"success":"false"}): nic se nepotvrdí, záložní e-mail, údaje zůstávají', async () => {
    await formsubmit(pg, 'reject'); window_log.length = 0;
    await quoteForm(pg, B + '?page=product&live=1');
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
    await quoteForm(pg, B + '?page=product&live=1');
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
  await step('/nacenit-material/ s AJAX režimem: po success návrat na vlastní poděkování formuláře (?odeslano=ID), jeden POST s přílohou', async () => {
    const np = await ctx.newPage(); await formsubmit(np, 'ok'); window_log.length = 0;
    await np.addInitScript(() => { window.__ajaxMode = 1; });
    await np.goto(B.replace('demo.html', 'nacenit-material/') + '?ajax=1'); await np.waitForFunction(() => window.__pmjGuardOn, null, { timeout: 15000 });
    await np.setInputFiles('#pmq-files', [{ name: 'seznam.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }]);
    await np.click('#pmq-send'); await np.waitForURL(/odeslano=PM-261107-ABCDEF/, { timeout: 15000 });
    assert.equal(window_log.length, 1); assert.match(window_log[0].url, /\/ajax\/info@promontaz\.cz/); assert.match(window_log[0].body, /filename="seznam\.pdf"/);
    await np.close();
  });
  await step('/nacenit-material/ s AJAX režimem: služba odmítne → nic se nepotvrdí, box „nepřijala“, údaje zůstávají', async () => {
    const np = await ctx.newPage(); await formsubmit(np, 'reject');
    await np.goto(B.replace('demo.html', 'nacenit-material/') + '?ajax=1'); await np.waitForFunction(() => window.__pmjGuardOn, null, { timeout: 15000 });
    await np.click('#pmq-send'); await np.waitForSelector('#pmj-guard-box', { timeout: 15000 });
    assert.match(await np.innerText('#pmj-guard-box'), /nepřijala/); assert.ok(!/odeslano/.test(np.url())); assert.equal(await np.inputValue('#pmq-message'), '20× vrut 5x60');
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
    assert.match(await pg.inputValue('.pmj-form textarea'), /2× Kramle tesařská 10x200 \(kód HR_10075\)/);
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

  const m = await br.newContext({ ...devices['iPhone 13'] }); await ctxSetup(m, errs);
  const mp = await m.newPage();
  await step('mobil (iPhone 13, emulace v Chromiu): panel přes celou obrazovku, bez vodorovného posunu', async () => {
    await mp.goto(B + '?page=product'); await mp.waitForSelector('.pmj-fab'); await mp.tap('.pmj-fab'); await mp.waitForSelector('.pmj-chip');
    await mp.fill('.pmj-q', 'cyky 3x2,5'); await mp.press('.pmj-q', 'Enter');
    await mp.waitForSelector('.pmj-card', { timeout: 8000 }).catch(async e => { throw new Error(e.message.split('\n')[0] + ' | ' + await lastBot(mp)); });
    const [sw, iw, pw] = await mp.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('.pmj-panel').getBoundingClientRect().width]);
    assert.equal(sw, iw); assert.equal(pw, iw);
    const fs16 = await mp.$eval('.pmj-q', e => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(fs16 >= 16, 'pole musí mít ≥16 px kvůli zoomu v iOS');
    if (process.env.SHOTS) await mp.screenshot({ path: process.env.SHOTS + '/e2e-mobile.png' });
  });
  await step('bez chyb JavaScriptu', async () => { assert.deepEqual(errs, []); });

  if (process.env.SHOTS) await pg.screenshot({ path: process.env.SHOTS + '/e2e-desktop.png' });
  await br.close(); server.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} prošlo`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
