/* ProMontaz – Jarda v3: zavaděč. Jediný soubor, který se načítá s každou stránkou.
   Vykreslí ikonu (a případně bublinu) až po načtení stránky v klidu prohlížeče; vše ostatní (panel, hledání,
   formulář, styly) je v jarda-app.min.js, který se stáhne až při najetí na ikonu nebo kliknutí. */
import { st, stJSON, h, abs, fetchJSON, shoptetData, merge } from './util.js';
import { makeTracker } from './track.js';
import { rootOf, wanted, load } from './channel.js';

(function () {
  'use strict';
  if (window.__pmj) return; // už běží jiná verze Jardy (v2 nebo duplicitní řádek) – nespouštět dvakrát
  var VERSION = __VERSION__;
  var SCRIPT = document.currentScript;
  var SRC = (SCRIPT && SCRIPT.src) || location.href;
  var ROOT = rootOf(SRC);
  var W = wanted();
  if (W && W !== VERSION) { load(ROOT, W, function () { load(ROOT, SRC); }); return; } // jiná verze jen pro tento prohlížeč (?pmj_ver=…)
  window.__pmj = 3;
  var Q = location.search;
  var TEST = /[?&]pmj=test(&|$)/.test(Q);
  if (/[?&]pmj=off(&|$)/.test(Q)) return; // ruční vypnutí pro test stránky bez Jardy
  var SD = shoptetData();
  if (/^(billingAndShipping|customerDetails|thankYou)$/.test(SD.pageType || '') || /\/(objednavka|pokladna)\b/i.test(location.pathname)) return;

  var C = {
    __version: VERSION, __test: TEST, enabled: true, name: 'Jarda', role: 'Virtuální poradce', whatsapp: '420722792670', ga4_send_to: 'GA4',
    logo_v3: ROOT + 'assets/jarda-128.webp', logo_fallback: ROOT + 'assets/jarda-160.jpg',
    links: {}, facts: null, auto_open: { enabled: false }, context: {}, texts: { greeting: 'Dobrý den, s čím pomůžu?', no_auto: 'Neotevírat automaticky' }
  };
  var track = makeTracker(function () { return C; });
  var root, fab, badge, teaser, appP = null, app = null;

  var CRIT = '.pmj-root{position:fixed;right:16px;bottom:16px;z-index:9990;font:400 14px/1.45 Inter,Arial,sans-serif;color:#23282D;text-align:left}' +
    '.pmj-root [hidden]{display:none!important}.pmj-root *{box-sizing:border-box}' +
    '.pmj-root .pmj-fab{position:relative;display:block;width:64px;height:64px;margin:0 0 0 auto;padding:0;border:3px solid #E8730C;border-radius:50%;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer}' +
    '.pmj-root .pmj-fab img{display:block;width:58px;height:58px;max-width:none;margin:0;border-radius:50%;object-fit:cover}' +
    '.pmj-root .pmj-fab[aria-busy="true"]{opacity:.7}' +
    '.pmj-root .pmj-fab:focus-visible,.pmj-root .pmj-teaser button:focus-visible{outline:3px solid #E8730C;outline-offset:2px}' +
    '.pmj-root .pmj-badge{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;padding:0 5px;border:2px solid #fff;border-radius:11px;background:#E8730C;color:#fff;font:700 12px/18px Inter,Arial,sans-serif;text-align:center}' +
    '.pmj-root .pmj-teaser{position:relative;width:min(300px,calc(100vw - 32px));margin:0 0 12px auto;padding:14px 38px 10px 14px;border-radius:14px 14px 4px 14px;background:#F3F2EF;box-shadow:0 8px 28px rgba(0,0,0,.18)}' +
    '.pmj-root .pmj-teaser button{font:inherit;color:inherit;background:none;border:0;margin:0;cursor:pointer;text-align:left}' +
    '.pmj-root .pmj-tt{display:block;width:100%;padding:0}' +
    '.pmj-root .pmj-tx{position:absolute;top:4px;right:4px;width:36px;height:36px;padding:0;font-size:22px!important;color:#5F6368!important}' +
    '.pmj-root .pmj-toff{margin-top:6px!important;padding:4px 0!important;font-size:12px!important;color:#5F6368!important;text-decoration:underline}' +
    '@media (max-width:599px){.pmj-root{right:12px;bottom:calc(12px + env(safe-area-inset-bottom))}}@media print{.pmj-root{display:none!important}}';

  function listCount() { var l = stJSON('localStorage', 'list', []); return Array.isArray(l) ? l.length : 0; }
  function updateBadge() { var n = listCount(); badge.textContent = n; badge.hidden = !n; }

  /* Aplikace se stáhne jednou; chyba sítě → záložní nabídka s odkazy, aby zákazník nezůstal bez pomoci. */
  var appCfgP = null;
  function loadApp() {
    /* config.app.json souběžně se skriptem aplikace (ne až po jeho spuštění) – o jednu cestu sítí méně při otevření */
    if (!appCfgP) { appCfgP = fetchJSON(ROOT + 'config.app.json', 6000); appCfgP.catch(function () { appCfgP = null; }); }
    if (!appP) appP = new Promise(function (res, rej) {
      if (window.__pmjApp) return res();
      var s = h('script', { src: ROOT + 'dist/' + VERSION + '/jarda-app.min.js', async: true });
      s.onload = function () { window.__pmjApp ? res() : rej(new Error('app')); };
      s.onerror = rej;
      document.head.appendChild(s);
    }).then(function () {
      app = app || window.__pmjApp({ C: C, SD: SD, root: root, fab: fab, track: track, updateBadge: updateBadge, hideTeaser: hideTeaser, root_url: ROOT, test: TEST, appCfg: appCfgP });
      return app;
    });
    appP.catch(function () { appP = null; });
    return appP;
  }
  function prefetch() { loadApp().catch(function () {}); }

  function openApp(source) {
    fab.setAttribute('aria-busy', 'true');
    return loadApp().then(function (a) { fab.removeAttribute('aria-busy'); a.toggle(source); }, function () {
      fab.removeAttribute('aria-busy');
      fallback();
    });
  }
  function fallback() {
    var l = C.links || {};
    teaser.textContent = '';
    teaser.appendChild(h('p', { text: 'Jarda se teď nenačetl. Pomůžeme vám i tak:' }));
    teaser.appendChild(h('p', {}, [h('a', { href: l.nacenit || '/nacenit-material/', text: 'Nacenit materiál' }), ' · ',
      h('a', { href: 'https://wa.me/' + C.whatsapp, target: '_blank', rel: 'noopener', text: 'WhatsApp' })]));
    teaser.appendChild(h('button', { type: 'button', class: 'pmj-tx', 'aria-label': 'Zavřít', text: '×', onclick: hideTeaser }));
    teaser.hidden = false;
  }

  function teaserText() {
    var t = C.texts || {};
    if (SD.pageType === 'productDetail' && t.teaser_product) return t.teaser_product;
    if (SD.pageType === 'category' && t.teaser_category) return t.teaser_category;
    return t.teaser || t.greeting;
  }
  function showTeaser() {
    if ((app && app.isOpen()) || st('localStorage', 'noauto') || st('sessionStorage', 'auto') || st('sessionStorage', 'opened')) return;
    st('sessionStorage', 'auto', '1');
    teaser.textContent = '';
    teaser.appendChild(h('button', { type: 'button', class: 'pmj-tt', onclick: function () { openApp('teaser'); } }, [h('strong', { text: C.name + ': ' }), teaserText()]));
    teaser.appendChild(h('button', { type: 'button', class: 'pmj-tx', 'aria-label': 'Skrýt nabídku', text: '×', onclick: hideTeaser }));
    teaser.appendChild(h('button', { type: 'button', class: 'pmj-toff', text: C.texts.no_auto || 'Neotevírat automaticky', onclick: function () {
      st('localStorage', 'noauto', '1'); hideTeaser(); track('jarda_noauto', {});
    } }));
    teaser.hidden = false;
    track('jarda_teaser_show', { page_type: SD.pageType || '' });
  }
  function hideTeaser() { if (teaser) teaser.hidden = true; }

  function render() {
    if (C.enabled === false) return; // vzdálené vypnutí v config.json
    document.head.appendChild(h('style', { id: 'pmj-crit', text: CRIT }));
    badge = h('span', { class: 'pmj-badge', 'aria-hidden': 'true', hidden: true });
    var img = h('img', { src: C.logo_v3, alt: '', width: '58', height: '58', decoding: 'async' });
    img.addEventListener('error', function () { if (C.logo_fallback && img.src !== C.logo_fallback) img.src = C.logo_fallback; });
    fab = h('button', { type: 'button', class: 'pmj-fab', 'aria-label': 'Otevřít poradce ' + C.name, 'aria-expanded': 'false', 'aria-controls': 'pmj-panel',
      onclick: function () { openApp('click'); }, onpointerenter: prefetch, onfocus: prefetch }, [img, badge]);
    fab.addEventListener('touchstart', prefetch, { passive: true });
    teaser = h('div', { class: 'pmj-teaser', role: 'status', hidden: true });
    root = h('div', { id: 'pmj-jarda', class: 'pmj-root', 'data-version': VERSION }, [teaser, fab]);
    document.body.appendChild(root);
    updateBadge();
    document.addEventListener('keydown', function (e) { if ((e.key === 'Escape' || e.key === 'Esc') && !(app && app.isOpen())) hideTeaser(); });
    window.addEventListener('storage', function (e) { if (e.key === 'pmj2_list') updateBadge(); });

    /* návrat z FormSubmitu → aplikace ověří číslo poptávky a ukáže poděkování */
    if (/[?&]pmj_sent=/.test(Q)) { loadApp().then(function (a) { a.handleReturn(); }, fallback); return; }

    /* automatická bublina: max 1× za relaci, ne po ručním otevření, ne v košíku (pokud to config nepovolí) */
    var a = C.auto_open || {}, pv = (+st('sessionStorage', 'pv') || 0) + 1;
    st('sessionStorage', 'pv', String(pv));
    var onCart = SD.pageType === 'cart';
    if (a.enabled && !(onCart && !(C.context && C.context.teaser_on_cart)) && !st('localStorage', 'noauto') && !st('sessionStorage', 'auto') && !st('sessionStorage', 'opened')) {
      setTimeout(showTeaser, pv >= (a.on_pageview || 2) ? 4000 : (a.after_seconds || 20) * 1000);
    }
  }

  /* ochrana formuláře /nacenit-material/ při výpadku FormSubmitu – jen na té stránce a jen po zapnutí v config.json */
  function guard() {
    var g = C.formsubmit_guard;
    if (!g || !g.nacenit || !/^\/nacenit-material\//.test(location.pathname) || window.__pmjGuardOn) return;
    var s = h('script', { src: ROOT + 'dist/' + VERSION + '/guard.min.js', async: true });
    s.onload = function () { if (window.__pmjGuard) window.__pmjGuard({ C: C, track: track }); };
    document.head.appendChild(s);
  }

  function start() {
    var o = window.PMJ_CONFIG_OVERRIDE; // jen demo a testy
    fetchJSON(ROOT + 'config.json', 6000).then(function (j) { merge(C, j); }, function () {}).then(function () {
      if (o) merge(C, o);
      C.__version = VERSION; C.__test = TEST;
      guard();
      render();
    });
  }
  function idle() { (window.requestIdleCallback || function (f) { setTimeout(f, 300); })(start, { timeout: 2500 }); }
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
})();
