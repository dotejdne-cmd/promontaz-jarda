/* Záloha při výpadku FormSubmitu (Jarda i /nacenit-material/).
   1) probe(): před odesláním rychle ověří, že formsubmit.co odpovídá. Při výpadku (Cloudflare 522) trvá odpověď ~20 s,
      proto limit 6 s – zákazník neodejde na chybovou stránku.
   2) Když neodpovídá: poptávka se NEODEŠLE a zákazník dostane připravený e-mail na info@ (mailto s kopií poptávky),
      tlačítko pro zkopírování a pokyn přiložit soubory ručně. Nikdy se to nevydává za odeslanou poptávku. */

export function probe(action, ms) {
  return new Promise(function (res) {
    var done = false, ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (!done) { done = true; if (ctl) ctl.abort(); res(false); } }, ms || 6000);
    var origin;
    try { origin = new URL(action).origin; } catch (e) { clearTimeout(t); return res(true); }
    fetch(origin + '/', { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function () { if (!done) { done = true; clearTimeout(t); res(true); } }, function () { if (!done) { done = true; clearTimeout(t); res(false); } });
  });
}

/* Text poptávky z formuláře pro FormSubmit (bez technických polí _… a bez souborů). */
var SKIP = { website: 1, 'Číslo poptávky': 1, 'Přílohy': 1, 'Počet položek ze seznamu': 1 };
export function formText(form) {
  var lines = [], files = [];
  Array.prototype.forEach.call(form.elements, function (el) {
    if (!el.name || el.disabled) return;
    if (el.type === 'file') { Array.prototype.forEach.call(el.files || [], function (f) { files.push(f.name); }); return; }
    if (el.name.charAt(0) === '_' || SKIP[el.name]) return; // technická pole a údaje, které e-mail uvádí zvlášť
    var v = String(el.value || '').trim();
    if (v && v !== '—') lines.push(el.name + ': ' + v);
  });
  return { text: lines.join('\n'), files: files };
}

export function mailto(to, subject, body) {
  var max = 1800; // dlouhé odkazy mailto některé klienty odmítnou
  if (body.length > max) body = body.slice(0, max) + '\n… (zkráceno – celou poptávku vložte ze schránky tlačítkem Zkopírovat)';
  return 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
  return Promise.resolve(legacy());
  function legacy() {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }
}

export function mailBody(id, text, files) {
  return 'Dobrý den,\nposílám poptávku e-mailem, protože formulář na webu se teď nepodařilo odeslat.\n\nČíslo poptávky: ' + id + '\n\n' + text +
    (files.length ? '\n\nPřílohy (přikládám k tomuto e-mailu): ' + files.join(', ') : '') + '\n';
}

/* FormSubmit při klasickém odeslání nepřesměruje na _next (zákazník zůstane na anglické stránce „Thanks“),
   jakmile hodnota pole obsahuje odkaz (http(s):// nebo www.) – ověřeno 7. 11. 2026. Odkazy na vlastní web
   → cesta (/kramle/…), cizí odkazy se rozbijí mezerou (zůstanou čitelné). Technická pole _… se nemění. */
export function noLinks(form) {
  Array.prototype.forEach.call(form.querySelectorAll('input[type=hidden], textarea'), function (el) {
    if (!el.name || el.name.charAt(0) === '_') return;
    el.value = String(el.value).replace(/https?:\/\/(?:www\.)?promontaz\.cz(\/[^\s]*)?/gi, function (m, path) { return path || '/'; })
      .replace(/(https?):\/\//gi, '$1:// ').replace(/\bwww\./gi, 'www .');
  });
}
