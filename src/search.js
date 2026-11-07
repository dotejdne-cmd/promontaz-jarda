/* Vyhledávání v indexu promontaz-search (index.json jen čteme, repo promontaz-search se nemění).
   Pravidla převzatá z promontaz-search v3: čísla se nedoplňují (m8 ≠ m80, 18 ≠ 180),
   rozměry jen ve správném pořadí (120x5000 najde 120/120/5000), stejné číslo v jiném zápisu se najde (1,50 = 1.5).
   Synonyma jen technicky rovnocenná (z config.json), nikdy se nepárují odlišné výrobky. */

var UNIT = /(\d)\s*(mm2|mm²|mm|cm|kg|ml|ks|m)(?![a-z0-9])/g;
export var STOP = {};
('a i na do pro s se z ze v ve k ke o od po u za x chci potrebuji potrebuju potreboval hledam hledat sehnat mate mam nejaky nejake nejakou prosim ' +
  'dobry den jak kde co cena cenu levne levny koupit prodej eshop kus kusy bal').split(' ').forEach(function (w) { STOP[w] = 1; });
var UNITS = { mm: 1, mm2: 1, cm: 1, m: 1, kg: 1, ml: 1, ks: 1, l: 1 };
var DIM = /^\d+(\.\d+)?(x\d+(\.\d+)?)+$/;
var NUM = /^\d+(\.\d+)?$/;

export function norm(s) {
  s = String(s || '').toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/²/g, '2').replace(/[×✕*]/g, 'x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*\/\s*(?=\d)/g, '$1x')
    .replace(UNIT, '$1 ');
  var prev;
  do { prev = s; s = s.replace(/(\d)\s*x\s*(\d)/g, '$1x$2'); } while (s !== prev);
  return s;
}

export function tokens(s) {
  return norm(s).split(/[^a-z0-9.x]+/).map(function (t) { return t.replace(/^\.+|\.+$/g, ''); })
    .filter(function (t) { return t && !STOP[t] && !UNITS[t]; });
}

function codeKey(s) { return String(s || '').toLowerCase().replace(/[\s_\-./]/g, ''); }

function mkItem(data) {
  var base = data.base || '', cats = data.cats || [], manus = data.manus || [];
  return function (it) {
    var cat = String(cats[it[6]] || '').split('|').pop().trim();
    var codes = String(it[5] || '').split(' ').filter(Boolean);
    return {
      n: it[0], u: base + it[1], i: it[2] || '', p: typeof it[3] === 'number' ? it[3] : null, v: !!it[8],
      c: codes[0] || '', cat: cat,
      ck: codes.map(codeKey),
      nt: tokens(it[0]),
      ot: tokens([manus[it[4]] || '', cat, it[9] || ''].join(' '))
    };
  };
}

export function buildIndex(data) { return (data.items || []).map(mkItem(data)); }

/* Totéž po dávkách, aby příprava 15 000 položek neblokovala stránku (mobil). */
export function buildIndexAsync(data, chunk) {
  var items = data.items || [], f = mkItem(data), out = [], i = 0;
  chunk = chunk || 1500;
  return new Promise(function (res) {
    (function step() {
      var end = Math.min(items.length, i + chunk);
      for (; i < end; i++) out.push(f(items[i]));
      if (i < items.length) setTimeout(step, 0); else res(out);
    })();
  });
}

function numEq(a, b) { return a === b || (NUM.test(a) && NUM.test(b) && +a === +b); }

/* rozměr z dotazu musí být podposloupností rozměru položky (ve stejném pořadí, každé pole přesně) */
function dimMatch(q, t) {
  var qp = q.split('x'), tp = t.split('x'), j = 0;
  if (qp.length > tp.length) return false;
  for (var i = 0; i < tp.length && j < qp.length; i++) if (numEq(qp[j], tp[i])) j++;
  return j === qp.length;
}

function tokMatch(q, t, strict) {
  if (DIM.test(q)) return DIM.test(t) && dimMatch(q, t);
  if (NUM.test(q)) return numEq(q, t) || (DIM.test(t) && t.split('x').some(function (p) { return numEq(q, p); }));
  if (/\d/.test(q)) return q === t || (t.indexOf(q) === 0 && t.charAt(q.length) === 'x' && /\d/.test(t.charAt(q.length + 1)));
  if (strict) return t === q || (q.length >= 4 && t.indexOf(q) === 0); // synonyma: „zb“ nesmí chytit „zbytek“
  return q.length >= 2 && t.indexOf(q) === 0;
}

/* zkrácení české koncovky (šroubů → sroub, hmoždinky → hmozdink) – jen u slov, ne u čísel */
export function stem(t) {
  if (/\d/.test(t) || t.length < 4) return t;
  var s = t.replace(/(ich|ych|ech|ami|ach|emi|ovi|ove|ou|em|ho|mu)$/, '').replace(/[aeiouy]+$/, '');
  return s.length >= (t.length < 5 ? 3 : 4) ? s : t;
}

/* synonyma z configu → {normalizovaný klíč: [alternativy]} */
export function prepSynonyms(syn) {
  var out = {};
  for (var k in syn || {}) out[norm(k).trim()] = [].concat(syn[k]).map(function (s) { return norm(s).trim(); }).filter(Boolean);
  return out;
}
function alternatives(q, syn) {
  var alts = [[q, false]];
  if (/\d/.test(q)) return alts;
  for (var k in syn) {
    if (k === q || (k.length >= 5 && q.indexOf(k) === 0)) syn[k].forEach(function (a) { alts.push([a, true]); });
  }
  return alts;
}

/* skóre položky: 0 = nevyhovuje (každé slovo dotazu musí něco najít) */
function score(item, qa) {
  var s = 0, inName = 0;
  for (var i = 0; i < qa.length; i++) {
    var best = 0;
    for (var x = 0; x < qa[i].length && best < 5; x++) {
      var q = qa[i][x][0], strict = qa[i][x][1], pen = x ? 1 : 0;
      for (var a = 0; a < item.nt.length; a++) {
        var t = item.nt[a];
        if (tokMatch(q, t, strict)) { var v = (t === q ? 5 : 3) - pen + (a === 0 && i === 0 ? 2 : 0); if (v > best) best = v; }
      }
      if (!best) for (var b = 0; b < item.ot.length; b++) if (tokMatch(q, item.ot[b], strict)) { best = 1; break; }
    }
    if (!best) return 0;
    if (best > 1) inName++;
    s += best;
  }
  if (inName === qa.length) s += 3; // vše v názvu, ne jen v doplňkových slovech
  return s;
}

function run(idx, qt, syn) {
  var qa = qt.map(function (q) { return alternatives(q, syn); }), out = [];
  for (var i = 0; i < idx.length; i++) {
    var s = score(idx[i], qa);
    if (s) out.push({ it: idx[i], s: s });
  }
  out.sort(function (a, b) { return b.s - a.s || a.it.n.length - b.it.n.length || (a.it.n < b.it.n ? -1 : 1); });
  return out;
}

function replaceAll(query, replace) {
  if (!replace) return query;
  var nq = ' ' + norm(query).replace(/\s+/g, ' ') + ' ';
  for (var r in replace) nq = nq.split(' ' + norm(r).trim() + ' ').join(' ' + norm(replace[r]).trim() + ' ');
  return nq.trim();
}

/* opts: {limit, replace, synonyms (připravená přes prepSynonyms)}
   → {results, total, query, missing: [slova bez shody], partial: {without, results, total} | null} */
export function search(idx, query, opts) {
  opts = opts || {};
  var limit = opts.limit || 5, syn = opts.synonyms || {};
  query = replaceAll(query, opts.replace);
  var res = { results: [], total: 0, missing: [], partial: null };
  var key = codeKey(query);
  if (key.length >= 4 && (!/\s/.test(query.trim()) || (/\d/.test(key) && /^[a-z0-9\s_\-./]+$/i.test(query) && query.trim().split(/\s+/).length <= 2))) {
    var exact = idx.filter(function (it) { return it.ck.indexOf(key) > -1; });
    if (exact.length) { res.results = exact.slice(0, limit); res.total = exact.length; res.exact = true; return res; }
  }
  var qt = tokens(query);
  if (!qt.length) return res;
  var out = run(idx, qt, syn);
  if (!out.length) {
    var st = qt.map(stem);
    if (st.join() !== qt.join()) { out = run(idx, st, syn); if (out.length) qt = st; }
  }
  res.total = out.length;
  res.results = out.slice(0, limit).map(function (r) { return r.it; });
  if (out.length) return res;

  /* Nic nenalezeno: které slovo samo nic nenajde, a co by se našlo bez něj (zákazník si vybere, nic se nedomýšlí). */
  res.missing = qt.filter(function (q) { return !run(idx, [stem(q)], syn).length; });
  if (qt.length > 1) {
    var drop = res.missing.length ? res.missing : qt.slice().reverse(), best = null;
    for (var d = 0; d < drop.length; d++) {
      var rest = qt.filter(function (q) { return q !== drop[d]; });
      if (!rest.length) continue;
      var o = run(idx, rest.map(stem), syn);
      if (o.length && (!best || rest.length > best.q.length)) best = { q: rest, without: drop[d], o: o };
    }
    if (best) res.partial = { without: best.without, query: best.q.join(' '), total: best.o.length, results: best.o.slice(0, limit).map(function (r) { return r.it; }) };
  }
  return res;
}

/* Náhled 100×100 ze Shoptetu. Index má „orig/x.png?ts“ nebo „big/x.png?ff=1&x=1024…&ts=…&sg=…“ (podepsaná velikost);
   z obou → <base>x.png?ts (bez podpisu, jinak Shoptet vrátí 404 nebo velký obrázek). */
export function thumbUrl(path, base) {
  if (!base || !path) return '';
  var m = /^(?:orig|big|detail|related)\/([^?]+)(?:\?(.*))?$/.exec(path);
  if (!m) return '';
  var ts = '';
  if (m[2]) { var t = /(?:^|&)ts=([^&]+)/.exec(m[2]); ts = t ? t[1] : (/^[0-9a-f]{6,12}$/.test(m[2]) ? m[2] : ''); }
  return base + m[1] + (ts ? '?' + ts : '');
}
