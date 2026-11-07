/* Ochrana formuláře /nacenit-material/ (pmq) při výpadku FormSubmitu. Načítá se jen na té stránce a jen když je
   v config.json zapnuto formsubmit_guard.nacenit. Kód formuláře se nemění: formulář odesílá přes
   HTMLFormElement.prototype.submit.call(…), tady se volání obalí kontrolou služby. Když FormSubmit neodpovídá,
   nic se neodešle, zákazník zůstane na stránce s vyplněnými údaji a dostane připravený e-mail na info@. */
import { probe, formText, mailto, copyText, mailBody } from './fallback.js';

window.__pmjGuard = function (X) {
  if (window.__pmjGuardOn) return;
  window.__pmjGuardOn = 1;
  var proto = HTMLFormElement.prototype, orig = proto.submit, track = X.track, to = (X.C.contact && X.C.contact.email) || 'info@promontaz.cz';
  proto.submit = function () {
    var f = this;
    if (f.__pmjOk || !/^https:\/\/formsubmit\.co\//.test(f.action || '')) return orig.call(f);
    probe(f.action, 6000).then(function (ok) {
      if (!ok) { showBox(f); return; }
      if (!(X.C.formsubmit_guard && X.C.formsubmit_guard.nacenit_ajax)) { f.__pmjOk = 1; orig.call(f); return; }
      /* AJAX režim: FormSubmit odpoví {"success":"true"} bez reCAPTCHA stránky a bez závislosti na _next;
         po potvrzení se zákazník vrátí na vlastní české poděkování formuláře (hodnota _next, např. ?odeslano=ID). */
      var next = f.querySelector('[name="_next"]'), ctl = window.AbortController ? new AbortController() : null;
      var tmo = setTimeout(function () { if (ctl) ctl.abort(); }, 90000);
      fetch(String(f.action).replace(/^(https:\/\/formsubmit\.co\/)(?!ajax\/)/, '$1ajax/'), { method: 'POST', body: new FormData(f), headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          clearTimeout(tmo);
          if (res.ok && res.j && (res.j.success === true || res.j.success === 'true')) { location.href = next && next.value ? next.value : location.pathname + '?odeslano=1'; return; }
          showBox(f, 'rejected', res.j && res.j.message);
        }, function () { clearTimeout(tmo); showBox(f, 'unknown'); });
    });
  };

  function showBox(f, kind, msg) {
    var ft = formText(f), idEl = f.querySelector('[name="Číslo poptávky"]'), id = idEl ? idEl.value : 'bez čísla';
    var body = mailBody(id, ft.text, ft.files), subj = (/[?&]pmq=test/.test(location.search) ? 'TEST – ' : '') + 'Poptávka ' + id + ' (záložní e-mail)';
    if (f.parentNode) f.parentNode.removeChild(f);
    track('jarda_quote_fallback', { lead_id: id, reason: kind === 'unknown' ? 'no_response' : kind === 'rejected' ? 'service_rejected' : 'service_down', attachments_count: ft.files.length, form: 'nacenit' });
    var host = document.getElementById('pmq') || document.getElementById('poptavka') || document.body;
    // Tlačítko formuláře záměrně neodblokováváme: formulář má vnitřní stav „odesílám“ a znovu by neodeslal.
    // Zákazník dostane e-mail, nebo pokyn obnovit stránku (formulář si text sám uloží).
    var old = document.getElementById('pmj-guard-box'); if (old) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.id = 'pmj-guard-box'; box.setAttribute('role', 'alert'); box.tabIndex = -1;
    box.style.cssText = 'margin:16px 0;padding:16px;border:2px solid #E8730C;border-radius:10px;background:#FFF8F1;color:#23282D;font:15px/1.5 Inter,Arial,sans-serif';
    var head = kind === 'unknown' ? 'Nepodařilo se ověřit, zda poptávka dorazila (odesílací služba neodpověděla). Pro jistotu ji můžete poslat e-mailem.'
      : kind === 'rejected' ? 'Odesílací služba poptávku nepřijala. Poptávka NEBYLA odeslána.' : 'Odesílací služba teď neodpovídá. Poptávka NEBYLA odeslána.';
    box.innerHTML = '<p style="margin:0 0 8px;font-weight:700" class="pmj-gh"></p>' +
      '<p style="margin:0 0 8px">Vyplněné údaje zůstávají ve formuláři. Pošlete nám poptávku prosím e-mailem – připravili jsme ho za vás, stačí ho odeslat ze svého e-mailu.</p>' +
      (ft.files.length ? '<p style="margin:0 0 8px">Přílohy do e-mailu přiložte ručně: <strong class="pmj-gf"></strong>.</p>' : '') +
      '<p style="margin:0;display:flex;flex-wrap:wrap;gap:8px"><a class="pmj-gm" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#E8730C;color:#fff;font-weight:700;text-decoration:none">Otevřít připravený e-mail</a>' +
      '<button type="button" class="pmj-gc" style="padding:10px 14px;border-radius:8px;border:1px solid #CFCAC0;background:#fff;font:inherit;font-weight:700;cursor:pointer">Zkopírovat poptávku</button></p>' +
      '<p style="margin:8px 0 0;font-size:13px">Adresa: ' + to + ' · telefon 722 792 670. Chcete to zkusit formulářem znovu později? Obnovte stránku – vyplněný text zůstane, přílohy bude potřeba vybrat znovu.</p>';
    box.querySelector('.pmj-gh').textContent = head + (msg ? ' (' + String(msg).slice(0, 120) + ')' : '');
    if (ft.files.length) box.querySelector('.pmj-gf').textContent = ft.files.join(', ');
    var a = box.querySelector('.pmj-gm'); a.href = mailto(to, subj, body);
    a.addEventListener('click', function () { track('jarda_quote_fallback_click', { lead_id: id, channel: 'email', form: 'nacenit' }); });
    var c = box.querySelector('.pmj-gc');
    c.addEventListener('click', function () { copyText(body).then(function (ok) { c.textContent = ok ? '✓ Zkopírováno' : 'Kopírování nefunguje – použijte e-mail'; }); track('jarda_quote_fallback_click', { lead_id: id, channel: 'copy', form: 'nacenit' }); });
    host.insertBefore(box, host.firstChild);
    try { box.scrollIntoView({ block: 'center' }); } catch (e) {}
    box.focus({ preventScroll: true });
  }
};
