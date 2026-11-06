/* Vyhledávání v indexu promontaz-search (jen čtení index.json).
   Pravidla převzatá z promontaz-search v3: čísla se nedoplňují (m8 ≠ m80, 18 ≠ 180),
   rozměry jen ve správném pořadí (120x5000 najde 120/120/5000), stejné číslo v jiném zápisu se najde (1,50 = 1.5). */

var UNIT = /(\d)\s*(mm2|mm²|mm|cm|kg|ml|ks|m)(?![a-z0-9])/g;
var STOP = {};
'a i na do pro s se z ze v ve k ke o od po u za chci potrebuji potreboval hledam hledat mate mam nejaky nejake nejakou prosim dobry den jak kde co'
  .split(' ').forEach(function (w) { STOP[w] = 1; });
var UNITS = { mm: 1, mm2: 1, cm: 1, m: 1, kg: 1, ml: 1, ks: 1, l: 1 };
var DIM = /^\d+(\.\d+)?(x\d+(\.\d+)?)+$/;
var NUM = /^\d+(\.\d+)?$/;

export function norm(s) {
  s = String(s || '').toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[×✕*]/g, 'x')
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

export function buildIndex(data) {
  var base = data.base || '', cats = data.cats || [], manus = data.manus || [];
  return (data.items || []).map(function (it) {
    var cat = String(cats[it[6]] || '').split('|').pop();
    return {
      n: it[0], u: base + it[1], p: typeof it[3] === 'number' ? it[3] : null, v: !!it[8],
      c: String(it[5] || '').split(' ')[0] || '',
      ck: String(it[5] || '').split(' ').map(codeKey).filter(Boolean),
      nt: tokens(it[0]),
      ot: tokens([manus[it[4]] || '', cat, it[9] || ''].join(' '))
    };
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

function tokMatch(q, t) {
  if (DIM.test(q)) return DIM.test(t) && dimMatch(q, t);
  if (NUM.test(q)) return numEq(q, t) || (DIM.test(t) && t.split('x').some(function (p) { return numEq(q, p); }));
  if (/\d/.test(q)) return q === t || (t.indexOf(q) === 0 && t.charAt(q.length) === 'x' && /\d/.test(t.charAt(q.length + 1)));
  return q.length >= 2 && t.indexOf(q) === 0;
}

function score(item, qt) {
  var s = 0;
  for (var i = 0; i < qt.length; i++) {
    var q = qt[i], best = 0;
    for (var a = 0; a < item.nt.length; a++) if (tokMatch(q, item.nt[a])) { best = item.nt[a] === q ? 4 : 3; break; }
    if (!best) for (var b = 0; b < item.ot.length; b++) if (tokMatch(q, item.ot[b])) { best = 1; break; }
    if (!best) return 0;
    s += best;
  }
  return s;
}

/* zkrácení české koncovky (šroubů → sroub, hmoždinky → hmozdink) – jen u slov, ne u čísel */
function stem(t) {
  if (/\d/.test(t) || t.length < 4) return t;
  var s = t.replace(/(ich|ych|ech|ami|ach|emi|ovi|ove|ou|em|ho|mu)$/, '').replace(/[aeiouy]+$/, '');
  return s.length >= (t.length < 5 ? 3 : 4) ? s : t;
}

export function search(idx, query, limit, replace) {
  limit = limit || 5;
  if (replace) {
    var nq = ' ' + norm(query) + ' ';
    for (var r in replace) nq = nq.split(' ' + norm(r) + ' ').join(' ' + norm(replace[r]) + ' ');
    query = nq.trim();
  }
  var key = codeKey(query), out = [];
  if (key.length >= 4) {
    for (var c = 0; c < idx.length; c++) if (idx[c].ck.indexOf(key) > -1) out.push({ it: idx[c], s: 1e6 });
    if (out.length) return { results: out.slice(0, limit).map(function (r) { return r.it; }), total: out.length };
  }
  var qt = tokens(query);
  if (!qt.length) return { results: [], total: 0 };
  var passes = [qt, qt.map(stem)];
  for (var p = 0; p < passes.length; p++) {
    if (p && passes[1].join() === qt.join()) break;
    out = [];
    for (var i = 0; i < idx.length; i++) {
      var s = score(idx[i], passes[p]);
      if (s) out.push({ it: idx[i], s: s });
    }
    if (out.length) break;
  }
  out.sort(function (a, b) { return b.s - a.s || a.it.n.length - b.it.n.length; });
  return { results: out.slice(0, limit).map(function (r) { return r.it; }), total: out.length };
}

/* rozpoznání záměru z config.json → klíč záměru nebo '' */
export function detectIntent(text, intents) {
  var qt = norm(text).split(/[^a-z0-9]+/).filter(Boolean), joined = ' ' + qt.join(' ') + ' ';
  for (var k in intents) {
    var words = intents[k] || [];
    for (var i = 0; i < words.length; i++) {
      var w = norm(words[i]).trim();
      if (!w) continue;
      if (w.indexOf(' ') > -1) { if (joined.indexOf(' ' + w) > -1) return k; continue; }
      w = stem(w);
      for (var j = 0; j < qt.length; j++) if (qt[j].indexOf(w) === 0) return k;
    }
  }
  return '';
}

/* do měření nikdy e-mail ani telefon */
export function safeQuery(q) {
  return String(q || '').replace(/\S+@\S+/g, '[skryto]').replace(/\+?\d[\d\s]{7,}\d/g, '[skryto]').slice(0, 100);
}
