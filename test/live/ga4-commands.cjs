/* GA4 na živém webu na úrovni příkazů gtag (funguje i tam, kde je googletagmanager.com síťově blokovaný):
   každé volání gtag('event', …) od Jardy se zachytí. Projde se celá cesta (otevření → hledání → klik → ověření →
   košík → vložený seznam → export → poptávka dry-run → přijetí) a ověří: každá akce = právě 1 událost (bez duplicit),
   vždy send_to GA4, nikdy osobní údaje. Spuštění: PAGES=1 node test/live/ga4-commands.cjs (PAGES=stable po přepnutí) */
const { chromium } = require('playwright');
const assert = require('assert/strict');
const V = require('../../package.json').version;
const results = []; let failed = 0;
async function step(n, f) { try { await f(); results.push('✓ ' + n); } catch (e) { failed++; results.push('✗ ' + n + '\n    ' + String(e.message).split('\n').slice(0, 3).join('\n    ')); } }
(async () => {
  const br = await chromium.launch(), c = await br.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 860 } });
  await c.addInitScript(v => {
    window.PMJ_CONFIG_OVERRIDE = { dry_run: true };
    try { if (v) localStorage.setItem('pmj_ver', v); else localStorage.removeItem('pmj_ver'); } catch (e) {}
  }, process.env.PAGES === 'stable' ? '' : V);
  const p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  // gtag() na webu = dataLayer.push(arguments). Hlídáme push (přežije i přesměrování po odeslání poptávky);
  // příkazy gtag se odliší od objektů {event} (kopie Jardy pro GTM).
  const got = [];
  await c.exposeFunction('__gaReport', (n, o) => got.push([n, JSON.parse(o)]));
  await c.addInitScript(() => {
    function wrap(dl) {
      if (!dl || dl.__w) return dl; var push = dl.push; dl.__w = 1;
      dl.push = function () { for (var i = 0; i < arguments.length; i++) { var x = arguments[i]; if (x && !Array.isArray(x) && typeof x === 'object' && x.length >= 2 && x[0] === 'event' && /^jarda_/.test(x[1])) window.__gaReport(x[1], JSON.stringify(x[2] || {})); } return push.apply(this, arguments); };
      return dl;
    }
    var cur = wrap([]); // web může dataLayer přiřadit znovu → obalit i nové pole
    Object.defineProperty(window, 'dataLayer', { configurable: true, get: function () { return cur; }, set: function (v) { cur = wrap(v); } });
  });
  const ga = async () => { await p.waitForTimeout(300); return got.splice(0); };
  const cnt = (l, n) => l.filter(x => x[0] === n).length;
  const last = () => p.evaluate(() => [...document.querySelectorAll('.pmj-bot')].pop().innerText);
  await p.goto('https://www.promontaz.cz/kalkulacky/', { waitUntil: 'load' });
  await p.waitForSelector('.pmj-fab', { timeout: 45000 });
  const all = [];
  const take = async () => { const l = await ga(); all.push(...l); return l; };
  await step('otevření → 1× jarda_open', async () => { await take(); await p.click('.pmj-fab'); await p.waitForSelector('.pmj-chip'); const l = await take(); assert.equal(cnt(l, 'jarda_open'), 1, JSON.stringify(l)); });
  await step('hledání s množstvím → 1× jarda_search (has_qty, results_count)', async () => {
    await p.fill('.pmj-q', '250 ks vrut konstrukční 3,5x35 zz'); await p.press('.pmj-q', 'Enter'); await p.waitForSelector('.pmj-card', { timeout: 60000 });
    const l = await take(), s = l.filter(x => x[0] === 'jarda_search');
    assert.equal(s.length, 1); assert.equal(s[0][1].has_qty, true); assert.ok(s[0][1].results_count > 0);
  });
  await step('klik na produkt → 1× jarda_product_click', async () => {
    await p.$eval('.pmj-card .pmj-card-name', a => { a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); });
    const l = await take(); assert.equal(cnt(l, 'jarda_product_click'), 1);
  });
  await step('Do košíku → 1× jarda_cart_verify (ok, pack) → 1× jarda_add_to_cart (ok, quantity 1)', async () => {
    await p.click('.pmj-card:has(.pmj-code:has-text("VR_10005")) button:has-text("Do košíku")'); await p.waitForSelector('.pmj-buy .pmj-qty', { timeout: 20000 });
    let l = await take(); const v = l.filter(x => x[0] === 'jarda_cart_verify');
    assert.equal(v.length, 1); assert.deepEqual([v[0][1].result, v[0][1].qty_conversion], ['ok', 'pack']);
    await p.click('.pmj-buy button:has-text("Vložit do košíku")');
    await p.waitForFunction(() => /Vloženo do košíku/.test([...document.querySelectorAll('.pmj-bot')].pop().innerText), null, { timeout: 15000 });
    await p.waitForTimeout(6500); // po časovém limitu potvrzení nesmí přijít druhá (fail) událost
    l = await take(); const a = l.filter(x => x[0] === 'jarda_add_to_cart');
    assert.equal(a.length, 1, JSON.stringify(a)); assert.deepEqual([a[0][1].result, a[0][1].quantity, a[0][1].item_id], ['ok', 1, 'VR_10005']);
  });
  await step('vložený seznam → 1× jarda_list_import, přidání → 1× jarda_add_to_list, 1× jarda_quote_start', async () => {
    await p.click('.pmj-chip:has-text("Vložit seznam materiálu")');
    await p.fill('.pmj-bot:last-child textarea', '20 ks hmoždinka 8x40\nkabel cyky-j 3x1,5 30 m\nOSB 2500/1250/18 12×');
    await p.click('button:has-text("Najít v katalogu")'); await p.waitForSelector('.pmj-imp', { timeout: 30000 });
    let l = await take(); assert.equal(cnt(l, 'jarda_list_import'), 1);
    await p.click('button:has-text("Přidat vše k nacenění")'); await p.waitForSelector('.pmj-form');
    l = await take(); assert.equal(cnt(l, 'jarda_add_to_list'), 1); assert.equal(cnt(l, 'jarda_quote_start'), 1);
  });
  await step('poptávka (dry-run, nic se neodešle) s e-mailem a telefonem → 1× submit, 1× accepted, žádné osobní údaje', async () => {
    await p.fill('.pmj-form input[type=email]', 'jan.novak@example.com'); await p.fill('.pmj-form input[type=tel]', '722 111 222');
    await p.click('.pmj-form .pmj-send');
    await p.waitForFunction(() => document.body && /jsme přijali/.test(document.body.innerText), null, { timeout: 30000, polling: 500 }).catch(async e => { throw new Error(e.message.split('\n')[0] + ' | ' + p.url()); });
    await p.waitForTimeout(1500);
    const l = await take(); assert.equal(cnt(l, 'jarda_quote_submit'), 1); assert.equal(cnt(l, 'jarda_quote_accepted'), 1, JSON.stringify(l.map(x => x[0])));
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(4000); // obnovení stránky nesmí započítat poptávku znovu
    assert.equal(cnt(await take(), 'jarda_quote_accepted'), 0, 'duplicita po obnovení');
  });
  await step('všechny události: send_to GA4, jarda_version, bez e-mailu/telefonu', async () => {
    assert.ok(all.length >= 10);
    for (const [n, o] of all) {
      assert.equal(o.send_to, 'GA4', n); assert.ok(o.jarda_version, n);
      assert.ok(!/jan\.novak|example\.com|722 ?111 ?222/.test(JSON.stringify(o)), 'osobní údaj v ' + n);
    }
    results.push('    události: ' + [...new Set(all.map(x => x[0]))].join(', ') + ' | verze ' + all[0][1].jarda_version);
  });
  await step('bez chyb JavaScriptu', async () => assert.deepEqual(errs.filter(e => /pmj|jarda/i.test(e)), [], errs.join(' | ')));
  if (errs.length) results.push('    chyby webu (mimo Jardu): ' + errs.join(' | ').slice(0, 300));
  await br.close(); console.log(results.join('\n')); console.log(`\n${results.filter(r => r[0] === '✓').length}/${results.filter(r => /^[✓✗]/.test(r)).length} prošlo`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
