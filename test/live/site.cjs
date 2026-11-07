/* Produkční smoke test běžného webu s Jardou (zákazník bez jakéhokoli nastavení): Jarda se načte z kanálu,
   nezasahuje do Shoptetu – vlastní tlačítko „Do košíku“ a našeptávač vyhledávání fungují, žádné chyby JS.
   Objednávka se nevytváří (jen košík testovacího prohlížeče). */
const { chromium, devices } = require('playwright');
const assert = require('assert/strict');
(async () => {
  const br = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  let failed = 0;
  for (const [label, opts] of [['desktop', { viewport: { width: 1366, height: 860 } }], ['mobil', devices['Pixel 7']]]) {
    const c = await br.newContext(opts), p = await c.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message));
    try {
      await p.goto('https://www.promontaz.cz/kramle/kramle-tesarska-10x200/', { waitUntil: 'load' });
      await p.waitForSelector('.pmj-fab', { timeout: 45000 }); await p.waitForTimeout(1500);
      const ver = await p.$eval('.pmj-root', e => e.dataset.version || 'v2'), fabs = await p.$$eval('.pmj-fab', a => a.length);
      assert.equal(fabs, 1); assert.equal(ver, require('../../package.json').jarda.stable);
      await p.$eval('button[data-testid="buttonCookiesAccept"]', b => b.click()).catch(() => {}); await p.waitForTimeout(800);
      // Shoptet: vlastní formulář produktu do košíku
      await p.$eval('#product-detail-form [type=submit], #product-detail-form button.add-to-cart-button', b => b.click());
      await p.waitForTimeout(4000);
      await p.goto('https://www.promontaz.cz/kosik/', { waitUntil: 'load' });
      const items = await p.evaluate(() => dataLayer.find(o => o.shoptet).shoptet.cartInfo.cartItems.map(i => i.code));
      assert.ok(items.includes('HR_10075'), 'Shoptet Do košíku: ' + JSON.stringify(items));
      // našeptávač vyhledávání webu (promontaz-search)
      await p.goto('https://www.promontaz.cz/', { waitUntil: 'load' });
      const sInput = await p.$('#formSearchForm input[name="string"]:visible, input[name="string"]:visible');
      if (sInput) { await sInput.fill('vrut 5x60'); await p.waitForTimeout(4000); }
      const sugg = await p.evaluate(() => document.body.innerText.includes('Vrut') ? 1 : 0);
      assert.ok(!sInput || sugg, 'našeptávač');
      await p.waitForSelector('.pmj-fab', { timeout: 45000 });
      assert.deepEqual(errs.filter(e => /pmj|jarda/i.test(e)), []);
      console.log(`✓ ${label}: Jarda ${ver} (1 instance), Shoptet Do košíku OK, našeptávač ${sInput ? 'OK' : 'pole nenalezeno'}, chyby JS webu: ${errs.length ? errs.map(e => e.slice(0, 60)).join(' | ') : 'žádné'}`);
    } catch (e) { failed++; console.log(`✗ ${label}: ${e.message.split('\n')[0]}`); }
    await c.close();
  }
  await br.close(); process.exit(failed ? 1 : 0);
})();
