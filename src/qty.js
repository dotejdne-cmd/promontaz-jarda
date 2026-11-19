/* Množství v dotazu a vložený seznam materiálu.
   „200 ks vrut 5x60“, „vrut 5x60 – 200 ks“, „20× OSB 18“, „kabel CYKY 3x2,5 50 m“ → {q, unit, query}.
   Rozměry (8x200, 3x2,5) se za množství nikdy nepovažují. kg, l a ml se nebere jako množství:
   u stavební chemie jde skoro vždy o velikost balení („lepidlo 25 kg“, „silikon 310 ml“). */

var UNIT_RE = '(ks|kusu|kusy|kus|bal|baleni|bm|m2|m|metru|metry|metr|role|roli|rol|paru|pary|par|palet|palety|paleta)';
var UNIT_MAP = { ks: 'ks', kus: 'ks', kusy: 'ks', kusu: 'ks', bal: 'bal', baleni: 'bal', m: 'm', bm: 'm', metr: 'm', metru: 'm', metry: 'm', m2: 'm2',
  role: 'role', roli: 'role', rol: 'role', par: 'pár', paru: 'pár', pary: 'pár', paleta: 'paleta', palety: 'paleta', palet: 'paleta' };
export var UNITS = ['ks', 'bal', 'm', 'm2', 'role', 'pár', 'paleta'];

function flat(s) {
  s = String(s || '').toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/²/g, '2').replace(/[×✕]/g, 'x');
}
function num(t) { var n = parseFloat(String(t).replace(',', '.')); return isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 1000) / 1000 : 0; }
function hasWord(s) { return /[a-z]{2,}/.test(flat(s)); }

/* Vrací {q, unit, query} – q = 0, pokud dotaz množství neobsahuje. query je původní text bez množství (s diakritikou). */
export function parseQty(raw) {
  var orig = String(raw || '').replace(/\s+/g, ' ').trim(), s = flat(orig), m;
  var out = { q: 0, unit: '', query: orig };
  function cut(from, to) { var r = (orig.slice(0, from) + ' ' + orig.slice(to)).replace(/\s+/g, ' ').replace(/^[\s\-–:,;]+|[\s\-–:,;]+$/g, ''); return r; }
  // 1) na začátku s jednotkou: „200 ks vrut…“, „3 bal. hmoždinky“, „50m kabel“
  if ((m = new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*' + UNIT_RE + '\\.?\\s+(?=\\S)').exec(s)) && hasWord(s.slice(m[0].length))) {
    return { q: num(m[1]), unit: UNIT_MAP[m[2]], query: cut(0, m[0].length) };
  }
  // 2) na začátku „20×“ / „20x“ / „20 x“ / „20*“ před slovem (ne před číslem – to je rozměr)
  if ((m = /^(\d+(?:[.,]\d+)?)\s*[x*]\s*(?=[a-z])/.exec(s)) && hasWord(s.slice(m[0].length))) {
    return { q: num(m[1]), unit: '', query: cut(0, m[0].length) };
  }
  // 3) na konci s jednotkou: „vrut 5x60 200 ks“, „… - 20 ks“, „kabel 3x2,5 50m“
  if ((m = new RegExp('(?:^|[\\s\\-–:,;]|\\t)(\\d+(?:[.,]\\d+)?)\\s*' + UNIT_RE + '\\.?$').exec(s)) && hasWord(s.slice(0, m.index))) {
    // „x 200 ks“ za rozměrem je pořád množství; „5x60“ samo ne (to by nesplnilo vzor – před číslem musí být mezera nebo oddělovač)
    var start = m.index + m[0].search(/\d/);
    return { q: num(m[1]), unit: UNIT_MAP[m[2]], query: cut(start, s.length) };
  }
  // 4) na konci „… 200×“ (jen s mezerou před číslem; „… x 200“ se nebere – nedá se odlišit od rozměru)
  if ((m = /\s(\d+(?:[.,]\d+)?)\s*x$/.exec(s)) && hasWord(s.slice(0, m.index))) {
    return { q: num(m[1]), unit: '', query: cut(m.index, s.length) };
  }
  // 5) na začátku holé číslo před slovem: „200 vrut 5x60“ (jednotku neznáme → v košíku se ptáme)
  if ((m = /^(\d+(?:[.,]\d+)?)\s+(?!(?:mm2?|cm|kg|ml|mm²)\b)(?=[a-z]{2,})/.exec(s)) && hasWord(s.slice(m[0].length))) {
    return { q: num(m[1]), unit: '', query: cut(0, m[0].length) };
  }
  return out;
}

/* Vložený seznam (řádky, středníky, tabulka z Excelu) → položky s množstvím a upozorněním. */
export function parseLines(text, max) {
  max = max || 50;
  var lines = String(text || '').replace(/\r/g, '').split(/\n|;/), out = [];
  for (var i = 0; i < lines.length && out.length < max; i++) {
    var raw = lines[i].replace(/ /g, ' ').trim();
    if (!raw) continue;
    var cells = raw.split('\t').map(function (c) { return c.trim(); }).filter(Boolean);
    var line = cells.join(' ');
    line = line.replace(/^\s*(?:[-•*·–]|\d{1,3}[.)])\s+/, ''); // odrážky a číslování „1.“, „2)“
    if (!hasWord(line)) continue;
    var r = parseQty(line);
    // Excel: „vrut 5x60 | 200“ (poslední buňka je jen číslo)
    if (!r.q && cells.length > 1 && /^\d+(?:[.,]\d+)?$/.test(cells[cells.length - 1])) r = { q: num(cells[cells.length - 1]), unit: '', query: cells.slice(0, -1).join(' ') };
    r.raw = line;
    r.warn = [];
    if (!r.q) r.warn.push('qty');
    out.push(r);
  }
  return out;
}

export function qtyLabel(q, unit) {
  if (!q) return '';
  var n = String(q).replace('.', ',');
  return unit ? n + ' ' + unit : n + '×';
}
