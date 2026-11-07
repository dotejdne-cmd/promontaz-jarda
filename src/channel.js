/* Kanál verzí: jediný řádek v Zápatí (dist/stable/jarda.min.js) bez přepisování HTML při aktualizaci.
   – výchozí verzi určuje obsah dist/stable/jarda.min.js (build podle package.json → jarda.stable),
   – jen tento prohlížeč: ?pmj_ver=3.0.0 (uloží do localStorage), ?pmj_ver=2 (v2), ?pmj_ver=reset (zpět na výchozí).
   Přepnutí načte jinou verzi z TÉHOŽ repa (jen dist/<x.y.z>/ nebo v2), nic jiného nejde podstrčit. */
var KEY = 'pmj_ver', OK = /^(2|\d{1,3}\.\d{1,3}\.\d{1,3})$/;

export function rootOf(src) { var i = src.indexOf('/dist/'); return i > -1 ? src.slice(0, i + 1) : src.replace(/[^/]*$/, ''); }

/* → požadovaná verze pro tento prohlížeč, nebo '' = výchozí */
export function wanted() {
  var v = '';
  try {
    var m = /[?&]pmj_ver=([^&#]*)/.exec(location.search);
    if (m) {
      var q = decodeURIComponent(m[1]);
      if (q === window.__pmjBadVer) q = 'reset'; // tato verze se právě nenačetla – znovu nezkoušet (jinak smyčka)
      if (q === 'reset' || q === 'off' || q === '') localStorage.removeItem(KEY);
      else if (OK.test(q)) localStorage.setItem(KEY, q);
    }
    v = localStorage.getItem(KEY) || '';
  } catch (e) {}
  return OK.test(v) ? v : '';
}

export function urlOf(root, v) { return v === '2' ? root + 'dist/jarda.min.js?v=2' : root + 'dist/' + v + '/jarda.min.js'; }

/* vloží skript jiné verze; ta už dál nepřepíná (stejná verze = pokračuje) */
export function forget() { try { localStorage.removeItem(KEY); } catch (e) {} }

/* onerr: zvolená verze neexistuje / nenačte se → zapomenout volbu a pokračovat výchozí verzí */
export function load(root, v, onerr) {
  var s = document.createElement('script');
  s.src = typeof v === 'string' && v.indexOf('/') > -1 ? v : urlOf(root, v);
  if (onerr) s.onerror = function () { window.__pmjBadVer = v; forget(); onerr(); };
  s.defer = true;
  s.setAttribute('data-pmj-channel', v);
  (document.body || document.head).appendChild(s);
}
