/* ProMontaz – Jarda v3: aplikace (panel, hledání, seznam, poptávka). Stahuje se až při interakci se zavaděčem. */
import { st, stJSON, h, abs, fetchJSON, merge, listMerge } from './util.js';
import { buildIndexAsync, search, prepSynonyms, thumbUrl, unitLabel } from './search.js';
import { prepRules, classify } from './intent.js';
import { probe, formText, mailto, copyText, mailBody, noLinks } from './fallback.js';
import { parseQty, parseLines, qtyLabel } from './qty.js';
import { fetchProduct, plan, sameCode } from './buy.js';

window.__pmjApp = function (X) {
  var C = X.C, SD = X.SD || {}, track = X.track, root = X.root, fab = X.fab;
  document.head.appendChild(h('style', { id: 'pmj-style', text: __CSS__ }));

  /* config.app.json (pravidla, texty v3). Bez něj Jarda funguje dál: volný text se bere jako hledání. */
  var A = { texts_v3: {}, intent_rules: {}, synonyms: {}, quote: {}, cart_add: {}, contact: {}, shipping: null, calculators: [] }, RULES = {}, SYN = {};
  var cfgP = (X.appCfg || fetchJSON(X.root_url + 'config.app.json', 6000)).then(function (j) { merge(A, j); }, function () {}).then(function () {
    if (window.PMJ_APP_CONFIG_OVERRIDE) merge(A, window.PMJ_APP_CONFIG_OVERRIDE);
    RULES = prepRules(A.intent_rules); SYN = prepSynonyms(A.synonyms);
  });

  /* ---------- texty ---------- */
  function T(k, vars) {
    var s = (A.texts_v3 && A.texts_v3[k]) || (C.texts && C.texts[k]) || '';
    for (var v in vars || {}) s = s.split('{' + v + '}').join(vars[v]);
    return s;
  }
  function kc(n) {
    try { return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 }).format(n) + ' Kč'; } catch (e) { return n + ' Kč'; }
  }
  var L = C.links || {};
  function contact() {
    var c = A.contact || {};
    return { phone: c.phone || '+420722792670', phoneLabel: c.phone_label || '722 792 670', email: c.email || 'info@promontaz.cz', orders: c.account_orders || '/klient/objednavky/' };
  }

  /* ---------- seznam (localStorage, sdílený s v2) a rozepsaná poptávka (sessionStorage) ---------- */
  function getList() { var l = stJSON('localStorage', 'list', []); return Array.isArray(l) ? l : []; }
  function setList(l) { st('localStorage', 'list', l.length ? JSON.stringify(l) : null); X.updateBadge(); if (countEl) countEl.textContent = l.length ? ' (' + l.length + ')' : ''; }
  function sameItem(a, b) { return a.n === b.n && (a.u || '') === (b.u || '') && (a.un || '') === (b.un || ''); }
  var ALLOWED = [String(C.shop_base || 'https://www.promontaz.cz/')];
  function addItems(items, source) {
    var l = getList(), n = listMerge(l, items, ALLOWED);
    if (n) { setList(l); track('jarda_add_to_list', { item_source: source, list_count: l.length, items_added: n }); }
    return n;
  }
  function addItem(it, source) { return addItems([it], source); }
  /* Neuvedený počet (q = 0) zůstává neuvedený – v poptávce je výslovně „POČET NEUVEDEN“, nikdy ne 1 ks. */
  function listText(l) {
    return l.map(function (x) { return (x.q ? qtyLabel(x.q, x.un) + ' ' : '') + (x.f ? 'Dotaz: ' : '') + x.n + (x.c ? ' (kód ' + x.c + ')' : '') + (x.u ? ' – ' + x.u : '') + (x.q ? '' : ' – POČET NEUVEDEN'); }).join('\n');
  }
  function noQty(l) { return l.filter(function (x) { return !x.q; }).length; }

  /* ---------- index ---------- */
  var indexP = null;
  function getIndex() {
    if (!indexP) {
      if (!C.index_url) return Promise.reject(new Error('no index'));
      indexP = fetchJSON(C.index_url, 45000).then(function (d) { return buildIndexAsync(d); });
      indexP.catch(function () { indexP = null; });
    }
    return indexP;
  }
  function thumb(it) { return thumbUrl(it.i, A.thumb_base); }


  /* ---------- UI ---------- */
  var panel, log, input, countEl, isOpen = false, lastFocus = null, blocks = {}, started = false;
  function scrollEnd() { log.scrollTop = log.scrollHeight; }
  function say(kids, cls, key) {
    if (key && blocks[key] && blocks[key].parentNode) blocks[key].parentNode.removeChild(blocks[key]);
    var m = h('div', { class: 'pmj-msg ' + (cls || 'pmj-bot') }, kids);
    log.appendChild(m);
    if (key) blocks[key] = m;
    // dlouhá obrazovka (výsledky, poptávka): ukázat její začátek, ne konec
    if (m.offsetHeight > log.clientHeight - 24) log.scrollTop += m.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
    else scrollEnd();
    return m;
  }

  /* ---------- navigace (3.2): zásobník logických obrazovek ----------
     Obrazovka = {k klíč, t název, r(replay) vykreslení, c volba}. Vykreslení nemá vedlejší efekty (nic nevkládá do košíku
     ani do seznamu, nic neodesílá, neměří) – Zpět ho jen zopakuje z dat v paměti. Klíč, který už v zásobníku je, zásobník
     zkrátí (Seznam → Poptávka → Seznam nevytvoří smyčku). Historie prohlížeče (window.history) se nepoužívá. */
  var NAV = [], NAV_MAX = 12, lastWork = null, navEl, backEl, homeEl;
  function screen(k, t, r, choice) {
    for (var i = 0; i < NAV.length; i++) if (NAV[i].k === k) { NAV.length = i; break; }
    NAV.push({ k: k, t: t, r: r, c: !!choice });
    if (NAV.length > NAV_MAX) NAV.splice(1, NAV.length - NAV_MAX);
    var m = r(false);
    updNav();
    return m;
  }
  function kind(e) { return e ? e.k.split(':')[0] : ''; }
  function updNav() {
    if (!navEl) return;
    var prev = NAV[NAV.length - 2], cur = NAV[NAV.length - 1];
    navEl.hidden = !prev && (!cur || cur.k === 'menu'); // bez nabídky v zásobníku (např. po návratu z odeslání) aspoň Hlavní nabídka
    backEl.hidden = !prev; homeEl.hidden = false;
    if (!prev) return;
    backEl.textContent = prev.c ? '← Změnit volbu' : '← ' + prev.t;
    backEl.setAttribute('aria-label', (prev.c ? 'Změnit volbu: ' : 'Zpět na: ') + prev.t);
    homeEl.hidden = prev.k === 'menu';
  }
  function showEntry(e) {
    var m = e.r(true);
    updNav();
    if (m) { m.setAttribute('tabindex', '-1'); try { m.focus({ preventScroll: true }); } catch (x) {} }
  }
  function back() {
    if (NAV.length < 2) { home(); return; }
    var cur = NAV.pop(), e = NAV[NAV.length - 1];
    track('jarda_nav', { nav: 'back', from: kind(cur), to: kind(e) });
    you(e.c ? 'Změnit volbu' : 'Zpět: ' + e.t);
    showEntry(e);
  }
  function home() {
    var cur = NAV[NAV.length - 1];
    if (cur && cur.k !== 'menu') lastWork = cur;
    track('jarda_nav', { nav: 'home', from: kind(cur) });
    you('Hlavní nabídka');
    NAV.length = 0;
    intro(true);
    updNav();
  }
  function resume(e) {
    track('jarda_nav', { nav: 'resume', to: kind(e) });
    you('Pokračovat: ' + e.t);
    NAV.length = 1; NAV.push(e); lastWork = null;
    showEntry(e);
  }
  function you(t) { say([h('p', { text: t })], 'pmj-you'); }
  function p(t, cls) { return h('p', { text: t, class: cls || null }); }
  function actions(list) { return h('div', { class: 'pmj-actions' }, list); }
  function btn(label, fn, cls, extra) {
    var o = { type: 'button', class: 'pmj-btn ' + (cls || 'pmj-btn-ghost'), text: label, onclick: fn };
    for (var k in extra || {}) o[k] = extra[k];
    return h('button', o);
  }
  function link(label, href, cls, ext, onclick) {
    return h('a', { class: 'pmj-btn ' + (cls || 'pmj-btn-ghost'), href: href, text: label, target: ext ? '_blank' : null, rel: ext ? 'noopener' : null, onclick: onclick || null });
  }
  function remove(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

  function waHref(prefix) {
    var l = getList(), msg = (prefix || T('whatsapp_message')) + '\nStránka: ' + location.href;
    if (l.length && !prefix) msg += '\n\nSeznam k nacenění:\n' + listText(l);
    return 'https://wa.me/' + C.whatsapp + '?text=' + encodeURIComponent(msg);
  }
  function waButton(prefix, ctx) {
    var a = h('a', { class: 'pmj-btn pmj-btn-wa', href: waHref(prefix), target: '_blank', rel: 'noopener', text: 'Napsat na WhatsApp' });
    a.addEventListener('click', function () { a.href = waHref(prefix); track('jarda_whatsapp', { context: ctx || 'general', list_count: getList().length }); });
    return a;
  }
  function contactButtons(prefix, ctx) {
    var c = contact();
    return actions([waButton(prefix, ctx),
      link('Volat ' + c.phoneLabel, 'tel:' + c.phone, '', false, function () { track('jarda_contact_click', { channel: 'phone', context: ctx || 'general' }); }),
      link('E-mail', 'mailto:' + c.email + (prefix ? '?subject=' + encodeURIComponent(prefix) : ''), '', false, function () { track('jarda_contact_click', { channel: 'email', context: ctx || 'general' }); })]);
  }

  /* ---------- kontext stránky ---------- */
  function currentProduct() {
    var pr = SD.product, name = pr && pr.name, code = pr && pr.code;
    var codeEl = document.querySelector('.p-code span:not(.p-code-label)');
    if (pr && pr.hasVariants && codeEl) code = codeEl.textContent.trim() || code;
    if (!name) { var h1 = document.querySelector('.p-detail-inner-header h1, h1'); name = h1 && h1.textContent.trim(); }
    if (!code && codeEl) code = codeEl.textContent.trim();
    var amt = document.querySelector('#product-detail-form input[name="amount"]');
    var q = amt ? Math.max(1, Math.round(parseFloat(String(amt.value).replace(',', '.')) || 1)) : 1;
    return name ? { n: name, c: code || '', u: location.origin + location.pathname, q: q } : null;
  }
  /* Montážní sady: komponenty jen z popisu produktu („(SKU KV_11983)“) – žádné domýšlení souvisejících položek. */
  function setCodes() {
    if (SD.pageType !== 'productDetail') return [];
    var t = ['#description', '.p-detail-description', '[data-testid="productCardDescr"]'].map(function (q) { var d = document.querySelector(q); return d ? d.textContent : ''; }).join(' ');
    var re = /\(SKU\s+([A-Za-z0-9_.\-]{3,40})\)/g, m, out = [];
    while ((m = re.exec(t))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out.slice(0, 12);
  }
  function cartInfo() {
    var ci = SD.cartInfo;
    if (SD.pageType !== 'cart' || !ci || !Array.isArray(ci.cartItems) || !ci.cartItems.length) return null;
    var val = ci.getNoBillingShippingPrice && ci.getNoBillingShippingPrice.withVat;
    return { items: ci.cartItems, value: typeof val === 'number' && isFinite(val) ? val : null };
  }
  function cartMissing() {
    var ci = cartInfo(), min = C.facts && C.facts.min_order_czk;
    if (!ci || ci.value == null || typeof min !== 'number') return 0;
    return ci.value < min ? Math.round((min - ci.value) * 100) / 100 : 0;
  }

  /* ---------- čipy ---------- */
  function chipDefs() {
    var list = [];
    if (SD.pageType === 'productDetail' && SD.product) list.push(['produkt', 'Větší množství? Naceníme', productBulk, 1]);
    if (setCodes().length) list.push(['sada', 'Co obsahuje sada', showSet]);
    if (cartInfo() && C.context && C.context.cart_quote_chip !== false) list.push(['kosik', 'Poslat košík k nacenění', cartToQuote, 1]);
    return list.concat([
      ['najit', 'Najít materiál', find],
      ['nacenit', 'Nacenit seznam nebo fotku', function () { showQuote('chip'); }],
      ['vlozit', 'Vložit seznam materiálu', importForm],
      ['spotreba', 'Spočítat spotřebu', calc],
      ['doprava', 'Doprava a platba', shipping],
      ['objednavka', 'Moje objednávka', orderStatus],
      ['clovek', 'Napsat obchodníkovi', human]
    ]);
  }
  function chipRow(defs) {
    return h('div', { class: 'pmj-chips', role: 'group', 'aria-label': 'Možnosti' }, defs.map(function (c) {
      return h('button', { type: 'button', class: 'pmj-chip' + (c[3] ? ' pmj-chip-hot' : ''), text: c[1],
        onclick: function () { track('jarda_chip_click', { chip: c[0], page_type: SD.pageType || '' }); you(c[1]); c[2](); } });
    }));
  }

  /* Hlavní nabídka. „Pokračovat“ vrací do rozpracované činnosti (v paměti), po načtení jiné stránky do seznamu,
     rozepsané poptávky nebo posledního hledání (sessionStorage/localStorage). */
  var cartStale = false, firstIntro = true;
  function resumeRow() {
    var r = [], d = draftGet(), n = getList().length, lq = lastQuery || st('sessionStorage', 'lastq');
    if (lastWork) r.push(btn('Pokračovat: ' + lastWork.t, function () { resume(lastWork); }, 'pmj-btn-primary'));
    else {
      if (draftHas(d) || Q.files.length) r.push(btn('Dokončit rozepsanou poptávku', function () { you('Dokončit poptávku'); showQuote('resume'); }, 'pmj-btn-primary'));
      else if (n) r.push(btn('Seznam k nacenění (' + n + ')', function () { you('Seznam k nacenění'); showList(); }, 'pmj-btn-primary'));
      if (lq) r.push(btn('Poslední hledání: „' + short(lq, 28) + '“', function () { track('jarda_nav', { nav: 'resume', to: 'results' }); you(lq); runQuery(lq); }));
    }
    return r.length ? h('div', { class: 'pmj-resume' }, [p('Pokračovat, kde jste skončili:', 'pmj-small'), actions(r)]) : null;
  }
  function intro() {
    var m = screen('menu', 'Nabídka', function () {
      var kids = [p(T('greeting'))], miss = cartStale ? 0 : cartMissing();
      if (miss > 0) kids.push(p(T('cart_missing', { x: kc(miss) }), 'pmj-note'));
      var ci = cartInfo();
      if (ci && C.context && C.context.cart_quote_chip !== false) kids.push(p(T('cart_quote'), 'pmj-small'));
      kids.push(resumeRow());
      return say(kids.concat([chipRow(chipDefs())]), 'pmj-bot', 'intro');
    }, true);
    if (firstIntro) {
      firstIntro = false;
      var stale = function () { cartStale = true; if (blocks.intro) remove(blocks.intro.querySelector('.pmj-note')); };
      document.addEventListener('ShoptetCartUpdated', stale);
      document.addEventListener('ShoptetDOMCartContentLoaded', stale);
      checkUnconfirmed();
    }
    return m;
  }
  function short(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  /* ---------- hledání ---------- */
  var lastQuery = '';
  function find() {
    screen('find', 'Hledání', function () {
      var lq = lastQuery;
      return say([p(T('search_prompt') + ' ' + (T('search_qty_hint') || '')), lq ? actions([btn('Upravit „' + short(lq, 28) + '“', editQuery)]) : null], 'pmj-bot', 'find');
    });
    getIndex().catch(function () {});
    input.focus();
  }
  /* Oprava posledního dotazu: vrátí ho do pole (včetně množství), bez nového hledání. */
  function editQuery() {
    var lq = lastQuery || st('sessionStorage', 'lastq') || '';
    track('jarda_nav', { nav: 'edit_query' });
    input.value = lq;
    input.focus();
    try { input.setSelectionRange(0, lq.length); } catch (e) {}
  }

  /* Vložení do seznamu: požadované množství a jednotka se zachovají; bez množství zůstane „počet neuveden“. */
  function addFree(q, req) { var it = { n: q, f: 1, q: req && req.q || 0, un: req && req.unit || '' }; addItem(it, 'free_text'); added(it); }
  function qtyBox(match, label) {
    var cur = getList().filter(function (x) { return sameItem(x, match); })[0] || match;
    var qi = h('input', { type: 'number', class: 'pmj-qty', min: '0', step: 'any', inputmode: 'decimal', value: cur.q ? String(cur.q) : '', placeholder: 'počet',
      'aria-label': 'Množství' + (cur.un ? ' (' + cur.un + ')' : '') + ': ' + (label || cur.n) });
    qi.addEventListener('change', function () {
      var raw = String(qi.value).trim(), v = parseFloat(raw.replace(',', '.')), l = getList(), it = l.filter(function (x) { return sameItem(x, match); })[0];
      if (!it) return;
      if (raw === '') v = 0; else if (!isFinite(v) || v < 0) { qi.value = it.q ? String(it.q) : ''; return; }
      it.q = Math.min(100000, Math.round(v * 1000) / 1000);
      qi.value = it.q ? String(it.q) : '';
      setList(l);
      var row = qi.closest('.pmj-row'); if (row) row.classList.toggle('pmj-row-noq', !it.q);
    });
    return qi;
  }
  function added(it) {
    var kids = [p(T('added') + ' Položek v seznamu: ' + getList().length + '.')];
    if (it && it.n) {
      var m = { n: it.n, u: it.u || '', un: it.un || '' };
      kids.push(h('div', { class: 'pmj-row pmj-added' }, [h('span', { class: 'pmj-row-name', text: it.n }), qtyBox(m), m.un ? h('span', { class: 'pmj-un', text: m.un }) : null]));
      if (!it.q) kids.push(p('Doplňte prosím počet – nebo ho s vámi upřesní obchodník.', 'pmj-small'));
    }
    kids.push(actions([btn('Zobrazit seznam', showList), btn('Nacenit seznam', function () { showQuote('added'); }, 'pmj-btn-primary')]));
    say(kids, 'pmj-bot', 'added');
  }

  function cartAllowed(it) {
    var ca = A.cart_add || {}, cs = window.shoptet && window.shoptet.cartShared;
    return ca.enabled && !it.v && !!it.c && !!cs && typeof cs.addToCart === 'function';
  }
  /* Vložení do košíku přes Shoptet (shoptet.cartShared.addToCart podle kódu produktu, jen produkty bez variant).
     Úspěch hlásíme až po události ShoptetCartUpdated, jinak odkaz na produkt. */
  var CART = {}, inflight = {}; // vloženo z Jardy na této stránce (kód → množství); probíhající vložení
  function addToCart(it, amount, b, label, conv) {
    if (inflight[it.c]) return; // dvojklik nebo druhé tlačítko téhož produktu: nic dalšího se nevkládá
    inflight[it.c] = 1;
    b.disabled = true; b.textContent = 'Vkládám…';
    var done = false, to = (A.cart_add && A.cart_add.confirm_timeout_ms) || 6000;
    function finish(ok) {
      if (done) return; done = true; inflight[it.c] = 0;
      document.removeEventListener('ShoptetCartUpdated', onOk);
      document.removeEventListener('ShoptetCartAddCartItemFailed', onFail);
      track('jarda_add_to_cart', { item_id: it.c, result: ok ? 'ok' : 'fail', quantity: amount, qty_conversion: conv || '' });
      if (ok) {
        CART[it.c] = Math.round(((CART[it.c] || 0) + amount) * 1000) / 1000;
        b.textContent = '✓ V košíku';
        var prev = NAV[NAV.length - 2], acts = [link('Zobrazit košík', '/kosik/', 'pmj-btn-primary')];
        if (kind(NAV[NAV.length - 1]) === 'product' && kind(prev) === 'results') acts.push(btn('Pokračovat v nákupu', function () { NAV.pop(); you('Zpět: ' + prev.t); showEntry(prev); }));
        acts.push(btn('Hledat další', function () { you('Hledat další'); find(); }));
        say([p(T('cart_added') + ' ' + label + ' – ' + it.n + '.'), p(T('cart_next') || 'Objednávku dokončíte v košíku e-shopu.', 'pmj-small'), actions(acts)], 'pmj-bot', 'cart');
      }
      else { b.disabled = false; b.textContent = 'Vložit do košíku'; say([p(T('cart_failed')), actions([link('Otevřít produkt', it.u, 'pmj-btn-primary')])], 'pmj-bot', 'cart'); }
    }
    function onOk() { finish(true); }
    function onFail() { finish(false); }
    document.addEventListener('ShoptetCartUpdated', onOk);
    document.addEventListener('ShoptetCartAddCartItemFailed', onFail);
    setTimeout(function () { finish(false); }, to);
    /* 3.2: silent = true (2. parametr Shoptet API) – bez okna „Přidáno do košíku“ (rozšířená objednávka). To okno si bere
       fokus klávesnice, takže do otevřeného Jardy nešlo psát (na mobilu je navíc schované pod panelem). Potvrzení
       a „Zobrazit košík“ dává Jarda. ShoptetCartUpdated i hlavička košíku fungují dál (ověřeno živě 20. 11. 2026). */
    try { window.shoptet.cartShared.addToCart({ productCode: it.c, amount: amount }, true); } catch (e) { finish(false); }
  }

  /* Ověřený nákup: údaje (jednotka, balení, min/krok, cena, kód, varianty) ze stránky produktu v e-shopu.
     Bez ověření se do košíku nic nevkládá. */
  var UL = { ks: 'ks', bal: 'bal.', m: 'm', m2: 'm²' };
  function uLabel(u) { return UL[u] || u || 'ks'; }
  function fmtQ(x) { return String(x).replace('.', ','); }
  function buyBox(it, req, li, replay) {
    var box = h('div', { class: 'pmj-buy', 'aria-live': 'polite' }, [p('Ověřuji balení a cenu v e-shopu…', 'pmj-small')]);
    li.appendChild(box);
    var ca = A.cart_add || {};
    function tr(o) { if (!replay) track('jarda_cart_verify', o); } // Zpět na produkt nic znovu neměří
    fetchProduct(it.u, ALLOWED, ca.verify_timeout_ms || 8000).then(function (f) {
      box.textContent = '';
      if (f.variants) { tr({ item_id: it.c, result: 'variant' }); box.appendChild(p(T('variant_hint'), 'pmj-small')); box.appendChild(actions([link('Vybrat variantu', it.u, 'pmj-btn-primary')])); return; }
      if (!sameCode(f.code, it.c) || f.price == null) {
        tr({ item_id: it.c, result: 'mismatch' });
        box.appendChild(p(T('verify_mismatch') || 'Údaje produktu se teď nepodařilo ověřit. Otevřete prosím produkt, cenu a balení uvidíte tam.', 'pmj-small'));
        box.appendChild(actions([link('Otevřít produkt', it.u, 'pmj-btn-primary')])); return;
      }
      var pl = plan(f, req), unit = uLabel(f.unit);
      tr({ item_id: it.c, result: 'ok', qty_conversion: pl.conv });
      var qi = h('input', { type: 'number', class: 'pmj-qty', min: String(f.min || 1), step: String(f.step || 1), max: f.max != null ? String(f.max) : null, inputmode: f.dec ? 'decimal' : 'numeric', value: String(pl.amount), 'aria-label': 'Množství v ' + unit + ': ' + it.n });
      var tot = h('span', { class: 'pmj-price' }), info = [];
      var packTxt = f.pack && f.pack.n > 1 ? 'Prodává se po ' + unit + (f.unit === 'bal' ? ' (' + fmtQ(f.pack.n) + ' ' + uLabel(f.pack.unit) + ')' : '; obsah balení ' + fmtQ(f.pack.n) + ' ' + uLabel(f.pack.unit)) + '.' : 'Prodává se po ' + unit + '.';
      info.push(packTxt);
      if (pl.conv === 'pack') info.push('Na ' + qtyLabel(req.q, req.unit) + ' stačí ' + fmtQ(pl.amount) + ' ' + unit + ' (' + fmtQ(pl.amount * f.pack.n) + ' ' + uLabel(f.pack.unit) + ').');
      else if (pl.conv === 'ask' && req && req.q) info.push('Chcete ' + qtyLabel(req.q, req.unit) + ' – nastavte prosím počet v ' + unit + '.');
      if (pl.note === 'rounded') info.push('Upraveno na nejbližší prodávané množství.');
      if (f.min > 1 || f.step > 1) info.push('Nejmenší množství ' + fmtQ(f.min) + ' ' + unit + (f.step > 1 ? ', po ' + fmtQ(f.step) : '') + '.');
      if (CART[it.c]) info.push('Z Jardy už máte v košíku ' + fmtQ(CART[it.c]) + ' ' + unit + ' – další vložení se k nim přičte.');
      var b2b = (ca.b2b_hint_from_czk || 15000), hint = p('', 'pmj-note');
      function val() { var v = parseFloat(String(qi.value).replace(',', '.')); return isFinite(v) && v > 0 ? v : 0; }
      function upd() {
        var v = val(), t = f.price * v;
        tot.textContent = v ? '= ' + kc(Math.round(t * 100) / 100) + ' s DPH' : '';
        var big = (f.max != null && v >= f.max) || t >= b2b;
        hint.textContent = big ? T('b2b_hint') || 'Větší odběr? Rádi vám ho naceníme.' : '';
        hint.hidden = !big;
      }
      qi.addEventListener('input', upd);
      var go = btn('Vložit do košíku', function () {
        var v = val(), ok = v && v >= (f.min || 1) && (f.max == null || v <= f.max) && Math.abs(Math.round(v / (f.step || 1)) * (f.step || 1) - v) < 1e-6;
        if (!ok) { qi.setAttribute('aria-invalid', 'true'); hint.hidden = false; hint.textContent = 'Zadejte množství od ' + fmtQ(f.min || 1) + (f.max != null ? ' do ' + fmtQ(f.max) : '') + ' ' + unit + (f.step > 1 ? ' po ' + fmtQ(f.step) : '') + '.'; qi.focus(); return; }
        qi.removeAttribute('aria-invalid');
        addToCart(it, v, go, fmtQ(v) + ' ' + unit, pl.conv);
      }, 'pmj-btn-primary');
      box.appendChild(p(info.join(' '), 'pmj-small'));
      box.appendChild(h('div', { class: 'pmj-buyrow' }, [h('label', { class: 'pmj-buyq' }, [qi, h('span', { text: ' ' + unit })]), tot]));
      box.appendChild(hint);
      var nb = btn('Nacenit', function () {
        var x = { n: it.n, c: it.c, u: it.u, q: val() || 0, un: f.unit in UL ? f.unit : '' };
        addItem(x, 'buy_quote'); nb.disabled = true; nb.textContent = '✓ V seznamu'; added(x);
      });
      box.appendChild(actions([go, nb]));
      upd();
      if (!replay) (pl.conv === 'ask' ? qi : go).focus();
    }, function (e) {
      tr({ item_id: it.c, result: 'error' });
      box.textContent = '';
      box.appendChild(p(T('verify_failed') || 'Balení a cenu se teď nepodařilo ověřit. Otevřete prosím produkt, nebo ho přidejte k nacenění.', 'pmj-small'));
      box.appendChild(actions([link('Otevřít produkt', it.u, 'pmj-btn-primary')]));
    });
  }

  function inList(it) { return !!it.u && getList().some(function (x) { return x.u === it.u; }); }
  /* detail = karta na obrazovce produktu (s ověřeným nákupem), jinak karta ve výsledcích */
  function card(it, pos, q, source, req, detail) {
    var has = inList(it);
    var add = h('button', { type: 'button', class: 'pmj-btn pmj-add ' + (detail ? 'pmj-btn-ghost' : 'pmj-btn-primary') /* u produktu je hlavní akce nákup */, text: has ? '✓ V seznamu' : '+ k nacenění', disabled: has, 'aria-label': has ? 'V seznamu: ' + it.n : 'Přidat k nacenění: ' + it.n });
    add.addEventListener('click', function () {
      if (inList(it)) { add.textContent = '✓ V seznamu'; add.disabled = true; return; }
      var x = { n: it.n, c: it.c, u: it.u, q: req && req.q || 0, un: req && req.unit || '' };
      addItem(x, source || 'search'); add.textContent = '✓ V seznamu'; add.disabled = true; added(x);
    });
    var btns = [add], li;
    if (cartAllowed(it) && !detail) {
      var cb = h('button', { type: 'button', class: 'pmj-btn pmj-btn-ghost pmj-add', text: 'Do košíku', 'aria-label': 'Do košíku (ověřit balení): ' + it.n });
      cb.addEventListener('click', function () { track('jarda_chip_click', { chip: 'buy' }); you('Do košíku: ' + short(it.n, 40)); productScreen(it, req, q, pos); });
      btns.push(cb);
    } else if (it.v) btns.push(link('Vybrat variantu', it.u, 'pmj-btn-ghost pmj-add'));
    var ul = unitLabel(it.un, it.pk);
    var src = thumb(it);
    function clickTrack() { track('jarda_product_click', { item_id: it.c, index: pos + 1, search_term: q || '' }); }
    li = h('li', { class: 'pmj-card' }, [
      src ? h('img', { class: 'pmj-thumb', src: src, alt: '', width: '56', height: '56', loading: 'lazy', decoding: 'async', onerror: function () { this.style.visibility = 'hidden'; } }) : h('span', { class: 'pmj-thumb' }),
      h('div', { class: 'pmj-card-body' }, [
        h('a', { class: 'pmj-card-name', href: it.u, text: it.n, onclick: clickTrack }),
        it.p != null ? h('span', { class: 'pmj-price' }, [(it.v ? 'od ' : '') + kc(it.p) + (ul ? ' ' + ul : ''), h('small', { text: ' s DPH' })]) : null,
        it.c ? h('span', { class: 'pmj-code', text: 'Kód: ' + it.c }) : null
      ]),
      h('div', { class: 'pmj-card-actions' }, btns)
    ]);
    return li;
  }
  function cards(list, q, source, req) { return h('ul', { class: 'pmj-cards' }, list.map(function (it, i) { return card(it, i, q, source, req); })); }
  /* Produkt: ověření balení a ceny na stránce e-shopu (výsledek se pamatuje, Zpět nic znovu nestahuje). */
  function productScreen(it, req, q, pos) {
    var k = 'product:' + (it.c || it.u);
    return screen(k, short(it.n, 34), function (rp) {
      var li = card(it, pos, q, 'search', req, true);
      if (cartAllowed(it)) buyBox(it, req, li, rp);
      return say([h('ul', { class: 'pmj-cards' }, [li])], 'pmj-bot', k);
    });
  }

  /* odkaz na kalkulačku k dotazu (OSB → kalkulačka OSB); jen ověřené adresy z config.app.json */
  function calcFor(q) {
    var t = ' ' + String(q || '').toLowerCase() + ' ';
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    var hit = (A.calculators || []).filter(function (c) { return (c.k || []).some(function (k) { return t.indexOf(k) > -1; }); })[0];
    return hit ? h('p', { class: 'pmj-small' }, [(T('calc_hint') || 'Nevíte, kolik toho potřebujete?') + ' ',
      h('a', { href: hit.u, text: hit.t, onclick: function () { track('jarda_calc_click', { calc: hit.id || hit.u, from: 'search' }); } })]) : null;
  }

  function doSearch(q, onZero, after, req) {
    var wait = say([p(T('loading'))], 'pmj-bot pmj-wait'), label = label0(q, req), k = 'results:' + label.toLowerCase(), title = '„' + short(label, 26) + '“';
    lastQuery = label; st('sessionStorage', 'lastq', label);
    function edit() { return btn('Upravit hledání', function () { you('Upravit hledání'); editQuery(); }); }
    getIndex().then(function (idx) {
      remove(wait);
      var r = search(idx, q, { limit: 5, replace: C.search_replace, synonyms: SYN });
      track('jarda_search', { search_term: q, results_count: r.total, page_type: SD.pageType || '', has_qty: !!(req && req.q) });
      if (!r.total) {
        track('jarda_search_no_results', { search_term: q, missing_term: r.missing.join(' ') });
        if (onZero) { onZero(); return; }
        screen(k, 'Hledání ' + title, function () {
          var kids = [p(r.missing.length && r.partial ? T('results_partial', { q: q, w: r.partial.without }) : T('no_results')), p(T('no_results_quote'), 'pmj-small')];
          var acts = [btn('Přidat „' + label + '“ k nacenění', function () { addFree(q, req); }, 'pmj-btn-primary')];
          if (r.partial) acts.unshift(btn(T('partial_btn', { q: r.partial.query, n: r.partial.total }), function () {
            track('jarda_chip_click', { chip: 'partial' });
            screen('partial:' + label.toLowerCase(), 'Výsledky bez „' + r.partial.without + '“', function () {
              return say([p(T('partial_note', { w: r.partial.without }), 'pmj-note'), cards(r.partial.results, q, 'partial', req)], 'pmj-bot', 'partial:' + label.toLowerCase());
            });
          }));
          acts.push(edit());
          acts.push(btn('Poslat fotku nebo seznam', function () { showQuote('no_results'); }));
          kids.push(actions(acts));
          return say(kids, 'pmj-bot', k);
        });
        if (after) after();
        return;
      }
      screen(k, 'Výsledky ' + title, function () {
        var kids2 = [p(req && req.q ? (T('results_qty') || 'Pro {qty} jsem v katalogu našel:').replace('{qty}', qtyLabel(req.q, req.unit)) : T('results')), cards(r.results, q, 'search', req)];
        if (r.total > r.results.length) kids2.push(h('p', { class: 'pmj-small' }, [T('results_more', { n: r.total }) + ' ',
          h('a', { href: '/vyhledavani/?string=' + encodeURIComponent(q), text: 'Zobrazit všech ' + r.total + ' v e-shopu' })]));
        kids2.push(p(T('price_note'), 'pmj-small'));
        kids2.push(calcFor(q));
        kids2.push(h('p', { class: 'pmj-small' }, [T('not_listed') + ' ', h('button', { type: 'button', class: 'pmj-linkbtn', text: 'Přidat „' + label + '“', onclick: function () { addFree(q, req); } })]));
        kids2.push(actions([edit()]));
        return say(kids2, 'pmj-bot', k);
      });
      if (after) after();
    }, function () {
      remove(wait);
      track('jarda_search', { search_term: q, results_count: -1, index_error: true });
      screen(k, 'Hledání ' + title, function () {
        return say([p(T('index_error')), actions([btn('Přidat „' + label + '“ k nacenění', function () { addFree(q, req); }, 'pmj-btn-primary'), waButton(null, 'index_error'), edit()])], 'pmj-bot', k);
      });
    });
  }
  function label0(q, req) { return req && req.q ? qtyLabel(req.q, req.unit) + ' ' + q : q; }

  /* ---------- vložený seznam materiálu ---------- */
  var importText = ''; // rozepsaný vložený seznam (jen v paměti) – Zpět ani Upravit seznam ho nesmažou
  function importForm(prefill) {
    if (typeof prefill === 'string') importText = prefill;
    var ta;
    screen('import', 'Vložit seznam', function () {
      ta = h('textarea', { rows: '6', class: 'pmj-input', placeholder: 'Každá položka na nový řádek, např.\n200 ks vrut 5x60\nkabel CYKY 3x2,5 50 m\n12× OSB 18', 'aria-label': 'Seznam materiálu' });
      ta.value = importText;
      ta.addEventListener('input', function () { importText = ta.value; });
      var go = btn('Najít v katalogu', function () { var v = ta.value.trim(); if (!v) { ta.focus(); return; } importList(v); }, 'pmj-btn-primary');
      return say([p(T('import_intro') || 'Vložte seznam (i z Excelu nebo e-mailu). Ke každé položce najdu produkt v katalogu a upozorním, co je potřeba upřesnit.'), ta, actions([go])], 'pmj-bot', 'import');
    });
    ta.focus();
  }
  /* řádek vloženého seznamu jako text k nacenění: bez množství v názvu, počet zvlášť (neuvedený zůstane neuvedený) */
  function lineItem(l) { return l.q ? { n: l.query || l.raw, f: 1, q: l.q, un: l.unit || '' } : { n: l.raw, f: 1, q: 0 }; }
  function importList(text) {
    importText = text;
    var lines = parseLines(text, (A.import && A.import.max_lines) || 50);
    if (!lines.length) { say([p('V textu jsem nenašel žádnou položku. Napište název materiálu, každý na nový řádek.')]); return; }
    var wait = say([p('Hledám ' + lines.length + ' položek v katalogu…')], 'pmj-bot pmj-wait');
    getIndex().then(function (idx) {
      remove(wait);
      var st0 = { ok: 0, check: 0, none: 0, qty: 0 }, done = false;
      var rows = lines.map(function (l) {
        var r = search(idx, l.query, { limit: 3, replace: C.search_replace, synonyms: SYN }), top = r.results[0];
        var spec = /\d/.test(l.query) || (top && sameCode(l.query.trim(), top.c));
        var status = !r.total ? 'none' : (r.total > 3 && !spec ? 'check' : 'ok');
        st0[status]++; if (!l.q) st0.qty++;
        return { l: l, top: top, total: r.total, status: status, on: status === 'ok' && !!top };
      });
      track('jarda_list_import', { lines: lines.length, matched: st0.ok, ambiguous: st0.check, unmatched: st0.none, missing_qty: st0.qty });
      screen('imported', 'Kontrola seznamu', function () {
      var ul = h('ul', { class: 'pmj-rows pmj-imp' }, rows.map(function (r, i) {
        var warn = [];
        if (!r.l.q) warn.push('chybí počet');
        if (r.status === 'check') warn.push('upřesněte rozměr nebo typ');
        if (r.status === 'none') warn.push('v katalogu nevidím – naceníme podle popisu');
        // nejasná položka (např. jen „hmoždinka“): žádný náhodný návrh, jen odkaz na výběr v katalogu
        var cbx = r.top && r.status === 'ok' ? h('input', { type: 'checkbox', class: 'pmj-cbx', 'aria-label': 'Použít navržený produkt pro: ' + r.l.raw }) : null;
        if (cbx) { cbx.checked = r.on; cbx.disabled = done; cbx.addEventListener('change', function () { r.on = cbx.checked; }); }
        return h('li', { class: 'pmj-imp-row pmj-imp-' + r.status }, [
          h('span', { class: 'pmj-imp-q', text: r.l.q ? qtyLabel(r.l.q, r.l.unit) : '?' }),
          h('div', { class: 'pmj-imp-body' }, [
            h('span', { class: 'pmj-imp-raw', text: r.l.query }),
            cbx ? h('label', { class: 'pmj-imp-match' }, [cbx, ' ', h('span', {}, [h('span', { class: 'pmj-tag', text: 'Návrh' }), ' ', h('a', { href: r.top.u, text: r.top.n, target: '_blank', rel: 'noopener' }),
              r.top.p != null ? ' · ' + (r.top.v ? 'od ' : '') + kc(r.top.p) + (unitLabel(r.top.un, r.top.pk) ? ' ' + unitLabel(r.top.un, r.top.pk) : '') : ''])]) : null,
            r.status === 'check' ? h('a', { class: 'pmj-imp-match', href: '/vyhledavani/?string=' + encodeURIComponent(r.l.query), target: '_blank', rel: 'noopener', text: 'Vybrat v katalogu (' + r.total + ')' }) : null,
            warn.length ? h('span', { class: 'pmj-imp-warn', text: warn.join(' · ') }) : null
          ])
        ]);
      }));
      var addAll = btn(done ? '✓ Přidáno' : 'Přidat vše k nacenění (' + rows.length + ')', function () {
        if (done) return; // jednou – ani po Zpět se seznam nepřidá podruhé
        done = true;
        var items = rows.map(function (r) {
          if (r.on && r.top) return { n: r.top.n, c: r.top.c, u: r.top.u, q: r.l.q || 0, un: r.l.unit };
          return lineItem(r.l);
        });
        addItems(items, 'import');
        track('jarda_chip_click', { chip: 'import_add' });
        addAll.disabled = true; addAll.textContent = '✓ Přidáno';
        showQuote('import');
      }, 'pmj-btn-primary', { disabled: done });
      var kids = [p('Výsledek: ' + st0.ok + ' nalezeno, ' + st0.check + ' k upřesnění, ' + st0.none + ' mimo katalog' + (st0.qty ? ', u ' + st0.qty + ' chybí počet' : '') + '.', 'pmj-title'),
        p(T('import_note') || 'Zaškrtnuté položky přidám jako konkrétní produkt, ostatní jako text k nacenění. Cenu, balení a dostupnost potvrdí obchodník.', 'pmj-small'), ul,
        actions([addAll, done ? null : btn('Upravit seznam', function () { you('Upravit seznam'); importForm(text); })])];
      if (rows.length >= ((A.import && A.import.b2b_lines) || 8)) kids.splice(1, 0, p(T('import_b2b') || 'Větší seznam vám obchodník nacení i s dopravou na stavbu.', 'pmj-note'));
      return say(kids, 'pmj-bot', 'imported');
      });
    }, function () {
      remove(wait);
      var sent = false;
      say([p(T('index_error')), actions([btn('Poslat seznam k nacenění', function () { if (!sent) { sent = true; addItems(lines.map(lineItem), 'import'); } showQuote('import'); }, 'pmj-btn-primary')])]);
    });
  }

  /* ---------- kontextové akce ---------- */
  function productBulk() {
    var pr = currentProduct();
    if (!pr) { find(); return; }
    addItem(pr, 'product');
    var m = { n: pr.n, u: pr.u, un: '' };
    say([p(T('product_bulk')), h('div', { class: 'pmj-row pmj-added' }, [h('span', { class: 'pmj-row-name', text: pr.n }), qtyBox(m)]), p('Počet můžete upravit tady nebo v seznamu.', 'pmj-small'),
      actions([btn('Nacenit seznam', function () { showQuote('product'); }, 'pmj-btn-primary'), btn('Přidat další materiál', find), btn('Zobrazit seznam', showList)])], 'pmj-bot', 'added');
  }
  function showSet() {
    var codes = setCodes(), wait = say([p(T('loading'))], 'pmj-bot pmj-wait');
    getIndex().then(function (idx) {
      remove(wait);
      var found = [];
      codes.forEach(function (c) { var k = c.toLowerCase().replace(/[\s_\-./]/g, ''); for (var i = 0; i < idx.length; i++) if (idx[i].ck.indexOf(k) > -1) { found.push(idx[i]); break; } });
      screen('set', 'Obsah sady', function () { return say(found.length ? [p(T('set_title')), cards(found, '', 'set'), p(T('price_note'), 'pmj-small')] : [p(T('set_none'))], 'pmj-bot', 'set'); });
    }, function () { remove(wait); say([p(T('index_error'))]); });
  }
  function cartToQuote() {
    var ci = cartInfo();
    if (!ci) { showQuote('cart'); return; }
    var l = getList();
    ci.items.forEach(function (x) {
      if (!x || !x.name) return;
      if (!l.some(function (y) { return y.n === x.name && (y.c || '') === (x.code || ''); })) l.push({ n: x.name, c: x.code || '', u: '', q: Math.max(1, Math.round(+x.quantity || 1)), f: 0 });
    });
    setList(l);
    track('jarda_add_to_list', { item_source: 'cart', list_count: l.length });
    showQuote('cart');
  }

  /* ---------- seznam ---------- */
  /* Seznam: počet (prázdný = neuveden), jednotka, odebrání s možností vrátit. Produkt z katalogu je odlišený od textu k upřesnění. */
  var undo = null;
  function showList() {
    return screen('list', 'Seznam', function (rp) {
      var box = h('div', { class: 'pmj-list' });
      if (!rp) track('jarda_list_view', { list_count: getList().length });
      undo = null;
      function render() {
      var l = getList(), miss = noQty(l);
      box.textContent = '';
      box.appendChild(p(T('list_title') + (l.length ? ' (' + l.length + ')' : ''), 'pmj-title'));
      if (undo) box.appendChild(h('p', { class: 'pmj-small' }, ['Odebráno: ' + short(undo.x.n, 40) + ' · ', h('button', { type: 'button', class: 'pmj-linkbtn', text: 'Vrátit', onclick: function () {
        var cur = getList(); cur.splice(Math.min(undo.i, cur.length), 0, undo.x); undo = null; setList(cur); render(); } })]));
      if (!l.length) { box.appendChild(p(T('list_empty'))); box.appendChild(actions([btn('Najít materiál', find), btn('Poslat fotku nebo seznam', function () { showQuote('list'); }, 'pmj-btn-primary')])); return; }
      box.appendChild(h('ul', { class: 'pmj-rows' }, l.map(function (x, i) {
        var del = h('button', { type: 'button', class: 'pmj-del', 'aria-label': 'Odebrat: ' + x.n, text: '×' });
        del.addEventListener('click', function () {
          var cur = getList(), j = -1; cur.forEach(function (y, k) { if (j < 0 && sameItem(y, x)) j = k; });
          if (j < 0) return;
          undo = { x: cur.splice(j, 1)[0], i: j }; setList(cur); render();
          var f = box.querySelector('.pmj-linkbtn, .pmj-qty, .pmj-btn'); if (f) f.focus();
        });
        return h('li', { class: 'pmj-row' + (x.q ? '' : ' pmj-row-noq') }, [
          h('div', { class: 'pmj-row-name' }, [x.u ? h('a', { href: x.u, text: x.n }) : h('span', { text: x.n }),
            h('span', { class: 'pmj-tag' + (x.f || !x.u ? ' pmj-tag-q' : ''), text: x.f || !x.u ? 'k upřesnění' : 'produkt' + (x.c ? ' ' + x.c : '') })]),
          qtyBox(x), x.un ? h('span', { class: 'pmj-un', text: x.un }) : null, del]);
      })));
      box.appendChild(p(l.length + (l.length === 1 ? ' položka' : l.length < 5 ? ' položky' : ' položek') + (miss ? ' · u ' + miss + ' chybí počet (prázdné pole) – doplňte ho, nebo ho upřesní obchodník.' : '.'), miss ? 'pmj-small pmj-warn' : 'pmj-small'));
      box.appendChild(actions([btn('Nacenit seznam', function () { you('Nacenit seznam'); showQuote('list'); }, 'pmj-btn-primary'), btn('Najít další', function () { you('Najít další'); find(); }), btn('Vložit další položky', function () { you('Vložit další položky'); importForm(''); })]));
      var cp = h('button', { type: 'button', class: 'pmj-linkbtn', text: 'Kopírovat', onclick: function () { copyText(listText(getList())).then(function (ok) { cp.textContent = ok ? '✓ Zkopírováno' : 'Kopírování nejde'; }); track('jarda_list_export', { format: 'copy', list_count: getList().length }); } });
      box.appendChild(h('p', { class: 'pmj-small' }, ['Seznam si můžete uložit: ', h('button', { type: 'button', class: 'pmj-linkbtn', text: 'Stáhnout pro Excel (CSV)', onclick: exportCsv }), ' · ', cp]));
      }
      render();
      return say([box], 'pmj-bot', 'list');
    });
  }

  /* CSV pro Excel (středník, UTF-8 s BOM) – jen položky seznamu, žádné kontaktní údaje */
  function exportCsv() {
    var l = getList(), esc = function (v) { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = [['Množství', 'Jednotka', 'Název', 'Kód', 'Odkaz']].concat(l.map(function (x) { return [x.q ? String(x.q).replace('.', ',') : '', x.un || '', (x.f ? 'Dotaz: ' : '') + x.n, x.c || '', x.u || '']; }));
    var csv = '\ufeff' + rows.map(function (r) { return r.map(esc).join(';'); }).join('\r\n');
    try {
      var a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'promontaz-seznam-materialu.csv' });
      document.body.appendChild(a); a.click(); remove(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    } catch (e) {}
    track('jarda_list_export', { format: 'csv', list_count: l.length });
  }

  /* ---------- poptávka ---------- */
  var IMG = { pdf: [[0x25, 0x50, 0x44, 0x46]], png: [[0x89, 0x50, 0x4e, 0x47]], jpg: [[0xff, 0xd8, 0xff]], jpeg: [[0xff, 0xd8, 0xff]], xlsx: [[0x50, 0x4b, 0x03, 0x04]] };
  function ext(n) { var m = /\.([a-z0-9]{1,5})$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
  function sniff(f) {
    return new Promise(function (res) {
      if (!f.slice || !window.FileReader) return res(true);
      var r = new FileReader();
      r.onload = function () {
        var b = new Uint8Array(r.result), e = ext(f.name);
        if (e === 'csv') { for (var i = 0; i < b.length; i++) if (b[i] === 0) return res(false); return res(true); }
        if (e === 'pdf') { for (var j = 0; j + 4 < b.length; j++) if (b[j] === 0x25 && b[j + 1] === 0x50 && b[j + 2] === 0x44 && b[j + 3] === 0x46) return res(true); return res(false); }
        res((IMG[e] || []).some(function (sig) { return sig.every(function (v, k) { return b[k] === v; }); }));
      };
      r.onerror = function () { res(true); };
      r.readAsArrayBuffer(f.slice(0, 1024));
    });
  }
  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' kB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  function icoOk(v) { if (!/^\d{8}$/.test(v)) return false; for (var s = 0, i = 0; i < 7; i++) s += +v[i] * (8 - i); return (11 - s % 11) % 10 === +v[7]; }
  function ajaxUrl(u) { return String(u || '').replace(/^(https:\/\/formsubmit\.co\/)(?!ajax\/)/, '$1ajax/'); }
  function leadId() {
    var a = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789', s = '', d = new Date(), r = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(r);
    for (var i = 0; i < 6; i++) s += a[r[i] % a.length];
    return 'PM-' + String(d.getFullYear()).slice(2) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-J' + s;
  }
  function nextUrl(id) { var u = new URL(location.href); u.searchParams.set('pmj_sent', id); u.hash = ''; return u.href; }

  /* Stav poptávky (3.2) – jeden objekt pro celou stránku, nezávislý na vykresleném formuláři:
     files    vybrané přílohy (jen v paměti; mezi obrazovkami Jardy zůstávají, po přijetí se mažou),
     submitting zámek odeslání (platí i pro znovu vykreslený formulář), send aktuální tlačítko,
     submit   odeslání z aktuálního formuláře (záložní „Zkusit přesto“ nepoužije starý formulář), force bez kontroly služby.
     Texty a kontakt jsou v sessionStorage (draft) – ukládají se hned při psaní, takže je nesmaže žádný přechod.
     Životní cyklus: prázdná → rozepsaná → (kontrola) → odesílá se [zámek] → přijatá (vše smazáno)
                     | nepřijatá / bez odpovědi / výpadek (zámek uvolněn, vše zůstává). */
  var Q = { files: [], submitting: false, send: null, submit: null, force: false, started: false, restored: false, source: '' };
  function draftGet() { return stJSON('sessionStorage', 'draft', {}) || {}; }
  function draftText(d, list) { return d.t != null ? d.t : (list.length ? d.extra || '' : d.text || ''); } // d.text/extra = koncept z 3.1
  function draftHas(d) { return !!(d && (draftText(d, getList()) || d.email || d.tel || d.note || (d.fn && d.fn.length))); }
  /* Odeslání skrytého formuláře mimo dosah automatického sledování formulářů gtag (form_start/form_submit do GA4 a Ads):
     gtag přepisuje HTMLFormElement.prototype.submit na stránce. Formulář zůstává na stránce (FormSubmit vyžaduje
     odeslání ze skutečné adresy webu), jen se odešle nepřepsanou nativní funkcí z prázdného iframe. Ověřeno živě 19. 11. 2026. */
  var nativeSubmit = null;
  function submitIsolated(F) {
    document.body.appendChild(F);
    try {
      if (!nativeSubmit) {
        var fr = h('iframe', { src: 'about:blank', title: '', 'aria-hidden': 'true', tabindex: '-1', style: 'position:absolute;width:0;height:0;border:0;visibility:hidden' });
        document.body.appendChild(fr);
        nativeSubmit = fr.contentWindow.HTMLFormElement.prototype.submit;
      }
      nativeSubmit.call(F);
    } catch (e) { HTMLFormElement.prototype.submit.call(F); }
  }
  function field(label, control, hint, opt) {
    return h('label', { class: 'pmj-field' }, [h('span', { class: 'pmj-label' }, [label, opt ? h('span', { class: 'pmj-opt', text: ' (nepovinné)' }) : null]), control, hint ? h('span', { class: 'pmj-hint', text: hint }) : null]);
  }
  function showQuote(source) {
    var list0 = getList();
    if (!Q.started) { Q.started = true; track('jarda_quote_start', { list_count: list0.length, quote_source: source || '' }); } // jednou za stránku
    if (source) Q.source = source;
    return screen('quote', 'Poptávka', quoteForm);
  }
  function itemLine(x) { return (x.q ? qtyLabel(x.q, x.un) + ' ' : '') + x.n + (x.c ? ' (' + x.c + ')' : ''); }
  function quoteForm(rp) {
    var source = Q.source;
    var Qc = A.quote || {}, maxFiles = Qc.max_files || 10, maxTotal = (Qc.max_total_mb || 10) * 1048576;
    var formats = Qc.formats || ['pdf', 'xlsx', 'csv', 'jpg', 'jpeg', 'png'];
    var draft = draftGet();
    var list = getList(), miss = noQty(list);
    var ta = h('textarea', { rows: list.length ? '2' : '5', class: 'pmj-input', placeholder: list.length ? 'Např. další materiál, který v katalogu není' : 'Např. 20× vrut 5x60, 3× OSB 18 mm…', 'aria-describedby': 'pmj-err' });
    ta.value = draftText(draft, list);
    /* kontrola před odesláním přímo ve formuláři (bez dalšího kroku): co přesně se nacení */
    var sum = list.length ? h('div', { class: 'pmj-qsum' }, [
      h('p', { class: 'pmj-label', text: 'Seznam k nacenění (' + list.length + ')' }),
      h('ul', { class: 'pmj-ul' }, list.slice(0, 25).map(function (x) { return h('li', { class: x.q ? null : 'pmj-warn', text: itemLine(x) + (x.q ? '' : ' – počet neuveden') }); })),
      list.length > 25 ? p('… a dalších ' + (list.length - 25) + '.', 'pmj-small') : null,
      miss ? p('U ' + miss + ' ' + (miss === 1 ? 'položky' : 'položek') + ' chybí počet. Doplňte ho v seznamu, nebo ho s vámi upřesní obchodník.', 'pmj-small pmj-warn') : null,
      actions([btn('Upravit seznam', function () { you('Upravit seznam'); showList(); })])]) : null;
    var fin = h('input', { type: 'file', multiple: true, class: 'pmj-file', accept: formats.map(function (f) { return '.' + f; }).join(',') });
    var flist = h('ul', { class: 'pmj-files', 'aria-live': 'polite' });
    var email = h('input', { type: 'email', class: 'pmj-input', autocomplete: 'email', inputmode: 'email', maxlength: '160' });
    var tel = h('input', { type: 'tel', class: 'pmj-input', autocomplete: 'tel', inputmode: 'tel', maxlength: '30' });
    var zip = h('input', { type: 'text', class: 'pmj-input', autocomplete: 'postal-code', inputmode: 'numeric', maxlength: '6' });
    var ico = h('input', { type: 'text', class: 'pmj-input', inputmode: 'numeric', maxlength: '10', autocomplete: 'off' });
    var dl = Qc.deadlines || { '': 'Neuvedeno', asap: 'Co nejdříve' };
    var term = h('select', { class: 'pmj-input' }, Object.keys(dl).map(function (k) { return h('option', { value: k, text: dl[k] }); }));
    var note = h('textarea', { rows: '2', class: 'pmj-input', placeholder: 'Např. firma, způsob dodání, poznámka k materiálu' });
    var hp = h('input', { type: 'text', tabindex: '-1', autocomplete: 'off' });
    var err = h('p', { class: 'pmj-err', role: 'alert', id: 'pmj-err' });
    var send = h('button', { type: 'button', class: 'pmj-btn pmj-btn-primary pmj-send', text: Q.submitting ? 'Odesílám…' : 'Odeslat k nacenění', disabled: Q.submitting });
    Q.send = send;
    [['email', email], ['tel', tel], ['zip', zip], ['ico', ico], ['term', term], ['note', note]].forEach(function (x) { if (draft[x[0]]) x[1].value = draft[x[0]]; });
    var more = h('details', { class: 'pmj-more' }, [h('summary', { text: 'Firma, termín, poznámka' }),
      field('IČO', ico, 'Vyplňte, pokud chcete nabídku na firmu.', 1), field('Požadovaný termín', term, null, 1), field('Poznámka', note, null, 1)]);
    if (draft.ico || draft.term || draft.note) more.open = true;
    /* Záměrně <div role=form>, ne <form>: automatické sledování formulářů v gtag by jinak posílalo form_start/form_submit
       z Jardy do GA4 i Google Ads. Do FormSubmitu se odesílá samostatný skrytý <form> přes .submit() (bez události submit). */
    var form = h('div', { class: 'pmj-form', role: 'form', 'aria-label': T('quote_title') || 'Poptávka k nacenění' }, [
      h('p', { class: 'pmj-title', text: T('quote_title') }), p(T('quote_short'), 'pmj-small'),
      sum,
      list.length ? field('Další materiál nebo poznámka k seznamu', ta, null, 1) : field('Seznam materiálu', ta, 'Název nebo kód a množství.'),
      field('Přílohy', fin, 'Fotka, PDF, Excel (XLSX) nebo CSV. Nejvýše ' + maxFiles + ' souborů, dohromady ' + (Qc.max_total_mb || 10) + ' MB.', 1), flist,
      h('div', { class: 'pmj-grid' }, [field('E-mail', email), field('Telefon', tel)]),
      p('Vyplňte e-mail nebo telefon, ať se vám můžeme ozvat.', 'pmj-hint'),
      field('PSČ místa dodání', zip, 'Pomůže nám spočítat dopravu.', 1),
      more,
      h('div', { class: 'pmj-hp', 'aria-hidden': 'true' }, [h('label', {}, ['Nevyplňujte ', hp])]),
      err, send,
      h('p', { class: 'pmj-small' }, ['Údaje použijeme jen pro zpracování poptávky. Poptávku doručuje služba FormSubmit, která může krátce ověřit, že nejste robot. ',
        h('a', { href: L.privacy || '/podminky-ochrany-osobnich-udaju/', text: 'Ochrana osobních údajů' })])
    ]);
    var files = Q.files; // stejné pole po celou dobu – přílohy přežijí Zpět, Seznam i nové otevření poptávky
    var lost = !files.length && draft.fn && draft.fn.length ? draft.fn : null;
    function renderFiles() {
      flist.textContent = '';
      files.forEach(function (f, i) {
        flist.appendChild(h('li', {}, [h('span', { text: f.name + ' (' + mb(f.size) + ')' }),
          h('button', { type: 'button', class: 'pmj-del', 'aria-label': 'Odebrat soubor ' + f.name, text: '×', onclick: function () { files.splice(i, 1); renderFiles(); saveDraft(); } })]));
      });
      if (lost) flist.appendChild(h('li', { class: 'pmj-warn', text: 'Přílohy z předchozí stránky (' + lost.join(', ') + ') prosím vyberte znovu – prohlížeč je mezi stránkami neuchová.' }));
    }
    renderFiles();
    fin.addEventListener('change', function () {
      var picked = Array.prototype.slice.call(fin.files || []), msgs = [];
      Promise.all(picked.map(function (f) {
        var e = ext(f.name);
        if (formats.indexOf(e) < 0) { msgs.push('„' + f.name + '“: povolené jsou ' + formats.filter(function (x) { return x !== 'jpeg'; }).join(', ').toUpperCase() + '.' + (e === 'zip' ? ' ZIP nepřijímáme, pošlete soubory jednotlivě nebo odkazem v poznámce.' : '')); return null; }
        if (!f.size) { msgs.push('„' + f.name + '“ je prázdný.'); return null; }
        return sniff(f).then(function (ok) { if (!ok) msgs.push('„' + f.name + '“ neodpovídá svému formátu.'); return ok ? f : null; });
      })).then(function (ok) {
        ok.forEach(function (f) {
          if (!f || files.some(function (x) { return x.name === f.name && x.size === f.size; })) return;
          if (files.length >= maxFiles) { msgs.push('Nejvýše ' + maxFiles + ' souborů.'); return; }
          var tot = files.reduce(function (a, x) { return a + x.size; }, 0);
          if (tot + f.size > maxTotal) { msgs.push('„' + f.name + '“ se už nevejde – dohromady nejvýše ' + (Qc.max_total_mb || 10) + ' MB. Větší podklady pošlete odkazem v poznámce.'); return; }
          files.push(f);
        });
        fin.value = '';
        lost = null;
        renderFiles();
        saveDraft();
        err.textContent = msgs.join(' ');
      });
    });
    /* rozepsaná poptávka se ukládá hned (bez zpoždění – rychlý přechod nic neztratí) jen do sessionStorage této karty
       a maže se po přijetí. text/extra = tvar konceptu z 3.1 (návrat na předchozí verzi nic neztratí). */
    function saveDraft() {
      var listNow = listText(getList()), t = ta.value;
      st('sessionStorage', 'draft', JSON.stringify({ t: t, text: listNow ? listNow + (t.trim() ? '\n' + t : '') : t, extra: t,
        email: email.value, tel: tel.value, zip: zip.value, ico: ico.value, term: term.value, note: note.value, fn: lost || files.map(function (f) { return f.name; }) }));
    }
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);

    send.addEventListener('click', doSubmit);
    form.addEventListener('keydown', function (e) { var t = e.target; if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'file') { e.preventDefault(); doSubmit(); } });
    function doSubmit() {
      if (Q.submitting) return;
      var listNow = getList(), material = [listText(listNow), ta.value.trim()].filter(Boolean).join('\n');
      var em = email.value.trim(), ph = tel.value.trim(), z = zip.value.replace(/\s/g, ''), ic = ico.value.replace(/\s/g, ''), bad = null, msg = '';
      if (!material && !files.length) { msg = 'Napište, co nacenit, nebo přiložte fotku či seznam.'; bad = ta; }
      else if (!em && !ph) { msg = 'Vyplňte e-mail nebo telefon.'; bad = email; }
      else if (em && !/^[^\s@]{1,64}@[^\s@]{1,100}\.[a-z]{2,24}$/i.test(em)) { msg = 'Zkontrolujte e-mail (např. jmeno@firma.cz).'; bad = email; }
      else if (ph && (ph.replace(/\D/g, '').length < 9 || !/^\+?[0-9 ()-]+$/.test(ph))) { msg = 'Zkontrolujte telefon (alespoň 9 číslic).'; bad = tel; }
      else if (z && !/^\d{5}$/.test(z)) { msg = 'PSČ má 5 číslic, nebo pole nechte prázdné.'; bad = zip; }
      else if (ic && !icoOk(ic)) { msg = 'Zkontrolujte IČO (8 číslic), nebo pole nechte prázdné.'; bad = ico; more.open = true; }
      else if (files.length && typeof window.DataTransfer !== 'function') { msg = 'Tento prohlížeč neumí odeslat přílohy formulářem. Odešlete poptávku bez nich a soubory pošlete na ' + contact().email + '.'; bad = fin; }
      else if (!C.formsubmit_endpoint) msg = 'Formulář se teď nepodařilo připravit. Napište nám prosím na WhatsApp.';
      else if (navigator.onLine === false) msg = T('offline');
      err.textContent = msg;
      [ta, email, tel, zip, ico, fin].forEach(function (x) { if (x === bad) x.setAttribute('aria-invalid', 'true'); else x.removeAttribute('aria-invalid'); });
      if (msg) { if (bad) bad.focus(); return; }

      /* Odesílá se skrytý formulář; viditelný zůstává beze změny (návrat tlačítkem Zpět nic neztratí). */
      var id = leadId(), n = listNow.length, F = h('form', { method: 'post', action: C.formsubmit_endpoint, enctype: 'multipart/form-data', 'accept-charset': 'UTF-8', hidden: true });
      function hid(name, val) { F.appendChild(h('input', { type: 'hidden', name: name, value: val })); }
      hid('_subject', (X.test ? 'TEST – ' : '') + 'Poptávka ' + id + ' – widget Jarda' + (z ? ' – PSČ ' + z : '') + (files.length ? ' – ' + files.length + ' příl.' : ''));
      hid('_template', 'table'); hid('_next', nextUrl(id)); hid('_honey', hp.value);
      if (em) { hid('email', em); hid('_replyto', em); }
      hid('Číslo poptávky', id); hid('Zdroj', 'Widget Jarda ' + C.__version); hid('Stránka', location.href);
      hid('Seznam materiálu', material || '—'); hid('Počet položek ze seznamu', String(n));
      hid('Telefon', ph || '—'); hid('PSČ dodání', z || '—'); hid('IČO', ic || '—');
      hid('Požadovaný termín', dl[term.value] || '—'); hid('Poznámka', note.value.trim() || '—');
      hid('Přílohy', files.length ? files.map(function (f) { return f.name + ' (' + mb(f.size) + ')'; }).join(', ') : 'žádné');
      var okFiles = 0;
      files.forEach(function (f, i) {
        var fi = h('input', { type: 'file', name: i ? 'attachment' + (i + 1) : 'attachment' });
        try { var dt = new DataTransfer(); dt.items.add(f); fi.files = dt.files; } catch (x) {}
        if (fi.files && fi.files.length === 1) okFiles++;
        F.appendChild(fi);
      });
      if (okFiles !== files.length) { err.textContent = 'Přílohy se nepodařilo připojit. Zkuste jiný prohlížeč, nebo je pošlete na ' + contact().email + '.'; return; }
      saveDraft();
      Q.submitting = true; send.disabled = true; send.textContent = 'Odesílám…';
      /* Odeslání na AJAX endpoint FormSubmitu (formsubmit.co/ajax/…): odpověď {"success":"true"} je jediné potvrzení
         přijetí. Zákazník zůstává na promontaz.cz (bez reCAPTCHA stránky a bez závislosti na přesměrování _next). */
      var go = function () {
        st('sessionStorage', 'pending', JSON.stringify({ id: id, t: Date.now(), n: n, f: files.length }));
        track('jarda_quote_submit', { lead_id: id, items_count: n, attachments_count: files.length, has_zip: !!z, has_ico: !!ic, quote_source: source || '' });
        submitAt = Date.now();
        send.textContent = files.length ? 'Odesílám poptávku a přílohy…' : 'Odesílám…';
        if (C.dry_run) { location.href = nextUrl(id); return; }
        if (files.length) {
          /* S přílohami: klasický multipart POST. AJAX endpoint FormSubmitu soubory nedoručuje (ověřeno ve schránce),
             _captcha=false → FormSubmit odpoví 302 přímo na _next (?pmj_sent=ID) → české potvrzení na webu. */
          hid('_captcha', 'false');
          noLinks(F); // bez odkazů v polích, jinak FormSubmit nepřesměruje zpět (viz fallback.js)
          setTimeout(function () { unlock(false); }, 15000); // stránka se neopustila (síť) → znovu povolit
          F.__pmjOk = 1; // ochrana formulářů (guard) už nekontroluje znovu
          submitIsolated(F);
          return;
        }
        // Bez příloh: AJAX (okamžitá odpověď služby, zákazník zůstává na stránce)
        var fd = new FormData(F), ctl = window.AbortController ? new AbortController() : null;
        var tmo = setTimeout(function () { if (ctl) ctl.abort(); }, (A.quote && A.quote.send_timeout_ms) || 90000);
        var ft = formText(F), names = files.map(function (f) { return f.name; });
        fetch(ajaxUrl(C.formsubmit_endpoint), { method: 'POST', body: fd, headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctl ? ctl.signal : undefined })
          .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            clearTimeout(tmo);
            if (res.ok && res.j && (res.j.success === true || res.j.success === 'true')) { accepted(id, n, files.length); return; }
            // služba odpověděla, ale poptávku NEpřijala (např. aktivace, spam) → nic nepotvrzovat, údaje zůstávají
            st('sessionStorage', 'pending', null); unlock(false);
            fallbackBlock(id, ft.text, names, 'service_rejected', null, res.j && res.j.message);
          }, function () {
            clearTimeout(tmo); unlock(false);
            // bez odpovědi (síť, časový limit): nevíme, zda dorazila → neposílat automaticky znovu, nabídnout e-mail
            fallbackBlock(id, ft.text, names, 'no_response', null, null, true);
          });
      };
      if (Q.force || C.dry_run) { Q.force = false; go(); return; }
      /* Výpadek FormSubmitu (522) se pozná dřív, než zákazník opustí stránku → záložní e-mail místo chybové stránky */
      probe(C.formsubmit_endpoint, (A.quote && A.quote.probe_timeout_ms) || 6000).then(function (ok) {
        if (ok) return go();
        Q.submitting = false; if (Q.send) { Q.send.disabled = false; Q.send.textContent = 'Odeslat k nacenění'; }
        var ft = formText(F);
        fallbackBlock(id, ft.text, files.map(function (f) { return f.name; }), 'service_down', function () { Q.force = true; if (Q.submit) Q.submit(); });
      });
    }
    Q.submit = doSubmit;
    if (!Q.restored && draftHas(draft)) { Q.restored = true; form.insertBefore(p(T('draft_restored'), 'pmj-small'), form.children[2]); }
    var m = say([form], 'pmj-bot', 'quote');
    if (!rp) (list.length ? (email.value || tel.value ? send : email) : ta).focus();
    return m;
  }
  /* návrat tlačítkem Zpět (bfcache, hlavně iOS Safari): odblokovat odeslání */
  /* Návrat ze stránky odesílací služby tlačítkem Zpět (bfcache, iOS Safari i při chybě služby, např. 522):
     odblokovat tlačítko a hned ukázat, že se poptávka možná neodeslala (seznam zůstává). */
  var submitAt = 0, LOADED = Date.now();
  function unlock(note) {
    if (!Q.submitting) return;
    Q.submitting = false;
    if (Q.send) { Q.send.disabled = false; Q.send.textContent = 'Odeslat k nacenění'; }
    if (note) checkUnconfirmed(true);
  }
  window.addEventListener('pageshow', function (e) { if (e.persisted) unlock(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && submitAt && Date.now() - submitAt > 2000) unlock(true); });

  /* Návrat z FormSubmitu na ?pmj_sent=ID = služba poptávku přijala (ne potvrzení doručení do schránky). */
  function handleReturn() {
    var id = new URLSearchParams(location.search).get('pmj_sent'), pend = stJSON('sessionStorage', 'pending', null);
    try { var u = new URL(location.href); u.searchParams.delete('pmj_sent'); history.replaceState(history.state, '', u.href); } catch (e) {}
    if (!id || !pend || pend.id !== id) return;
    cfgP.then(function () { accepted(id, pend.n || 0, pend.f || 0, true); });
  }
  /* Přijato službou (AJAX odpověď success, dříve návrat z _next). Duplicity: každé číslo poptávky se započítá jen jednou. */
  function accepted(id, n, f, reopen) {
    var sent = stJSON('sessionStorage', 'sent', []);
    if (sent.indexOf(id) > -1) return;
    sent.push(id);
    st('sessionStorage', 'sent', JSON.stringify(sent.slice(-20)));
    st('sessionStorage', 'pending', null); st('sessionStorage', 'draft', null);
    setList([]);
    Q.submitting = false; Q.files.length = 0; Q.restored = false; lastWork = null; importText = '';
    remove(blocks.quote); remove(blocks.fallback); remove(blocks.unconf);
    if (NAV.length > 1) { NAV.length = 1; updNav(); } // odeslaná poptávka se nedá „vrátit“ – Zpět vede jen do nabídky
    track('jarda_quote_accepted', { lead_id: id, items_count: n, attachments_count: f });
    try { (window.dataLayer = window.dataLayer || []).push({ event: 'jarda_quote_sent', lead_id: id }); } catch (e) {} // kompatibilita s v2 (jen dataLayer)
    if (reopen) open('quote_accepted', true);
    say([p(T('quote_accepted', { id: id }), 'pmj-note'), contactButtons('Dotaz k poptávce ' + id, 'after_quote')], 'pmj-bot', 'accepted');
  }
  /* Odeslání bez návratu (chyba FormSubmitu, zavřená stránka ověření, Zpět) → upozornit, seznam zůstává. */
  /* Záložní cesta: poptávka NEBYLA odeslána → připravený e-mail na info@, kopie do schránky, WhatsApp. */
  function fallbackBlock(id, text, fileNames, reason, retry, serviceMsg, unknown) {
    var c = contact(), body = mailBody(id, text, fileNames), subj = (X.test ? 'TEST – ' : '') + 'Poptávka ' + id + ' (záložní e-mail)';
    track('jarda_quote_fallback', { lead_id: id, reason: reason, attachments_count: fileNames.length });
    var cp = btn('Zkopírovat poptávku', function () {
      copyText(body).then(function (ok) { cp.textContent = ok ? '✓ Zkopírováno' : 'Kopírování nefunguje – použijte e-mail'; });
      track('jarda_quote_fallback_click', { lead_id: id, channel: 'copy' });
    });
    var title = unknown ? (T('fallback_unknown') || 'Nepodařilo se ověřit, zda poptávka dorazila (bez odpovědi odesílací služby). Údaje zůstávají uložené.')
      : reason === 'service_rejected' ? (T('fallback_rejected') || 'Odesílací služba poptávku nepřijala. Poptávka NEBYLA odeslána – údaje zůstávají uložené.') + (serviceMsg ? ' (' + String(serviceMsg).slice(0, 120) + ')' : '')
      : (T('fallback_title') || 'Odesílací služba teď neodpovídá. Poptávka NEBYLA odeslána – seznam i údaje zůstávají uložené.');
    var kids = [p(title, 'pmj-note'),
      p(T('fallback_text') || 'Pošlete ji prosím e-mailem, připravili jsme ho za vás. Stačí ho odeslat ze svého e-mailu.')];
    if (fileNames.length) kids.push(p('Přílohy do e-mailu přiložte ručně: ' + fileNames.join(', ') + '.', 'pmj-small'));
    kids.push(actions([
      link('Otevřít připravený e-mail', mailto(c.email, subj, body), 'pmj-btn-primary', false, function () { track('jarda_quote_fallback_click', { lead_id: id, channel: 'email' }); }),
      cp, waButton('Poptávka ' + id + ' – formulář na webu nešel odeslat', 'fallback')]));
    kids.push(p('Adresa: ' + c.email + ' · telefon ' + c.phoneLabel, 'pmj-small'));
    if (retry) kids.push(h('p', { class: 'pmj-small' }, [h('button', { type: 'button', class: 'pmj-linkbtn', text: 'Zkusit přesto odeslat formulářem', onclick: function () { track('jarda_quote_fallback_click', { lead_id: id, channel: 'retry' }); retry(); } })]));
    say(kids, 'pmj-bot', 'fallback');
  }
  function draftSummary() {
    var d = draftGet(), l = [], gl = getList(), t = draftText(d, gl);
    var list = [listText(gl), t].filter(Boolean).join('\n'); if (list) l.push('Seznam materiálu:\n' + list);
    [['tel', 'Telefon'], ['email', 'E-mail'], ['zip', 'PSČ dodání'], ['ico', 'IČO'], ['note', 'Poznámka']].forEach(function (x) { if (d[x[0]]) l.push(x[1] + ': ' + d[x[0]]); });
    return l.join('\n');
  }

  function checkUnconfirmed(now) {
    var pend = stJSON('sessionStorage', 'pending', null), after = ((A.quote && A.quote.unconfirmed_after_s) || 20) * 1000;
    if (!pend || (!now && pend.t >= LOADED && Date.now() - pend.t < after)) return; // vytvořeno před tímto načtením stránky = návrat bez přijetí
    if (Date.now() - pend.t > 864e5) { st('sessionStorage', 'pending', null); return; }
    if (!pend.w) { pend.w = 1; st('sessionStorage', 'pending', JSON.stringify(pend)); track('jarda_quote_unconfirmed', { lead_id: pend.id }); }
    var c = contact(), body = mailBody(pend.id, draftSummary(), []);
    say([p(T('quote_unconfirmed', { id: pend.id }), 'pmj-note'), actions([btn('Zkontrolovat a odeslat znovu', function () { st('sessionStorage', 'pending', null); showQuote('retry'); }, 'pmj-btn-primary'),
      link('Poslat e-mailem', mailto(c.email, (X.test ? 'TEST – ' : '') + 'Poptávka ' + pend.id + ' (záložní e-mail)', body), '', false, function () { track('jarda_quote_fallback_click', { lead_id: pend.id, channel: 'email' }); }),
      waButton('Dotaz k poptávce ' + pend.id, 'unconfirmed')]), pend.f ? p('Přílohy (' + pend.f + ') do e-mailu přiložte ručně.', 'pmj-small') : null], 'pmj-bot', 'unconf');
  }

  /* ---------- odpovědi ---------- */
  function calc() {
    var list = (A.calculators || []).slice(0, 12);
    screen('calc', 'Kalkulačky', function () { return say([p(T('calc')), list.length ? h('ul', { class: 'pmj-ul pmj-calcs' }, list.map(function (c) {
      return h('li', {}, [h('a', { href: c.u, text: c.t, onclick: function () { track('jarda_calc_click', { calc: c.id || c.u, from: 'chip' }); } })]);
    })) : null, actions([link('Všechny kalkulačky', L.kalkulacky || '/kalkulacky/', 'pmj-btn-primary')])], 'pmj-bot', 'calc'); });
  }
  /* Doprava: jen ověřená pravidla (config.app.json → shipping, opsáno z /doprava-platba/) a hodnota dopravy zdarma
     přímo ze Shoptetu (cartInfo.freeShippingFrom), když ji stránka nabízí. Žádné termíny ani slib společné expedice. */
  function shipping() { screen('shipping', 'Doprava a platba', shippingView); }
  function shippingView() {
    var f = C.facts || {}, S = A.shipping || {}, kids = [p(T('shipping_title'), 'pmj-title')], li = [];
    if (typeof f.min_order_czk === 'number') li.push('Minimální objednávka je ' + kc(f.min_order_czk) + ' (cena zboží s DPH, bez dopravy).');
    if (S.rules && S.rules.length) li = li.concat(S.rules);
    else if (f.shipping_from) li.push('Doprava stojí od ' + f.shipping_from + '.');
    if (f.cables) li.push(f.cables);
    var ci = SD.cartInfo, free = ci && typeof ci.freeShippingFrom === 'number' && ci.freeShippingFrom > 0 ? ci.freeShippingFrom : S.free_from_czk;
    if (typeof free === 'number' && S.free_note) li.push('Doprava zdarma od ' + kc(free) + ' (hodnota zboží s DPH). ' + S.free_note);
    if (S.note) li.push(S.note);
    if (f.payment) li.push(f.payment);
    kids.push(h('ul', { class: 'pmj-ul' }, li.map(function (t) { return h('li', { text: t }); })));
    kids.push(actions([link('Vše o dopravě a platbě', L.doprava || '/doprava-platba/', 'pmj-btn-primary'), btn('Doprava větší objednávky', function () { you('Doprava větší objednávky'); showQuote('shipping'); }), btn('Zeptat se obchodníka', function () { you('Zeptat se obchodníka'); human(); })]));
    return say(kids, 'pmj-bot', 'shipping');
  }
  function payment() {
    var f = C.facts;
    screen('payment', 'Platba', function () { return say([f && f.payment ? p(f.payment) : null, actions([link('Doprava a platba', L.doprava || '/doprava-platba/', 'pmj-btn-primary'), btn('Zeptat se obchodníka', human)])], 'pmj-bot', 'payment'); });
  }
  function orderStatus() {
    screen('order', 'Moje objednávka', function () { return say([p(T('order_status')), actions([link('Moje objednávky (přihlášení)', contact().orders, 'pmj-btn-primary')]), contactButtons('Dotaz k objednávce č. ', 'order')], 'pmj-bot', 'order'); });
  }
  function invoice() { screen('invoice', 'Faktura', function () { return say([p(T('invoice')), contactButtons('Dotaz k faktuře, objednávka č. ', 'invoice')], 'pmj-bot', 'invoice'); }); }
  /* Poptávka ≠ objednávka: nacenění je nezávazné (odpoví obchodník), objednávka se dokončuje v košíku e-shopu. */
  function b2b() {
    screen('b2b', 'Nacenění pro firmu', function () {
      return say([p(T('b2b')), p(T('quote_vs_order') || 'Poptávka je nezávazná – nabídku pošle obchodník. Běžný nákup dokončíte rovnou v košíku e-shopu.', 'pmj-small'),
        actions([btn('Otevřít poptávku', function () { you('Otevřít poptávku'); showQuote('b2b'); }, 'pmj-btn-primary'), btn('Najít materiál', function () { you('Najít materiál'); find(); })])], 'pmj-bot', 'b2b');
    });
  }
  function human() { screen('human', 'Obchodník', function () { return say([p(T('contact') || T('human')), contactButtons(null, 'human')], 'pmj-bot', 'human'); }); }

  var HANDLERS = { doprava: shipping, platba: payment, objednavka: orderStatus, faktura: invoice, b2b: b2b, clovek: human };
  var LABELS = { doprava: 'Doprava', platba: 'Platba', objednavka: 'Moje objednávka', faktura: 'Faktura k objednávce', b2b: 'Nacenění pro firmu', clovek: 'Obchodník' };
  function intentChips(keys, q) {
    var defs = keys.filter(function (k) { return HANDLERS[k]; }).map(function (k) { return ['intent_' + k, LABELS[k], HANDLERS[k]]; });
    if (q) defs.push(['intent_search', 'Hledat „' + q + '“ v katalogu', function () { doSearch(q); }]);
    return chipRow(defs);
  }

  function onText(e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    you(q);
    runQuery(q);
  }
  /* Volný text: záměr (doprava, objednávka…) nebo hledání. Funguje i bez nabídky (přímé hledání). */
  function runQuery(q) {
    cfgP.then(function () {
      var r = classify(q, RULES);
      if (r.intent) track('jarda_intent', { intent: r.intent, mode: r.mode });
      if (r.mode === 'direct' && HANDLERS[r.intent]) HANDLERS[r.intent]();
      else if (r.mode === 'clarify') screen('clarify:' + q.toLowerCase(), 'Upřesnění', function () { return say([p(T('clarify')), intentChips(r.alt, q)], 'pmj-bot', 'clarify'); }, true);
      else if (r.mode === 'mixed') {
        var m = parseQty(q);
        doSearch(m.q ? m.query : q, null, function () { say([p(T('mixed'), 'pmj-small'), intentChips([r.intent], '')], 'pmj-bot', 'mixed'); }, m.q ? m : null);
      } else { var qq = parseQty(q); doSearch(qq.q ? qq.query : q, null, null, qq.q ? qq : null); }
    });
  }

  /* ---------- panel ---------- */
  function build() {
    input = h('input', { type: 'text', class: 'pmj-input pmj-q', placeholder: T('input_placeholder'), 'aria-label': 'Zpráva pro poradce', autocomplete: 'off', enterkeyhint: 'send', maxlength: '120' });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) onText(e);
      else if (e.key === 'ArrowUp' && !input.value && (lastQuery || st('sessionStorage', 'lastq'))) { e.preventDefault(); editQuery(); } // šipka nahoru = poslední dotaz
    });
    // katalog (~1 MB gzip) se začne stahovat, jakmile zákazník začne psát – ne při otevření panelu (kdo jen klikne na čip, nestahuje)
    input.addEventListener('input', function pre() { input.removeEventListener('input', pre); getIndex().catch(function () {}); });
    input.addEventListener('paste', function (e) {
      var t = e.clipboardData && e.clipboardData.getData('text');
      if (t && /\S[^\n]*\n+\s*\S/.test(t.trim())) { e.preventDefault(); track('jarda_chip_click', { chip: 'paste_list' }); you('Vložený seznam (' + parseLines(t).length + ' položek)'); importList(t); }
    });
    log = h('div', { class: 'pmj-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    countEl = h('span');
    var n = getList().length; countEl.textContent = n ? ' (' + n + ')' : '';
    panel = h('section', { id: 'pmj-panel', class: 'pmj-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pmj-title', tabindex: '-1', hidden: true }, [
      h('header', { class: 'pmj-head' }, [
        h('img', { class: 'pmj-ava', src: C.logo_v3, alt: '', width: '40', height: '40' }),
        h('div', { class: 'pmj-who' }, [h('h2', { id: 'pmj-title', class: 'pmj-name', text: C.name }), h('span', { class: 'pmj-role', text: C.role })]),
        h('button', { type: 'button', class: 'pmj-listbtn', onclick: function () { showList(); } }, ['Seznam', countEl]),
        h('button', { type: 'button', class: 'pmj-x', 'aria-label': 'Zavřít poradce', text: '×', onclick: close })
      ]),
      log,
      navEl = h('nav', { class: 'pmj-nav', 'aria-label': 'Navigace v poradci', hidden: true }, [
        backEl = h('button', { type: 'button', class: 'pmj-navb', onclick: back }),
        homeEl = h('button', { type: 'button', class: 'pmj-navb pmj-navh', text: 'Hlavní nabídka', onclick: home })]),
      h('div', { class: 'pmj-bar', role: 'search' }, [input, h('button', { type: 'button', class: 'pmj-go', 'aria-label': 'Odeslat', text: '➜', onclick: onText })]),
      C.auto_open && C.auto_open.enabled ? h('div', { class: 'pmj-foot' }, [h('button', { type: 'button', class: 'pmj-linkbtn', text: T('no_auto') || 'Neotevírat automaticky',
        onclick: function (e) { st('localStorage', 'noauto', '1'); track('jarda_noauto', {}); e.target.disabled = true; e.target.textContent = 'Automatické otevírání vypnuto'; } })]) : null
    ]);
    root.insertBefore(panel, root.firstChild);
    document.addEventListener('keydown', function (e) { if ((e.key === 'Escape' || e.key === 'Esc') && isOpen) { e.stopPropagation(); close(); } });
  }

  /* iOS Safari: otevřená klávesnice zmenší jen viditelnou část (visualViewport), panel přes celou obrazovku by pole
     a tlačítka schoval pod klávesnici. Na mobilu proto panel sleduje viditelnou oblast. */
  var VV = window.visualViewport, MQ = window.matchMedia ? matchMedia('(max-width:599px)') : null;
  function fitVV() {
    var on = isOpen && VV && MQ && MQ.matches;
    root.style.top = on ? VV.offsetTop + 'px' : '';
    root.style.height = on ? VV.height + 'px' : '';
    root.style.bottom = on ? 'auto' : '';
    if (on && document.activeElement && log.contains(document.activeElement) && document.activeElement.scrollIntoView) {
      try { document.activeElement.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }
  if (VV) { VV.addEventListener('resize', fitVV); VV.addEventListener('scroll', fitVV); }
  function open(source, quiet) {
    X.hideTeaser();
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    fitVV();
    root.classList.add('pmj-open');
    document.documentElement.classList.add('pmj-lock');
    fab.setAttribute('aria-expanded', 'true');
    st('sessionStorage', 'opened', '1');
    track('jarda_open', { jarda_source: source || 'click', page_type: SD.pageType || '' });
    if (!started) { started = true; if (!quiet) cfgP.then(intro); else cfgP.then(function () { if (!log.childNodes.length) intro(); }); }
    else checkUnconfirmed();
    (window.matchMedia && matchMedia('(pointer:coarse)').matches ? panel : input).focus(); // na dotyku bez vyskočení klávesnice
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    fitVV();
    root.classList.remove('pmj-open');
    document.documentElement.classList.remove('pmj-lock');
    fab.setAttribute('aria-expanded', 'false');
    (lastFocus && lastFocus !== document.body && document.contains(lastFocus) && !panel.contains(lastFocus) ? lastFocus : fab).focus();
  }

  build();
  /* pro kalkulačky (window.PMJ.add v zavaděči): otevřít a ukázat seznam */
  function showListOpen(source) { open(source || 'api', true); cfgP.then(function () { if (!log.childNodes.length) intro(); showList(); }); }
  function addFromApi(d) {
    var n = addItems(Array.isArray(d.items) ? d.items : [], 'api');
    if (n) track('jarda_api_add', { api_source: String(d.source || '').slice(0, 40), items_added: n });
    if (n && d.open !== false) showListOpen('api');
    return n;
  }
  return { toggle: function (s) { isOpen ? close() : open(s); }, isOpen: function () { return isOpen; }, handleReturn: handleReturn, showList: showListOpen, addFromApi: addFromApi };
};
