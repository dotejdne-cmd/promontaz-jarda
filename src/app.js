/* ProMontaz – Jarda v3: aplikace (panel, hledání, seznam, poptávka). Stahuje se až při interakci se zavaděčem. */
import { st, stJSON, h, abs, fetchJSON, merge } from './util.js';
import { buildIndexAsync, search, prepSynonyms, thumbUrl } from './search.js';
import { prepRules, classify } from './intent.js';
import { probe, formText, mailto, copyText, mailBody } from './fallback.js';

window.__pmjApp = function (X) {
  var C = X.C, SD = X.SD || {}, track = X.track, root = X.root, fab = X.fab;
  document.head.appendChild(h('style', { id: 'pmj-style', text: __CSS__ }));

  /* config.app.json (pravidla, texty v3). Bez něj Jarda funguje dál: volný text se bere jako hledání. */
  var A = { texts_v3: {}, intent_rules: {}, synonyms: {}, quote: {}, cart_add: {}, contact: {} }, RULES = {}, SYN = {};
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
  function addItem(it, source) {
    var l = getList(), found = null;
    l.forEach(function (x) { if (x.n === it.n && (x.u || '') === (it.u || '')) found = x; });
    if (found) found.q = (found.q || 1) + (it.q || 1);
    else l.push({ n: it.n, c: it.c || '', u: it.u || '', q: it.q || 1, f: it.f ? 1 : 0 });
    setList(l);
    track('jarda_add_to_list', { item_source: source, list_count: l.length });
  }
  function listText(l) {
    return l.map(function (x) { return (x.q || 1) + '× ' + (x.f ? 'Dotaz: ' : '') + x.n + (x.c ? ' (kód ' + x.c + ')' : '') + (x.u ? ' – ' + x.u : ''); }).join('\n');
  }

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
    scrollEnd();
    return m;
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

  function intro() {
    var kids = [p(T('greeting'))], miss = cartMissing();
    if (miss > 0) kids.push(p(T('cart_missing', { x: kc(miss) }), 'pmj-note'));
    var ci = cartInfo();
    if (ci && C.context && C.context.cart_quote_chip !== false) kids.push(p(T('cart_quote'), 'pmj-small'));
    var m = say(kids.concat([chipRow(chipDefs())]), 'pmj-bot', 'intro');
    if (miss > 0) {
      var stale = function () { remove(m.querySelector('.pmj-note')); };
      document.addEventListener('ShoptetCartUpdated', stale);
      document.addEventListener('ShoptetDOMCartContentLoaded', stale);
    }
    checkUnconfirmed();
  }

  /* ---------- hledání ---------- */
  function find() {
    say([p(T('search_prompt'))]);
    getIndex().catch(function () {});
    input.focus();
  }

  function addFree(q) { addItem({ n: q, f: 1 }, 'free_text'); added(); }
  function added() {
    say([p(T('added') + ' Položek v seznamu: ' + getList().length + '.'),
      actions([btn('Zobrazit seznam', showList), btn('Nacenit seznam', function () { showQuote('added'); }, 'pmj-btn-primary')])], 'pmj-bot', 'added');
  }

  function cartAllowed(it) {
    var ca = A.cart_add || {}, cs = window.shoptet && window.shoptet.cartShared;
    return ca.enabled && !it.v && !!it.c && !!cs && typeof cs.addToCart === 'function';
  }
  /* Vložení do košíku přes Shoptet (shoptet.cartShared.addToCart podle kódu produktu, jen produkty bez variant).
     Úspěch hlásíme až po události ShoptetCartUpdated, jinak odkaz na produkt. */
  function addToCart(it, b) {
    b.disabled = true; b.textContent = 'Vkládám…';
    var done = false, to = (A.cart_add && A.cart_add.confirm_timeout_ms) || 6000;
    function finish(ok) {
      if (done) return; done = true;
      document.removeEventListener('ShoptetCartUpdated', onOk);
      track('jarda_add_to_cart', { item_id: it.c, result: ok ? 'ok' : 'fail' });
      if (ok) { b.textContent = '✓ V košíku'; say([p(T('cart_added')), actions([link('Zobrazit košík', '/kosik/', 'pmj-btn-primary')])], 'pmj-bot', 'cart'); }
      else { b.disabled = false; b.textContent = 'Do košíku'; say([p(T('cart_failed')), actions([link('Otevřít produkt', it.u, 'pmj-btn-primary')])], 'pmj-bot', 'cart'); }
    }
    function onOk() { finish(true); }
    document.addEventListener('ShoptetCartUpdated', onOk);
    setTimeout(function () { finish(false); }, to);
    try { window.shoptet.cartShared.addToCart({ productCode: it.c, amount: 1 }); } catch (e) { finish(false); }
  }

  function card(it, pos, q, source) {
    var add = h('button', { type: 'button', class: 'pmj-btn pmj-btn-primary pmj-add', text: '+ k nacenění', 'aria-label': 'Přidat k nacenění: ' + it.n });
    add.addEventListener('click', function () { addItem({ n: it.n, c: it.c, u: it.u, q: 1 }, source || 'search'); add.textContent = '✓ V seznamu'; add.disabled = true; added(); });
    var btns = [add];
    if (cartAllowed(it)) {
      var cb = h('button', { type: 'button', class: 'pmj-btn pmj-btn-ghost pmj-add', text: 'Do košíku', 'aria-label': 'Vložit do košíku 1×: ' + it.n });
      cb.addEventListener('click', function () { addToCart(it, cb); });
      btns.push(cb);
    } else if (it.v) btns.push(link('Vybrat variantu', it.u, 'pmj-btn-ghost pmj-add'));
    var src = thumb(it);
    function clickTrack() { track('jarda_product_click', { item_id: it.c, index: pos + 1, search_term: q || '' }); }
    return h('li', { class: 'pmj-card' }, [
      src ? h('img', { class: 'pmj-thumb', src: src, alt: '', width: '56', height: '56', loading: 'lazy', decoding: 'async', onerror: function () { this.style.visibility = 'hidden'; } }) : h('span', { class: 'pmj-thumb' }),
      h('div', { class: 'pmj-card-body' }, [
        h('a', { class: 'pmj-card-name', href: it.u, text: it.n, onclick: clickTrack }),
        it.p != null ? h('span', { class: 'pmj-price' }, [(it.v ? 'od ' : '') + kc(it.p), h('small', { text: ' s DPH' })]) : null,
        it.c ? h('span', { class: 'pmj-code', text: 'Kód: ' + it.c }) : null
      ]),
      h('div', { class: 'pmj-card-actions' }, btns)
    ]);
  }
  function cards(list, q, source) { return h('ul', { class: 'pmj-cards' }, list.map(function (it, i) { return card(it, i, q, source); })); }

  function doSearch(q, onZero, after) {
    var wait = say([p(T('loading'))], 'pmj-bot pmj-wait');
    getIndex().then(function (idx) {
      remove(wait);
      var r = search(idx, q, { limit: 5, replace: C.search_replace, synonyms: SYN });
      track('jarda_search', { search_term: q, results_count: r.total, page_type: SD.pageType || '' });
      if (!r.total) {
        track('jarda_search_no_results', { search_term: q, missing_term: r.missing.join(' ') });
        if (onZero) { onZero(); return; }
        var kids = [p(r.missing.length && r.partial ? T('results_partial', { q: q, w: r.partial.without }) : T('no_results')), p(T('no_results_quote'), 'pmj-small')];
        var acts = [btn('Přidat „' + q + '“ k nacenění', function () { addFree(q); }, 'pmj-btn-primary')];
        if (r.partial) acts.unshift(btn(T('partial_btn', { q: r.partial.query, n: r.partial.total }), function () {
          track('jarda_chip_click', { chip: 'partial' });
          say([p(T('partial_note', { w: r.partial.without }), 'pmj-note'), cards(r.partial.results, q, 'partial')]);
        }));
        acts.push(btn('Poslat fotku nebo seznam', function () { showQuote('no_results'); }));
        kids.push(actions(acts));
        say(kids);
        if (after) after();
        return;
      }
      var kids2 = [p(T('results')), cards(r.results, q, 'search')];
      if (r.total > r.results.length) kids2.push(h('p', { class: 'pmj-small' }, [T('results_more', { n: r.total }) + ' ',
        h('a', { href: '/vyhledavani/?string=' + encodeURIComponent(q), text: 'Zobrazit všech ' + r.total + ' v e-shopu' })]));
      kids2.push(p(T('price_note'), 'pmj-small'));
      kids2.push(h('p', { class: 'pmj-small' }, [T('not_listed') + ' ', h('button', { type: 'button', class: 'pmj-linkbtn', text: 'Přidat „' + q + '“', onclick: function () { addFree(q); } })]));
      say(kids2);
      if (after) after();
    }, function () {
      remove(wait);
      track('jarda_search', { search_term: q, results_count: -1, index_error: true });
      say([p(T('index_error')), actions([btn('Přidat „' + q + '“ k nacenění', function () { addFree(q); }, 'pmj-btn-primary'), waButton(null, 'index_error')])]);
    });
  }

  /* ---------- kontextové akce ---------- */
  function productBulk() {
    var pr = currentProduct();
    if (!pr) { find(); return; }
    addItem(pr, 'product');
    say([p(T('product_bulk')), p('„' + pr.n + '“ – ' + pr.q + '× je v seznamu. Množství upravíte v seznamu.'),
      actions([btn('Nacenit seznam', function () { showQuote('product'); }, 'pmj-btn-primary'), btn('Přidat další materiál', find), btn('Zobrazit seznam', showList)])], 'pmj-bot', 'added');
  }
  function showSet() {
    var codes = setCodes(), wait = say([p(T('loading'))], 'pmj-bot pmj-wait');
    getIndex().then(function (idx) {
      remove(wait);
      var found = [];
      codes.forEach(function (c) { var k = c.toLowerCase().replace(/[\s_\-./]/g, ''); for (var i = 0; i < idx.length; i++) if (idx[i].ck.indexOf(k) > -1) { found.push(idx[i]); break; } });
      if (!found.length) { say([p(T('set_none'))]); return; }
      say([p(T('set_title')), cards(found, '', 'set'), p(T('price_note'), 'pmj-small')]);
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
  function showList() {
    var box = h('div', { class: 'pmj-list' });
    track('jarda_list_view', { list_count: getList().length });
    function render() {
      var l = getList();
      box.textContent = '';
      box.appendChild(p(T('list_title'), 'pmj-title'));
      if (!l.length) { box.appendChild(p(T('list_empty'))); box.appendChild(actions([btn('Najít materiál', find), btn('Poslat fotku nebo seznam', function () { showQuote('list'); }, 'pmj-btn-primary')])); return; }
      box.appendChild(h('ul', { class: 'pmj-rows' }, l.map(function (x, i) {
        var q = h('input', { type: 'number', class: 'pmj-qty', min: '1', step: '1', inputmode: 'numeric', value: String(x.q || 1), 'aria-label': 'Množství: ' + x.n });
        q.addEventListener('change', function () {
          var v = Math.max(1, Math.round(parseFloat(String(q.value).replace(',', '.')) || 1));
          q.value = v; var cur = getList(); if (cur[i]) { cur[i].q = v; setList(cur); }
        });
        var del = h('button', { type: 'button', class: 'pmj-del', 'aria-label': 'Odebrat: ' + x.n, text: '×' });
        del.addEventListener('click', function () { var cur = getList(); cur.splice(i, 1); setList(cur); render(); var f = box.querySelector('.pmj-qty, .pmj-btn'); if (f) f.focus(); });
        return h('li', { class: 'pmj-row' }, [
          x.u ? h('a', { class: 'pmj-row-name', href: x.u, text: x.n }) : h('span', { class: 'pmj-row-name', text: (x.f ? 'Dotaz: ' : '') + x.n }), q, del]);
      })));
      box.appendChild(actions([btn('Nacenit seznam', function () { showQuote('list'); }, 'pmj-btn-primary'), btn('Najít další', find)]));
    }
    render();
    say([box], 'pmj-bot', 'list');
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

  var files = [], submitting = false, formSend = null, forceSend = false;
  function field(label, control, hint, opt) {
    return h('label', { class: 'pmj-field' }, [h('span', { class: 'pmj-label' }, [label, opt ? h('span', { class: 'pmj-opt', text: ' (nepovinné)' }) : null]), control, hint ? h('span', { class: 'pmj-hint', text: hint }) : null]);
  }
  function showQuote(source) {
    var Qc = A.quote || {}, maxFiles = Qc.max_files || 10, maxTotal = (Qc.max_total_mb || 10) * 1048576;
    var formats = Qc.formats || ['pdf', 'xlsx', 'csv', 'jpg', 'jpeg', 'png'];
    var draft = stJSON('sessionStorage', 'draft', {}) || {};
    var list = getList();
    var ta = h('textarea', { rows: '5', class: 'pmj-input', placeholder: 'Např. 20× vrut 5x60, 3× OSB 18 mm…', 'aria-describedby': 'pmj-err' });
    ta.value = list.length ? listText(list) + (draft.extra ? '\n' + draft.extra : '') : (draft.text || '');
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
    var send = h('button', { type: 'button', class: 'pmj-btn pmj-btn-primary pmj-send', text: 'Odeslat k nacenění' });
    formSend = send;
    [['email', email], ['tel', tel], ['zip', zip], ['ico', ico], ['term', term], ['note', note]].forEach(function (x) { if (draft[x[0]]) x[1].value = draft[x[0]]; });
    var more = h('details', { class: 'pmj-more' }, [h('summary', { text: 'Firma, termín, poznámka' }),
      field('IČO', ico, 'Vyplňte, pokud chcete nabídku na firmu.', 1), field('Požadovaný termín', term, null, 1), field('Poznámka', note, null, 1)]);
    if (draft.ico || draft.term || draft.note) more.open = true;
    /* Záměrně <div role=form>, ne <form>: automatické sledování formulářů v gtag by jinak posílalo form_start/form_submit
       z Jardy do GA4 i Google Ads. Do FormSubmitu se odesílá samostatný skrytý <form> přes .submit() (bez události submit). */
    var form = h('div', { class: 'pmj-form', role: 'form', 'aria-label': T('quote_title') || 'Poptávka k nacenění' }, [
      h('p', { class: 'pmj-title', text: T('quote_title') }), p(T('quote_short'), 'pmj-small'),
      field('Seznam materiálu', ta, 'Název nebo kód a množství. Upravit můžete i tady.'),
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
    files = [];
    function renderFiles() {
      flist.textContent = '';
      files.forEach(function (f, i) {
        flist.appendChild(h('li', {}, [h('span', { text: f.name + ' (' + mb(f.size) + ')' }),
          h('button', { type: 'button', class: 'pmj-del', 'aria-label': 'Odebrat soubor ' + f.name, text: '×', onclick: function () { files.splice(i, 1); renderFiles(); } })]));
      });
    }
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
        renderFiles();
        err.textContent = msgs.join(' ');
      });
    });
    /* rozepsaná poptávka se ukládá jen do sessionStorage této karty a maže se po přijetí */
    var saveT;
    function saveDraft() {
      clearTimeout(saveT);
      saveT = setTimeout(function () {
        var listNow = listText(getList()), t = ta.value;
        st('sessionStorage', 'draft', JSON.stringify({ text: t, extra: listNow && t.indexOf(listNow) === 0 ? t.slice(listNow.length).trim() : '',
          email: email.value, tel: tel.value, zip: zip.value, ico: ico.value, term: term.value, note: note.value }));
      }, 400);
    }
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);

    send.addEventListener('click', doSubmit);
    form.addEventListener('keydown', function (e) { var t = e.target; if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'file') { e.preventDefault(); doSubmit(); } });
    function doSubmit() {
      if (submitting) return;
      var em = email.value.trim(), ph = tel.value.trim(), z = zip.value.replace(/\s/g, ''), ic = ico.value.replace(/\s/g, ''), bad = null, msg = '';
      if (!ta.value.trim() && !files.length) { msg = 'Napište, co nacenit, nebo přiložte fotku či seznam.'; bad = ta; }
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
      var id = leadId(), n = getList().length, F = h('form', { method: 'post', action: C.formsubmit_endpoint, enctype: 'multipart/form-data', 'accept-charset': 'UTF-8', hidden: true });
      function hid(name, val) { F.appendChild(h('input', { type: 'hidden', name: name, value: val })); }
      hid('_subject', (X.test ? 'TEST – ' : '') + 'Poptávka ' + id + ' – widget Jarda' + (z ? ' – PSČ ' + z : '') + (files.length ? ' – ' + files.length + ' příl.' : ''));
      hid('_template', 'table'); hid('_next', nextUrl(id)); hid('_honey', hp.value);
      if (em) { hid('email', em); hid('_replyto', em); }
      hid('Číslo poptávky', id); hid('Zdroj', 'Widget Jarda ' + C.__version); hid('Stránka', location.href);
      hid('Seznam materiálu', ta.value.trim() || '—'); hid('Počet položek ze seznamu', String(n));
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
      submitting = true; send.disabled = true; send.textContent = 'Odesílám…';
      /* Odeslání na AJAX endpoint FormSubmitu (formsubmit.co/ajax/…): odpověď {"success":"true"} je jediné potvrzení
         přijetí. Zákazník zůstává na promontaz.cz (bez reCAPTCHA stránky a bez závislosti na přesměrování _next). */
      var go = function () {
        st('sessionStorage', 'pending', JSON.stringify({ id: id, t: Date.now(), n: n, f: files.length }));
        track('jarda_quote_submit', { lead_id: id, items_count: n, attachments_count: files.length, has_zip: !!z, has_ico: !!ic, quote_source: source || '' });
        submitAt = Date.now();
        send.textContent = files.length ? 'Odesílám poptávku a přílohy…' : 'Odesílám…';
        if (C.dry_run) { location.href = nextUrl(id); return; }
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
      if (forceSend || C.dry_run) { forceSend = false; go(); return; }
      /* Výpadek FormSubmitu (522) se pozná dřív, než zákazník opustí stránku → záložní e-mail místo chybové stránky */
      probe(C.formsubmit_endpoint, (A.quote && A.quote.probe_timeout_ms) || 6000).then(function (ok) {
        if (ok) return go();
        submitting = false; send.disabled = false; send.textContent = 'Odeslat k nacenění';
        var ft = formText(F);
        fallbackBlock(id, ft.text, files.map(function (f) { return f.name; }), 'service_down', function () { forceSend = true; doSubmit(); });
      });
    }
    say([form], 'pmj-bot', 'quote');
    track('jarda_quote_start', { list_count: list.length, quote_source: source || '' });
    if (draft.text || draft.email || draft.tel) say([p(T('draft_restored'), 'pmj-small')], 'pmj-bot', 'draftnote');
    (list.length ? (email.value || tel.value ? send : email) : ta).focus();
  }
  /* návrat tlačítkem Zpět (bfcache, hlavně iOS Safari): odblokovat odeslání */
  /* Návrat ze stránky odesílací služby tlačítkem Zpět (bfcache, iOS Safari i při chybě služby, např. 522):
     odblokovat tlačítko a hned ukázat, že se poptávka možná neodeslala (seznam zůstává). */
  var submitAt = 0, LOADED = Date.now();
  function unlock(note) {
    if (!submitting) return;
    submitting = false;
    if (formSend) { formSend.disabled = false; formSend.textContent = 'Odeslat k nacenění'; }
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
    submitting = false;
    remove(blocks.quote); remove(blocks.fallback); remove(blocks.unconf);
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
    var d = stJSON('sessionStorage', 'draft', {}) || {}, l = [];
    var list = listText(getList()); if (list) l.push('Seznam materiálu:\n' + list); else if (d.text) l.push('Seznam materiálu:\n' + d.text);
    if (d.extra) l.push(d.extra);
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
  function calc() { say([p(T('calc')), actions([link('Otevřít kalkulačky', L.kalkulacky || '/kalkulacky/', 'pmj-btn-primary')])]); }
  function shipping() {
    var f = C.facts, kids = [p(T('shipping_title'), 'pmj-title')];
    if (f) {
      var li = [];
      if (typeof f.min_order_czk === 'number') li.push('Minimální objednávka je ' + kc(f.min_order_czk) + ' (cena zboží s DPH, bez dopravy).');
      if (f.shipping_from) li.push('Doprava stojí od ' + f.shipping_from + '.');
      if (f.cables) li.push(f.cables);
      if (typeof f.free_shipping_from_czk === 'number') li.push('Doprava zdarma od ' + kc(f.free_shipping_from_czk) + '.');
      if (f.payment) li.push(f.payment);
      kids.push(h('ul', { class: 'pmj-ul' }, li.map(function (t) { return h('li', { text: t }); })));
    }
    kids.push(actions([link('Vše o dopravě a platbě', L.doprava || '/doprava-platba/', 'pmj-btn-primary'), btn('Zeptat se obchodníka', human)]));
    say(kids);
  }
  function payment() {
    var f = C.facts;
    say([f && f.payment ? p(f.payment) : null, actions([link('Doprava a platba', L.doprava || '/doprava-platba/', 'pmj-btn-primary'), btn('Zeptat se obchodníka', human)])]);
  }
  function orderStatus() {
    say([p(T('order_status')), actions([link('Moje objednávky (přihlášení)', contact().orders, 'pmj-btn-primary')]), contactButtons('Dotaz k objednávce č. ', 'order')]);
  }
  function invoice() { say([p(T('invoice')), contactButtons('Dotaz k faktuře, objednávka č. ', 'invoice')]); }
  function b2b() {
    say([p(T('b2b')), actions([btn('Otevřít poptávku', function () { showQuote('b2b'); }, 'pmj-btn-primary'), btn('Najít materiál', find)])]);
  }
  function human() { say([p(T('contact') || T('human')), contactButtons(null, 'human')]); }

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
    cfgP.then(function () {
      var r = classify(q, RULES);
      if (r.intent) track('jarda_intent', { intent: r.intent, mode: r.mode });
      if (r.mode === 'direct' && HANDLERS[r.intent]) HANDLERS[r.intent]();
      else if (r.mode === 'clarify') say([p(T('clarify')), intentChips(r.alt, q)]);
      else if (r.mode === 'mixed') {
        doSearch(q, null, function () { say([p(T('mixed'), 'pmj-small'), intentChips([r.intent], '')], 'pmj-bot', 'mixed'); });
      } else doSearch(q);
    });
  }

  /* ---------- panel ---------- */
  function build() {
    input = h('input', { type: 'text', class: 'pmj-input pmj-q', placeholder: T('input_placeholder'), 'aria-label': 'Zpráva pro poradce', autocomplete: 'off', enterkeyhint: 'send', maxlength: '120' });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) onText(e); });
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
      h('div', { class: 'pmj-bar', role: 'search' }, [input, h('button', { type: 'button', class: 'pmj-go', 'aria-label': 'Odeslat', text: '➜', onclick: onText })]),
      C.auto_open && C.auto_open.enabled ? h('div', { class: 'pmj-foot' }, [h('button', { type: 'button', class: 'pmj-linkbtn', text: T('no_auto') || 'Neotevírat automaticky',
        onclick: function (e) { st('localStorage', 'noauto', '1'); track('jarda_noauto', {}); e.target.disabled = true; e.target.textContent = 'Automatické otevírání vypnuto'; } })]) : null
    ]);
    root.insertBefore(panel, root.firstChild);
    document.addEventListener('keydown', function (e) { if ((e.key === 'Escape' || e.key === 'Esc') && isOpen) { e.stopPropagation(); close(); } });
  }

  function open(source, quiet) {
    X.hideTeaser();
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
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
    root.classList.remove('pmj-open');
    document.documentElement.classList.remove('pmj-lock');
    fab.setAttribute('aria-expanded', 'false');
    (lastFocus && lastFocus !== document.body && document.contains(lastFocus) && !panel.contains(lastFocus) ? lastFocus : fab).focus();
  }

  build();
  return { toggle: function (s) { isOpen ? close() : open(s); }, isOpen: function () { return isOpen; }, handleReturn: handleReturn };
};
