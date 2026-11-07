/* Živý test GA4 a souhlasů s v3 ze skutečných GitHub Pages (v testovacím prohlížeči místo v2).
   Zachytí požadavky, které gtag chce odeslat (z testovacího prostředí jsou síťově blokované – do GA4 ani Ads nic
   neodchází), a ověří: před souhlasem gcs=G100, po souhlasu G111, jen GA4 G-3KY8CWHMHY, nic do Ads,
   žádné form_start/form_submit z Jardy, žádné osobní údaje. gtag události dávkuje (~25 s), proto se čeká.
   Spuštění: node test/live/consent.cjs */
const { chromium } = require('playwright');
const assert = require('assert/strict');
const V = require('../../package.json').version;
const ADS = /googleadservices|doubleclick|google\.com\/(pagead|rmkt|ccm)/;
async function session(br, accept) {
  const c = await br.newContext({ viewport: { width: 1366, height: 860 } }); const hits = [];
  c.on('request', q => { const u = q.url(); if (/\/g\/collect/.test(u) || ADS.test(u)) hits.push({ u, b: q.postData() || '' }); });
  // produkční cesta: kanál ze Zápatí + volba verze testeru (po přepnutí stable je to výchozí verze)
  await c.addInitScript(v => { try { if (location.hostname === 'www.promontaz.cz') localStorage.setItem('pmj_ver', v); } catch (e) {} }, V);
  const p = await c.newPage();
  await p.goto('https://www.promontaz.cz/spojovaci-material/', { waitUntil: 'load' });
  if (accept) { // kliknout na „Souhlasím“ a počkat, až Shoptet pošle gtag('consent','update', analytics granted)
    const granted = () => p.evaluate(() => dataLayer.some(c => c && c[0] === 'consent' && c[1] === 'update' && c[2] && c[2].analytics_storage === 'granted'));
    for (let i = 0; i < 5 && !(await granted()); i++) {
      await p.waitForSelector('button[data-testid="buttonCookiesAccept"]', { state: 'attached', timeout: 15000 }).catch(() => {});
      await p.$eval('button[data-testid="buttonCookiesAccept"]', b => b.click()).catch(() => {}); await p.waitForTimeout(1500);
    }
    assert.ok(await granted(), 'souhlas se nepropsal do gtag');
  }
  await p.waitForSelector('.pmj-fab', { timeout: 45000 });
  const n0 = hits.length;
  await p.click('.pmj-fab'); await p.waitForSelector('.pmj-chip');
  await p.fill('.pmj-q', 'vrut 5x60'); await p.press('.pmj-q', 'Enter'); await p.waitForSelector('.pmj-card', { timeout: 60000 });
  await p.click('.pmj-chip:has-text("Nacenit seznam nebo fotku")'); await p.waitForSelector('.pmj-form');
  await p.fill('.pmj-form textarea', '20× vrut'); await p.fill('.pmj-form input[type=email]', 'jan.novak@example.com'); await p.fill('.pmj-form input[type=tel]', '722 111 222');
  await p.waitForTimeout(28000); await p.goto('about:blank'); await p.waitForTimeout(1500);
  await c.close();
  return hits.slice(n0);
}
(async () => {
  const br = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  let failed = 0;
  for (const accept of [false, true]) {
    const hits = await session(br, accept), label = accept ? 'po souhlasu' : 'před souhlasem';
    const jarda = hits.filter(h => /en=jarda_/.test(h.u + '\n' + h.b));
    const names = [...new Set(jarda.flatMap(h => (h.u + '\n' + h.b).match(/en=jarda_[a-z_]+/g)))].map(e => e.slice(3));
    try {
      assert.ok(names.includes('jarda_open') && names.includes('jarda_search') && names.includes('jarda_quote_start'), names.join(','));
      for (const h of jarda) {
        assert.match(h.u, /[?&]tid=G-3KY8CWHMHY(&|$)/);
        assert.match(h.u, accept ? /[?&]gcs=G111/ : /[?&]gcs=G100/);
        assert.ok(!/jan\.novak|%40example|722%20111|722 111/.test(decodeURIComponent(h.u + h.b)), 'osobní údaj');
      }
      assert.equal(hits.filter(h => ADS.test(h.u) && /jarda/i.test(decodeURIComponent(h.u + h.b))).length, 0, 'Jarda v Ads');
      assert.equal(hits.filter(h => /en=form_(start|submit)/.test(h.u + '\n' + h.b)).length, 0, 'form_start/form_submit');
      console.log(`✓ ${label}: ${names.join(', ')} → jen GA4 G-3KY8CWHMHY, gcs=${accept ? 'G111' : 'G100'}, nic do Ads, žádné form_*, žádné osobní údaje`);
    } catch (e) { failed++; console.log(`✗ ${label}: ${e.message.split('\n')[0]}`); }
  }
  await br.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
