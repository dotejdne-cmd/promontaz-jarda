/* Rozpoznání záměru bez AI. Pravidla jsou v config.json (intent_rules):
   {záměr: {phrases: [...], words: [...]}} – fráze = 3 body, slovo = 2 body (stačí začátek slova, koncovky se zkracují).
   Jedno slovo samo nestačí, pokud v dotazu zůstanou další věcná slova nebo čísla (např. „kabel na adresu“, „doprava dřeva 4 m“):
   pak se hledá produkt a záměr se jen nabídne jako tlačítko. Při shodě dvou záměrů se Jarda zeptá. */
import { norm, stem } from './search.js';

var FILLER = {};
('a i na do pro s se z ze v ve k ke o od po u za je jsou jak kdy kde co kolik jaky jaka jake proc muzu mohu lze jde da dat ' +
  'chci chtel chtela potrebuji potrebuju prosim dobry den dekuji diky mi me mne mate mam bych by byste jste to ten ta ty tu ' +
  'vas vam nas nam muj moje moji svoje stoji stoj cena cenu ceny info informace nejak nejaky nejake taky take uz jeste hned dnes zitra ' +
  'zda jestli bude budu muze mohl mohla ok ano ne asi treba nebo ani')
  .split(' ').forEach(function (w) { FILLER[w] = 1; });

function words(text) { return norm(text).split(/[^a-z0-9]+/).filter(Boolean); }

export function prepRules(rules) {
  var out = {};
  for (var k in rules || {}) {
    var r = rules[k] || {};
    out[k] = {
      phrases: (r.phrases || []).map(function (p) { return words(p).join(' '); }).filter(Boolean),
      words: (r.words || []).map(function (w) { return stem(words(w).join('')); }).filter(function (w) { return w.length >= 2; })
    };
  }
  return out;
}

/* → {intent: '' | klíč, mode: 'direct' | 'mixed' | 'clarify' | 'search', alt: [další záměry], score} */
export function classify(text, rules) {
  var w = words(text), joined = ' ' + w.join(' ') + ' ', used = {}, scores = {};
  for (var k in rules) {
    var s = 0, r = rules[k];
    r.phrases.forEach(function (p) {
      if (joined.indexOf(' ' + p + ' ') > -1 || (joined.indexOf(' ' + p) > -1 && p.length >= 6)) { s += 3; p.split(' ').forEach(function (x) { used[x] = 1; }); }
    });
    w.forEach(function (t) {
      for (var i = 0; i < r.words.length; i++) if (t.indexOf(r.words[i]) === 0 && (t.length - r.words[i].length) <= 4) { s += 2; used[t] = 1; break; }
    });
    if (s) scores[k] = s;
  }
  var keys = Object.keys(scores).sort(function (a, b) { return scores[b] - scores[a]; });
  if (!keys.length) return { intent: '', mode: 'search', alt: [], score: 0 };
  var leftover = w.filter(function (t) { return !used[t] && !FILLER[t]; });
  var hasNum = leftover.some(function (t) { return /\d/.test(t); });
  var best = keys[0], bs = scores[best], second = keys[1] ? scores[keys[1]] : 0;
  if (second && second === bs && !leftover.length) return { intent: best, mode: 'clarify', alt: keys.slice(0, 3), score: bs };
  if (!leftover.length) return { intent: best, mode: 'direct', alt: keys.slice(1, 3), score: bs };
  if (bs >= 3 && !hasNum && leftover.length <= 1) return { intent: best, mode: 'direct', alt: keys.slice(1, 3), score: bs };
  return { intent: best, mode: 'mixed', alt: keys.slice(1, 3), score: bs };
}
