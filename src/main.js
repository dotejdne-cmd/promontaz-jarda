/* ProMontaz – virtuální poradce Jarda v2 | vložit s defer do Zápatí, nahrazuje promontaz-jarda.js v1 */
import { buildIndex, search, detectIntent, safeQuery } from './search.js';

(function () {
  'use strict';
  if (window.__pmj) return; // běží jiná verze Jardy (v1 nebo duplicitní řádek) – nespouštět dvakrát
  window.__pmj = 2;

  var SCRIPT = document.currentScript;
  var SRC = (SCRIPT && SCRIPT.src) || location.href;
  var TEST = /[?&]pmj=test(&|$)/.test(location.search);
  var P = 'pmj2_';

  /* Bez config.json se widget zobrazí jen se základními texty a odkazy – žádná fakta o dopravě. */
  var C = {
    name: 'Jarda', role: 'Virtuální poradce', logo: '/user/documents/upload/jarda.jpg', whatsapp: '420722792670',
    index_url: '', formsubmit_endpoint: '', links: { doprava: '/doprava-platba/', kalkulacky: '/kalkulacky/', nacenit: '/nacenit-material/', privacy: '/podminky-ochrany-osobnich-udaju/' },
    auto_open: { enabled: false }, facts: null, intents: {},
    texts: {
      greeting: 'Dobrý den, s čím pomůžu?', input_placeholder: 'Napište, co hledáte',
      human: 'Napište nám na WhatsApp.', whatsapp_message: 'Dobrý den, píšu z webu promontaz.cz.',
      index_error: 'Katalog se teď nepodařilo načíst. Napište, co potřebujete, a my vám to naceníme.'
    }
  };

  /* ---------- pomocné ---------- */
  function st(kind, k, v) {
    try {
      var s = window[kind];
      if (v === undefined) return s.getItem(P + k);
      if (v === null) s.removeItem(P + k); else s.setItem(P + k, v);
    } catch (e) { return null; }
  }
  function T(k, vars) {
    var s = (C.texts && C.texts[k]) || '';
    for (var v in vars || {}) s = s.split('{' + v + '}').join(vars[v]);
    return s;
  }
  function track(ev, params) {
    var o = { event: ev };
    for (var k in params || {}) o[k] = params[k];
    if (TEST) o.jarda_test = true;
    try { (window.dataLayer = window.dataLayer || []).push(o); } catch (e) {}
  }
  function kc(n) {
    try { return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(n) + ' Kč'; } catch (e) { return n + ' Kč'; }
  }
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    for (var k in props || {}) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function btn(label, onclick, cls, extra) {
    var p = { type: 'button', class: 'pmj-btn ' + (cls || 'pmj-btn-ghost'), text: label, onclick: onclick };
    for (var k in extra || {}) p[k] = extra[k];
    return h('button', p);
  }
  function link(label, href, cls, ext) {
    return h('a', { class: 'pmj-btn ' + (cls || 'pmj-btn-ghost'), href: href, text: label, target: ext ? '_blank' : null, rel: ext ? 'noopener' : null });
  }
  function abs(u, base) { try { return new URL(u, base || location.href).href; } catch (e) { return u; } }
  function fetchJSON(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ---------- Shoptet kontext (dataLayer) ---------- */
  function shoptet() {
    var dl = window.dataLayer || [];
    for (var i = dl.length - 1; i >= 0; i--) if (dl[i] && dl[i].shoptet) return dl[i].shoptet;
    return null;
  }
  var SD = shoptet() || {};
  if (/^(billingAndShipping|customerDetails|thankYou)$/.test(SD.pageType || '') || /\/(objednavka|pokladna)\b/i.test(location.pathname)) return;

  function currentProduct() {
    var p = SD.product, name = p && p.name, code = p && p.code;
    var codeEl = document.querySelector('.p-code span:not(.p-code-label)');
    if (p && p.hasVariants && codeEl) code = codeEl.textContent.trim() || code;
    if (!name) { var h1 = document.querySelector('.p-detail-inner-header h1, h1'); name = h1 && h1.textContent.trim(); }
    if (!code && codeEl) code = codeEl.textContent.trim();
    var amt = document.querySelector('#product-detail-form input[name="amount"]');
    var q = amt ? Math.max(1, Math.round(parseFloat(String(amt.value).replace(',', '.')) || 1)) : 1;
    return name ? { n: name, c: code || '', u: location.origin + location.pathname, q: q } : null;
  }
  var IS_PRODUCT = SD.pageType === 'productDetail' && !!SD.product;

  /* Košík: jen když dataLayer obsahuje položky a hodnotu zboží bez dopravy a platby (s DPH). */
  function cartMissing() {
    var ci = SD.cartInfo, min = C.facts && C.facts.min_order_czk;
    if (SD.pageType !== 'cart' || !ci || typeof min !== 'number') return 0;
    var val = ci.getNoBillingShippingPrice && ci.getNoBillingShippingPrice.withVat;
    if (!Array.isArray(ci.cartItems) || !ci.cartItems.length || typeof val !== 'number' || !isFinite(val)) return 0;
    return val < min ? Math.round((min - val) * 100) / 100 : 0;
  }

  /* ---------- seznam k nacenění (localStorage) ---------- */
  function getList() { try { var l = JSON.parse(st('localStorage', 'list') || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function setList(l) { st('localStorage', 'list', l.length ? JSON.stringify(l) : null); updateCount(); }
  function addItem(it, source) {
    var l = getList(), key = it.u || it.n, found = null;
    l.forEach(function (x) { if ((x.u || x.n) === key && x.n === it.n) found = x; });
    if (found) found.q = (found.q || 1) + (it.q || 1); else l.push({ n: it.n, c: it.c || '', u: it.u || '', q: it.q || 1, f: it.f ? 1 : 0 });
    setList(l);
    track('jarda_add_to_list', { item_source: source });
  }
  function listText(l) {
    return l.map(function (x) {
      return (x.q || 1) + '× ' + (x.f ? 'Dotaz: ' : '') + x.n + (x.c ? ' (kód ' + x.c + ')' : '') + (x.u ? ' – ' + x.u : '');
    }).join('\n');
  }

  /* ---------- index produktů (líně, až při prvním hledání) ---------- */
  var indexP = null;
  function getIndex() {
    if (!indexP) {
      if (!C.index_url) return Promise.reject(new Error('no index'));
      indexP = fetchJSON(C.index_url, 45000).then(buildIndex);
      indexP.catch(function () { indexP = null; });
    }
    return indexP;
  }

  /* ---------- UI ---------- */
  var root, fab, badge, teaser, panel, log, input, countEl, mode = '', isOpen = false, lastFocus = null;
  var blocks = {};

  function scrollEnd() { log.scrollTop = log.scrollHeight; }
  function say(kids, cls, key) {
    if (key && blocks[key] && blocks[key].parentNode) blocks[key].parentNode.removeChild(blocks[key]);
    var m = h('div', { class: 'pmj-msg ' + (cls || 'pmj-bot') }, kids);
    log.appendChild(m);
    if (key) blocks[key] = m;
    scrollEnd();
    return m;
  }
  function you(text) { say([h('p', { text: text })], 'pmj-you'); }
  function p(text) { return h('p', { text: text }); }
  function actions(list) { return h('div', { class: 'pmj-actions' }, list); }

  function updateCount() {
    var n = getList().length;
    if (countEl) countEl.textContent = n ? ' (' + n + ')' : '';
    if (badge) { badge.textContent = n; badge.hidden = !n; }
  }

  function waHref() {
    var l = getList(), msg = T('whatsapp_message') + '\nStránka: ' + location.href;
    if (l.length) msg += '\n\nSeznam k nacenění:\n' + listText(l);
    return 'https://wa.me/' + C.whatsapp + '?text=' + encodeURIComponent(msg);
  }
  function waButton() {
    var a = h('a', { class: 'pmj-btn pmj-btn-wa', href: waHref(), target: '_blank', rel: 'noopener', text: 'Napsat na WhatsApp' });
    a.addEventListener('click', function () { a.href = waHref(); track('jarda_whatsapp', { list_count: getList().length }); });
    return a;
  }

  var CHIPS = [
    ['najit', 'Najít materiál', find],
    ['nacenit', 'Nacenit seznam nebo fotku', function () { showQuote(); }],
    ['spotreba', 'Spočítat spotřebu', calc],
    ['doprava', 'Doprava a platba', shipping],
    ['clovek', 'Napsat člověku', human]
  ];
  function chips() {
    var list = CHIPS.slice();
    if (IS_PRODUCT) list.unshift(['produkt', 'Větší množství? Naceníme', productBulk]);
    return h('div', { class: 'pmj-chips', role: 'group', 'aria-label': 'Možnosti' }, list.map(function (c) {
      return h('button', {
        type: 'button', class: 'pmj-chip' + (c[0] === 'produkt' ? ' pmj-chip-hot' : ''), text: c[1],
        onclick: function () { track('jarda_chip_click', { chip: c[0] }); you(c[1]); c[2](); }
      });
    }));
  }

  function intro() {
    var kids = [p(T('greeting'))], miss = cartMissing();
    if (miss > 0) kids.push(h('p', { class: 'pmj-note', text: T('cart_missing', { x: kc(miss) }) }));
    var m = say(kids.concat([chips()]), 'pmj-bot', 'intro');
    if (miss > 0) {
      var stale = function () { var n = m.querySelector('.pmj-note'); if (n) n.parentNode.removeChild(n); };
      document.addEventListener('ShoptetCartUpdated', stale);
      document.addEventListener('ShoptetDOMCartContentLoaded', stale);
    }
  }
  function moreChips() { say([chips()], 'pmj-bot', 'chips'); }

  function find() {
    mode = 'search';
    say([p(T('search_prompt'))]);
    getIndex().catch(function () {}); // začne stahovat, než uživatel dopíše
    input.focus();
  }

  function addFree(q) {
    addItem({ n: q, f: 1 }, 'free_text');
    added();
  }
  function added() {
    say([p(T('added') + ' Položek v seznamu: ' + getList().length + '.'),
      actions([btn('Zobrazit seznam', showList), btn('Nacenit seznam', function () { showQuote(); }, 'pmj-btn-primary')])], 'pmj-bot', 'added');
  }

  function doSearch(q) {
    var wait = say([p(T('loading'))], 'pmj-bot pmj-wait');
    getIndex().then(function (idx) {
      wait.parentNode && wait.parentNode.removeChild(wait);
      var r = search(idx, q, 5, C.search_replace);
      track('jarda_search', { query: safeQuery(q), results_count: r.total });
      if (!r.total) {
        say([p(T('no_results')), actions([btn('Přidat „' + q + '“ do seznamu', function () { addFree(q); }, 'pmj-btn-primary'), waButton()])]);
        return;
      }
      var ul = h('ul', { class: 'pmj-cards' }, r.results.map(card));
      var kids = [p(T('results')), ul];
      if (r.total > r.results.length) kids.push(p(T('results_more', { n: r.total })));
      kids.push(h('p', { class: 'pmj-small' }, [T('not_listed') + ' ', h('button', { type: 'button', class: 'pmj-linkbtn', text: 'Přidat „' + q + '“', onclick: function () { addFree(q); } })]));
      say(kids);
    }, function () {
      wait.parentNode && wait.parentNode.removeChild(wait);
      track('jarda_search', { query: safeQuery(q), results_count: 0, index_error: true });
      say([p(T('index_error')), actions([btn('Přidat „' + q + '“ do seznamu', function () { addFree(q); }, 'pmj-btn-primary'), waButton()])]);
    });
  }

  function card(it) {
    var b = h('button', { type: 'button', class: 'pmj-btn pmj-btn-primary pmj-add', text: '+ do seznamu', 'aria-label': 'Přidat do seznamu: ' + it.n });
    b.addEventListener('click', function () {
      addItem({ n: it.n, c: it.c, u: it.u, q: 1 }, 'search');
      b.textContent = '✓ V seznamu'; b.disabled = true;
      added();
    });
    return h('li', { class: 'pmj-card' }, [
      h('a', { class: 'pmj-card-name', href: it.u, text: it.n }),
      it.p != null ? h('span', { class: 'pmj-price', text: (it.v ? 'od ' : '') + kc(it.p) + ' s DPH' }) : null,
      b
    ]);
  }

  function productBulk() {
    var pr = currentProduct();
    if (!pr) { find(); return; }
    addItem(pr, 'product');
    say([p(T('product_bulk')), p('„' + pr.n + '“ – ' + pr.q + '× je v seznamu. Množství upravíte v seznamu.'),
      actions([btn('Zobrazit seznam', showList), btn('Nacenit seznam', function () { showQuote(); }, 'pmj-btn-primary')])], 'pmj-bot', 'added');
  }

  function showList() {
    var l = getList(), box = h('div', { class: 'pmj-list' });
    function render() {
      l = getList();
      box.textContent = '';
      box.appendChild(h('p', { class: 'pmj-title', text: T('list_title') }));
      if (!l.length) { box.appendChild(p(T('list_empty'))); box.appendChild(actions([btn('Najít materiál', find), btn('Nacenit fotku nebo seznam', function () { showQuote(); }, 'pmj-btn-primary')])); return; }
      box.appendChild(h('ul', { class: 'pmj-rows' }, l.map(function (x, i) {
        var q = h('input', { type: 'number', class: 'pmj-qty', min: '1', step: '1', inputmode: 'numeric', value: String(x.q || 1), 'aria-label': 'Množství: ' + x.n });
        q.addEventListener('change', function () {
          var v = Math.max(1, Math.round(parseFloat(String(q.value).replace(',', '.')) || 1));
          q.value = v; var cur = getList(); if (cur[i]) { cur[i].q = v; setList(cur); }
        });
        var del = h('button', { type: 'button', class: 'pmj-del', 'aria-label': 'Odebrat: ' + x.n, text: '×' });
        del.addEventListener('click', function () { var cur = getList(); cur.splice(i, 1); setList(cur); render(); var f = box.querySelector('.pmj-qty, .pmj-btn'); if (f) f.focus(); });
        return h('li', { class: 'pmj-row' }, [
          x.u ? h('a', { class: 'pmj-row-name', href: x.u, text: x.n }) : h('span', { class: 'pmj-row-name', text: (x.f ? 'Dotaz: ' : '') + x.n }),
          q, del
        ]);
      })));
      box.appendChild(actions([btn('Najít další', find), btn('Nacenit seznam', function () { showQuote(); }, 'pmj-btn-primary')]));
    }
    render();
    say([box], 'pmj-bot', 'list');
  }

  function field(label, control, hint) {
    return h('label', { class: 'pmj-field' }, [h('span', { class: 'pmj-label', text: label }), control, hint ? h('span', { class: 'pmj-hint', text: hint }) : null]);
  }

  var MAX = 10 * 1024 * 1024, OKEXT = /\.(jpe?g|png|pdf)$/i;
  function showQuote() {
    mode = '';
    var list = getList();
    var ta = h('textarea', { name: 'Seznam materiálu', rows: '5', class: 'pmj-input', placeholder: 'Např. 20× vrut 5x60, 3× OSB 18 mm…' });
    ta.value = listText(list);
    var file = h('input', { type: 'file', name: 'attachment', class: 'pmj-file', accept: '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf' });
    var email = h('input', { type: 'email', name: 'email', class: 'pmj-input', autocomplete: 'email', inputmode: 'email', maxlength: '160' });
    var tel = h('input', { type: 'tel', name: 'Telefon', class: 'pmj-input', autocomplete: 'tel', inputmode: 'tel', maxlength: '30' });
    var note = h('textarea', { name: 'Poznámka', rows: '2', class: 'pmj-input', placeholder: 'PSČ, termín, firma / IČO…' });
    var err = h('p', { class: 'pmj-err', role: 'alert' });
    var send = h('button', { type: 'submit', class: 'pmj-btn pmj-btn-primary pmj-send', text: 'Odeslat k nacenění' });
    var form = h('form', { class: 'pmj-form', method: 'post', action: C.formsubmit_endpoint, enctype: 'multipart/form-data', 'accept-charset': 'UTF-8', novalidate: true }, [
      p(T('quote_intro')),
      field('Seznam materiálu', ta),
      field('Fotka nebo soubor (nepovinné)', file, 'JPG, PNG nebo PDF, nejvýše 10 MB.'),
      field('E-mail', email),
      field('Telefon', tel, 'Vyplňte e-mail nebo telefon, ať se vám můžeme ozvat.'),
      field('Poznámka (nepovinné)', note),
      h('div', { class: 'pmj-hp', 'aria-hidden': 'true' }, [h('label', {}, ['Nevyplňujte ', h('input', { type: 'text', name: '_honey', tabindex: '-1', autocomplete: 'off' })])]),
      err, send,
      h('p', { class: 'pmj-small' }, ['Údaje použijeme jen pro zpracování poptávky. Poptávku doručuje služba FormSubmit, která může krátce ověřit, že nejste robot. ',
        h('a', { href: C.links.privacy, text: 'Ochrana osobních údajů' })])
    ]);
    file.addEventListener('change', function () { err.textContent = fileError() || ''; });
    function fileError() {
      var f = file.files && file.files[0];
      if (!f) return '';
      if (!OKEXT.test(f.name)) return 'Přiložit lze JPG, PNG nebo PDF.';
      if (f.size > MAX) return 'Soubor je větší než 10 MB. Pošlete ho prosím menší, nebo e-mailem na info@promontaz.cz.';
      if (!f.size) return 'Soubor je prázdný.';
      return '';
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var em = email.value.trim(), ph = tel.value.trim(), hasFile = !!(file.files && file.files[0]);
      var bad = null, msg = '';
      if (!ta.value.trim() && !hasFile) { msg = 'Napište, co nacenit, nebo přiložte fotku.'; bad = ta; }
      else if (fileError()) { msg = fileError(); bad = file; }
      else if (!em && !ph) { msg = 'Vyplňte e-mail nebo telefon.'; bad = email; }
      else if (em && !/^[^\s@]{1,64}@[^\s@]{1,100}\.[a-z]{2,24}$/i.test(em)) { msg = 'Zkontrolujte e-mail (např. jmeno@firma.cz).'; bad = email; }
      else if (ph && (ph.replace(/\D/g, '').length < 9 || !/^\+?[0-9 ()-]+$/.test(ph))) { msg = 'Zkontrolujte telefon (alespoň 9 číslic).'; bad = tel; }
      else if (!C.formsubmit_endpoint) { msg = 'Formulář se teď nepodařilo připravit. Napište nám prosím na WhatsApp.'; }
      err.textContent = msg;
      [ta, file, email, tel].forEach(function (x) { if (x === bad) x.setAttribute('aria-invalid', 'true'); else x.removeAttribute('aria-invalid'); });
      if (msg) { if (bad) bad.focus(); return; }
      if (navigator.onLine === false) { err.textContent = 'Nejste připojeni k internetu. Připojte se a odešlete poptávku znovu.'; return; }

      var id = leadId(), next = nextUrl(id), n = getList().length;
      function hid(name, val) { form.appendChild(h('input', { type: 'hidden', name: name, value: val })); }
      hid('_subject', (TEST ? 'TEST – ' : '') + 'Poptávka ' + id + ' – widget Jarda' + (hasFile ? ' – 1 příl.' : ''));
      hid('_template', 'table');
      hid('_next', next);
      if (em) hid('_replyto', em);
      hid('Číslo poptávky', id);
      hid('Zdroj', 'Widget Jarda');
      hid('Stránka', location.href);
      if (!em) email.disabled = true;
      if (!ph) tel.value = '—';
      if (!hasFile) file.disabled = true;
      st('sessionStorage', 'pending', JSON.stringify({ id: id, n: n, f: hasFile ? 1 : 0 }));
      send.disabled = true; send.textContent = 'Odesílám…';
      if (C.dry_run) { location.href = next; return; }
      HTMLFormElement.prototype.submit.call(form);
    });
    say([form], 'pmj-bot', 'quote');
    ta.focus();
  }
  function leadId() {
    var a = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789', s = '', d = new Date(), r = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(r);
    for (var i = 0; i < 6; i++) s += a[r[i] % a.length];
    return 'PM-' + String(d.getFullYear()).slice(2) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-J' + s;
  }
  function nextUrl(id) {
    var u = new URL(location.href);
    u.searchParams.set('pmj_sent', id);
    u.hash = '';
    return u.href;
  }

  function calc() {
    say([p(T('calc')), actions([link('Otevřít kalkulačky', C.links.kalkulacky, 'pmj-btn-primary')])]);
  }
  function shipping() {
    var f = C.facts, kids = [h('p', { class: 'pmj-title', text: T('shipping_title') })];
    if (f) {
      var li = [];
      if (typeof f.min_order_czk === 'number') li.push('Minimální objednávka je ' + kc(f.min_order_czk) + ' (cena zboží s DPH, bez dopravy).');
      if (f.shipping_from) li.push('Doprava stojí od ' + f.shipping_from + '.');
      if (f.cables) li.push(f.cables);
      if (typeof f.free_shipping_from_czk === 'number') li.push('Doprava zdarma od ' + kc(f.free_shipping_from_czk) + '.');
      if (f.payment) li.push(f.payment);
      kids.push(h('ul', { class: 'pmj-ul' }, li.map(function (t) { return h('li', { text: t }); })));
    }
    kids.push(actions([link('Vše o dopravě a platbě', C.links.doprava, 'pmj-btn-primary'), btn('Zeptat se člověka', human)]));
    say(kids);
  }
  function payment() {
    var f = C.facts;
    say([f && f.payment ? p(f.payment) : null, actions([link('Doprava a platba', C.links.doprava, 'pmj-btn-primary'), btn('Zeptat se člověka', human)])]);
  }
  function human() {
    say([p(T('human')), actions([waButton()])]);
  }

  function onText(e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    you(q);
    var intent = detectIntent(q, C.intents || {});
    if (intent === 'doprava') shipping();
    else if (intent === 'platba') payment();
    else if (intent === 'naceneni') { if (getList().length) showList(); showQuote(); }
    else if (intent === 'clovek') human();
    else doSearch(q);
  }

  /* ---------- otevírání / zavírání ---------- */
  function open(source) {
    hideTeaser();
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    root.classList.add('pmj-open');
    document.documentElement.classList.add('pmj-lock');
    fab.setAttribute('aria-expanded', 'true');
    st('sessionStorage', 'opened', '1');
    if (!log.childNodes.length) intro();
    track('jarda_open', { jarda_source: source || 'click' });
    setTimeout(function () { (window.matchMedia && matchMedia('(pointer:coarse)').matches ? panel : input).focus(); }, 30);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    root.classList.remove('pmj-open');
    document.documentElement.classList.remove('pmj-lock');
    fab.setAttribute('aria-expanded', 'false');
    (lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : fab).focus();
  }
  function showTeaser() {
    if (isOpen || st('localStorage', 'noauto') || st('sessionStorage', 'auto')) return;
    st('sessionStorage', 'auto', '1');
    teaser.hidden = false;
  }
  function hideTeaser() { teaser.hidden = true; }
  function noAuto() {
    st('localStorage', 'noauto', '1');
    hideTeaser();
    track('jarda_chip_click', { chip: 'neotevirat_automaticky' });
  }

  function render() {
    var logo = abs(C.logo);
    badge = h('span', { class: 'pmj-badge', 'aria-hidden': 'true', hidden: true });
    fab = h('button', { type: 'button', class: 'pmj-fab', 'aria-label': 'Otevřít poradce ' + C.name, 'aria-expanded': 'false', 'aria-controls': 'pmj-panel',
      onclick: function () { isOpen ? close() : open('click'); } },
      [h('img', { src: logo, alt: '', width: '60', height: '60', decoding: 'async' }), badge]);

    teaser = h('div', { class: 'pmj-teaser', hidden: true }, [
      h('button', { type: 'button', class: 'pmj-teaser-text', onclick: function () { open('teaser'); } }, [h('strong', { text: C.name + ': ' }), T('teaser') || T('greeting')]),
      h('button', { type: 'button', class: 'pmj-teaser-x', 'aria-label': 'Skrýt', text: '×', onclick: hideTeaser }),
      h('button', { type: 'button', class: 'pmj-linkbtn pmj-teaser-off', text: T('no_auto') || 'Neotevírat automaticky', onclick: noAuto })
    ]);

    log = h('div', { class: 'pmj-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    input = h('input', { type: 'text', class: 'pmj-input pmj-q', placeholder: T('input_placeholder'), 'aria-label': 'Zpráva pro poradce', autocomplete: 'off', enterkeyhint: 'send', maxlength: '120' });
    countEl = h('span');
    panel = h('section', { id: 'pmj-panel', class: 'pmj-panel', role: 'dialog', 'aria-modal': 'false', tabindex: '-1', 'aria-labelledby': 'pmj-title', hidden: true }, [
      h('header', { class: 'pmj-head' }, [
        h('img', { class: 'pmj-ava', src: logo, alt: '', width: '40', height: '40' }),
        h('div', { class: 'pmj-who' }, [h('h2', { id: 'pmj-title', class: 'pmj-name', text: C.name }), h('span', { class: 'pmj-role', text: C.role })]),
        h('button', { type: 'button', class: 'pmj-listbtn', onclick: function () { showList(); } }, ['Seznam', countEl]),
        h('button', { type: 'button', class: 'pmj-x', 'aria-label': 'Zavřít poradce', text: '×', onclick: close })
      ]),
      log,
      h('form', { class: 'pmj-bar', onsubmit: onText }, [input, h('button', { type: 'submit', class: 'pmj-go', 'aria-label': 'Odeslat', text: '➜' })]),
      C.auto_open && C.auto_open.enabled ? h('div', { class: 'pmj-foot' }, [h('button', { type: 'button', class: 'pmj-linkbtn', text: T('no_auto') || 'Neotevírat automaticky', onclick: function (e) { noAuto(); e.target.disabled = true; e.target.textContent = 'Automatické otevírání vypnuto'; } })]) : null
    ]);

    root = h('div', { id: 'pmj-jarda', class: 'pmj-root' }, [panel, teaser, fab]);
    document.body.appendChild(root);
    updateCount();

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (isOpen) { e.stopPropagation(); close(); } else if (!teaser.hidden) hideTeaser();
    });

    /* návrat z FormSubmitu */
    var sent = new URLSearchParams(location.search).get('pmj_sent');
    if (sent) {
      var pend = null;
      try { pend = JSON.parse(st('sessionStorage', 'pending') || 'null'); } catch (e) {}
      try { var u = new URL(location.href); u.searchParams.delete('pmj_sent'); history.replaceState(history.state, '', u.href); } catch (e) {}
      if (pend && pend.id === sent) {
        st('sessionStorage', 'pending', null);
        setList([]);
        track('jarda_quote_sent', { lead_id: sent, items_count: pend.n || 0, has_attachment: !!pend.f });
        open('quote_sent');
        say([p(T('quote_sent')), p('Číslo poptávky: ' + sent)]);
        return;
      }
    }

    /* automatické otevření bubliny: max 1× za relaci, nejdřív po X s nebo na N. stránce */
    var a = C.auto_open || {};
    var pv = (+st('sessionStorage', 'pv') || 0) + 1;
    st('sessionStorage', 'pv', String(pv));
    if (a.enabled && !st('localStorage', 'noauto') && !st('sessionStorage', 'auto') && !st('sessionStorage', 'opened')) {
      var delay = pv >= (a.on_pageview || 2) ? 4000 : (a.after_seconds || 20) * 1000;
      setTimeout(showTeaser, delay);
    }
  }

  /* ---------- start: CSS + config, pak vykreslit (nebrzdí načtení webu) ---------- */
  function start() {
    var css = h('link', { rel: 'stylesheet', href: abs('jarda.css', SRC) });
    var cssReady = new Promise(function (res) { css.onload = res; css.onerror = res; setTimeout(res, 4000); });
    document.head.appendChild(css);
    var cfg = fetchJSON(abs('../config.json', SRC), 6000).then(function (j) {
      for (var k in j) {
        if (j[k] && typeof j[k] === 'object' && !Array.isArray(j[k]) && C[k] && typeof C[k] === 'object') { for (var kk in j[k]) C[k][kk] = j[k][kk]; }
        else C[k] = j[k];
      }
    }, function () {});
    Promise.all([cssReady, cfg]).then(function () {
      var o = window.PMJ_CONFIG_OVERRIDE; // jen pro demo.html / testy
      if (o) for (var k in o) C[k] = o[k];
      render();
    });
  }
  function idle() { (window.requestIdleCallback || function (f) { setTimeout(f, 300); })(start, { timeout: 2500 }); }
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
})();
