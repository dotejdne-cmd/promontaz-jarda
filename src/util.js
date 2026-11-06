/* Sdílené pomůcky pro zavaděč i aplikaci. */
export var P = 'pmj2_'; // prefix úložiště – stejný jako v2, seznam k nacenění zůstane zákazníkovi i po přechodu na v3

export function st(kind, k, v) {
  try {
    var s = window[kind];
    if (v === undefined) return s.getItem(P + k);
    if (v === null) s.removeItem(P + k); else s.setItem(P + k, v);
  } catch (e) { return null; }
  return null;
}
export function stJSON(kind, k, fallback) {
  try { var v = JSON.parse(st(kind, k) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; }
}

export function h(tag, props, kids) {
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

export function abs(u, base) { try { return new URL(u, base || location.href).href; } catch (e) { return u; } }

export function fetchJSON(url, ms) {
  var ctl = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
  return fetch(url, ctl ? { signal: ctl.signal, credentials: 'omit' } : { credentials: 'omit' }).then(function (r) {
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }, function (e) { clearTimeout(timer); throw e; });
}

/* Shoptet dataLayer: poslední objekt se klíčem „shoptet“ */
export function shoptetData() {
  var dl = window.dataLayer || [];
  for (var i = dl.length - 1; i >= 0; i--) if (dl[i] && dl[i].shoptet) return dl[i].shoptet;
  return {};
}

/* Hluboké sloučení configu: objekty se slučují, pole a hodnoty přepisují. */
export function merge(dst, src) {
  for (var k in src || {}) {
    var v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v);
    else dst[k] = v;
  }
  return dst;
}
