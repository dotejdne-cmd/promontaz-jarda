/* Ověřený nákup: údaje bere Jarda přímo ze stránky produktu v e-shopu (ne z nočního indexu):
   prodejní jednotka („/ bal“), pole Množství (min, max, krok, desetinná místa), parametr „Obsah balení“,
   cena s DPH (microdata itemprop=price), kód (itemprop=sku) a zda má produkt varianty.
   Když něco chybí nebo se neshoduje kód, Jarda do košíku nic nevkládá a nabídne produkt nebo nacenění. */

function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
function n(v) { var x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : null; }
function txt(s) { return String(s || '').replace(/&nbsp;| /g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

export function normUnit(u) {
  u = txt(u).toLowerCase().replace(/\.$/, '');
  if (/^(ks|kus|kusy|kusů)$/.test(u)) return 'ks';
  if (/^(bal|balení|baleni|bal\.)$/.test(u)) return 'bal';
  if (/^(m|bm|metr)$/.test(u)) return 'm';
  if (/^(m2|m²)$/.test(u)) return 'm2';
  return u;
}

/* HTML stránky produktu (Shoptet, šablona Merkur) → údaje, nebo null, když to není stránka produktu */
export function parseProduct(html) {
  html = String(html || '');
  var form = /<form[^>]*id="product-detail-form"[\s\S]*?<\/form>/.exec(html);
  if (!form) return null;
  var f = form[0], out = { code: '', price: null, unit: '', min: 1, max: null, step: 1, dec: 0, pack: null, variants: false };
  var inputs = f.match(/<input[^>]*>/g) || [];
  var amount = inputs.filter(function (t) { return /name="amount"/.test(t) && /type="number"/.test(t); })[0];
  if (amount) {
    out.min = n(attr(amount, 'min')) || 1;
    out.max = n(attr(amount, 'max'));
    out.step = n(attr(amount, 'step')) || 1;
    out.dec = Math.max(0, Math.min(3, n(attr(amount, 'data-decimals')) || 0));
  }
  out.variants = /<select[^>]*name="priceId"/.test(f) || /"hasVariants":\s*true/.test(html);
  var sku = /itemprop="sku"\s+content="([^"]+)"/.exec(f) || /itemprop="sku"\s+content="([^"]+)"/.exec(html);
  if (sku) out.code = sku[1];
  else { var pc = /class="p-code"[\s\S]*?<span>([^<]+)<\/span>/.exec(html); if (pc) out.code = txt(pc[1]); }
  var pr = /itemprop="price"\s+content="([\d.]+)"/.exec(f) || /property="product:price:amount"\s+content="([\d.]+)"/.exec(html);
  if (pr) out.price = n(pr[1]);
  var wrap = /class="p-final-price-wrapper"[\s\S]*?<\/strong>/.exec(html);
  var un = wrap && /class="pr-list-unit"[^>]*>([\s\S]*?)<\/span>/.exec(wrap[0]);
  if (un) out.unit = normUnit(txt(un[1]).replace(/^\//, ''));
  var pk = /Obsah balení[\s\S]{0,200}?<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/.exec(html);
  if (pk) {
    var m = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Zá-žÁ-Ž²0-9]+)/.exec(txt(pk[1]));
    if (m) out.pack = { n: n(m[1]), unit: normUnit(m[2]) };
  }
  return out;
}

function roundTo(x, dec) { var k = Math.pow(10, dec); return Math.round(x * k) / k; }
/* nejbližší povolené množství nahoru podle min a kroku */
export function snap(a, f) {
  var step = f.step || 1, min = f.min || step, dec = f.dec || 0;
  a = Math.max(a || 0, min);
  a = Math.ceil(roundTo(a / step, 6)) * step;
  return roundTo(a, dec);
}

/* Požadavek zákazníka {q, unit} → návrh množství v prodejní jednotce.
   conv: default (bez požadavku), same (stejná jednotka), pack (ks → balení podle „Obsah balení“),
         ask (nelze s jistotou převést – zákazník počet nastaví sám). */
export function plan(f, req) {
  var unit = f.unit || 'ks', q = req && req.q, ru = req && req.unit, a, conv, note = '';
  var pack = f.pack && f.pack.n > 0 ? f.pack : null;
  if (!q) { a = f.min || 1; conv = 'default'; }
  else if (unit === 'bal' && pack && pack.unit === 'ks' && (ru === 'ks' || (!ru && q >= pack.n * 2))) {
    // „200 ks“ u zboží po balení 1000 ks → 1 bal.; holé číslo bez jednotky bereme jako kusy jen tehdy,
    // když je řádově větší než balení (např. 2000 u balení 100 ks) – jinak se ptáme
    a = Math.ceil(q / pack.n); conv = 'pack';
  }
  else if ((ru === unit || (!ru && unit === 'ks')) && !(unit === 'ks' && pack && pack.unit === 'ks' && pack.n > 1)) { a = q; conv = 'same'; }
  else { a = f.min || 1; conv = 'ask'; }
  var amount = snap(a, f);
  if (conv === 'same' && amount !== q) note = 'rounded';
  var over = f.max != null && amount > f.max;
  if (over) amount = f.max;
  return { amount: amount, conv: conv, note: note, over: over, total: f.price != null ? roundTo(f.price * amount, 2) : null };
}

/* Načtení stránky produktu – jen z e-shopu (stejný původ nebo povolená adresa), výsledek se pamatuje. */
var cache = {};
export function fetchProduct(url, allowed, ms) {
  var u;
  try { u = new URL(url, location.href); } catch (e) { return Promise.reject(new Error('url')); }
  var ok = u.origin === location.origin || (allowed || []).some(function (a) { return u.href.indexOf(a) === 0; });
  if (!ok || u.protocol !== 'https:' && u.origin !== location.origin) return Promise.reject(new Error('origin'));
  var key = u.origin + u.pathname;
  if (cache[key]) return cache[key];
  var ctl = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 8000);
  cache[key] = fetch(key, { credentials: u.origin === location.origin ? 'same-origin' : 'omit', signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (h) { var p = parseProduct(h); if (!p) throw new Error('parse'); return p; });
  cache[key].catch(function () { clearTimeout(t); delete cache[key]; });
  return cache[key];
}

export function sameCode(a, b) {
  var k = function (s) { return String(s || '').toLowerCase().replace(/[\s_\-./]/g, ''); };
  return !!a && !!b && k(a) === k(b);
}
