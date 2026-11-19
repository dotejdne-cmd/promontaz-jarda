/* KONTROLOVANÝ SKUTEČNÝ TEST poptávky (odešle e-mail na info@promontaz.cz přes FormSubmit). Spouštět jen vědomě:
   REAL=1 node test/live/quote-real.cjs. Předmět „TEST – …“ (?pmj=test), poznámka „Kontrolní test… neodpovídat“,
   fiktivní telefon, žádný e-mail. Nevzniká objednávka. Ověří: bez přílohy (AJAX success), s přílohami (multipart → _next). */
if (process.env.REAL !== '1') { console.log('Bez REAL=1 se nic neodesílá.'); process.exit(0); }
const { chromium, devices } = require('playwright');
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), os = require('os');
const V = require('../../package.json').version, out = [];
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmjq-')); fs.writeFileSync(dir + '/test-vykaz.pdf', PDF); fs.writeFileSync(dir + '/test-foto.png', PNG);
  const br = await chromium.launch();
  for (const [label, files, mobile] of [['bez přílohy (AJAX)', [], false], ['s přílohami PDF + PNG (multipart)', [dir + '/test-vykaz.pdf', dir + '/test-foto.png'], true]].filter(x => !process.env.ONLY || (process.env.ONLY === 'files') === !!x[1].length)) {
    const c = await br.newContext(mobile ? { ...devices['iPhone 13'] } : {}); const posts = [];
    await c.addInitScript(v => { try { localStorage.setItem('pmj_ver', v); } catch (e) {} }, V);
    if (process.env.LOCAL) await c.route(/dotejdne-cmd\.github\.io\/promontaz-jarda\/([^?]*)/, r => { // nenasazená verze z repa (jen v tomto prohlížeči)
      let f = /promontaz-jarda\/([^?]*)/.exec(r.request().url())[1]; if (f === 'dist/stable/jarda.min.js') f = `dist/${V}/jarda.min.js`;
      const fp = path.join(__dirname, '../..', f); if (!fs.existsSync(fp)) return r.fulfill({ status: 404, body: '' });
      r.fulfill({ path: fp, headers: { 'access-control-allow-origin': '*', 'content-type': /\.js$/.test(f) ? 'application/javascript' : /\.json$/.test(f) ? 'application/json' : 'image/webp' } });
    });
    const ga = []; c.on('request', q => { if (/\/g\/collect/.test(q.url())) ga.push(q.url() + '\n' + (q.postData() || '')); });
    c.on('request', q => { if (/^https:\/\/formsubmit\.co\//.test(q.url()) && q.method() === 'POST') posts.push(q.url()); });
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('https://www.promontaz.cz/kalkulacky/?pmj=test', { waitUntil: 'load' });
    await p.waitForSelector('.pmj-fab', { timeout: 45000 });
    await p.$eval('button[data-testid="buttonCookiesReject"], .siteCookies button[value="reject"]', b => b.click()).catch(() => {}); await p.waitForTimeout(800);
    await p.$eval('.siteCookies', e => e.remove()).catch(() => {}); // lišta má přednost před Jardou; pro test ji odstraníme
    await p.click('.pmj-fab'); await p.waitForSelector('.pmj-chip');
    await p.fill('.pmj-q', '250 ks vrut konstrukční 3,5x35 zz'); await p.press('.pmj-q', 'Enter'); await p.waitForSelector('.pmj-card', { timeout: 60000 });
    await p.click('.pmj-card:has(.pmj-code:has-text("VR_10005")) .pmj-add:has-text("k nacenění")');
    await p.click('button:has-text("Nacenit seznam")'); await p.waitForSelector('.pmj-form');
    if (files.length) await p.setInputFiles('.pmj-form input[type=file]', files), await p.waitForSelector('.pmj-files li:nth-child(2)');
    await p.fill('.pmj-form input[type=tel]', '+420 000 000 000');
    await p.click('.pmj-more summary'); await p.fill('.pmj-more textarea', 'Kontrolní test widgetu Jarda ' + V + ' (' + label + ') – NEODPOVÍDAT, nejde o zákazníka.');
    assert.match(await p.inputValue('.pmj-form textarea'), /^250 ks HASPL Vrut konstrukční 3,5x35/);
    await p.click('.pmj-form .pmj-send');
    const nav = []; p.on('framenavigated', f => { if (f === p.mainFrame()) nav.push(f.url().slice(0, 90)); });
    c.on('response', r => { if (/formsubmit\.co/.test(r.url())) nav.push('resp ' + r.status() + ' ' + r.url().slice(0, 70)); });
    await p.waitForFunction(() => document.body && /jsme přijali|NEBYLA|nepodařilo/i.test(document.body.innerText), null, { timeout: 90000, polling: 500 })
      .catch(async e => { throw new Error('bez výsledku; url=' + p.url() + ' | ' + nav.join(' → ') + ' | text: ' + (await p.evaluate(() => document.body ? document.body.innerText.slice(0, 200) : '')).replace(/\n+/g, ' ')); });
    const txt = await p.evaluate(() => { const m = [...document.querySelectorAll('.pmj-bot')].map(b => b.innerText).filter(t => /poptávk/i.test(t)).pop(); return m || ''; });
    const id = (/PM-\d{6}-J[A-Z0-9]{6}/.exec(txt) || [''])[0];
    const list = await p.evaluate(() => localStorage.pmj2_list || null);
    out.push(`${/jsme přijali/.test(txt) ? '✓' : '✗'} ${label}${mobile ? ' (iPhone 13 emulace)' : ''}: ${txt.split('\n')[0]} | POST: ${posts.map(u => u.replace('https://formsubmit.co/', '')).join(', ')} | seznam po přijetí: ${list ? 'NEPRÁZDNÝ' : 'prázdný'} | chyby JS: ${errs.length}`);
    await p.waitForTimeout(3000);
    const formEv = ga.filter(x => /en=form_(start|submit)/.test(x)).length;
    out.push(`    GA4 form_start/form_submit: ${formEv}`);
    if (!/jsme přijali/.test(txt) || list || errs.length || posts.filter(u => /formsubmit/.test(u)).length !== 1 || formEv) process.exitCode = 1;
    await c.close();
  }
  await br.close(); console.log(out.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
