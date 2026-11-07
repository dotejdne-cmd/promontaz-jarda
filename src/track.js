/* Měření. Web používá přímý gtag.js (bez GTM), proto se události posílají:
   1) gtag('event', …, {send_to: 'GA4'}) – jen do GA4 (skupina „GA4“ z konfigurace Shoptetu), nikdy do Google Ads,
   2) window.dataLayer.push({event: …}) – pro případný budoucí GTM a pro demo/testy.
   Nikdy se neposílá e-mail, telefon, jméno ani text poznámky. */

export var EVENTS = ['jarda_open', 'jarda_teaser_show', 'jarda_chip_click', 'jarda_intent', 'jarda_search', 'jarda_search_no_results',
  'jarda_product_click', 'jarda_add_to_list', 'jarda_add_to_cart', 'jarda_list_view', 'jarda_quote_start', 'jarda_quote_submit',
  'jarda_quote_accepted', 'jarda_quote_unconfirmed', 'jarda_quote_fallback', 'jarda_quote_fallback_click', 'jarda_whatsapp', 'jarda_contact_click', 'jarda_noauto'];

var PII = [/\S+@\S+\.\S+/g, /(\+?420[\s-]?)?\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g];
export function clean(v) {
  if (typeof v !== 'string') return v;
  for (var i = 0; i < PII.length; i++) v = v.replace(PII[i], '[skryto]');
  return v.slice(0, 100);
}

export function makeTracker(cfg) {
  return function track(name, params) {
    var c = cfg() || {}, o = {}, k;
    for (k in params || {}) if (params[k] !== undefined) o[k] = clean(params[k]);
    o.jarda_version = c.__version;
    if (c.__test) o.jarda_test = true;
    try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: name }, o)); } catch (e) {}
    var to = c.ga4_send_to;
    if (to && typeof window.gtag === 'function') {
      try { o.send_to = to; window.gtag('event', name, o); } catch (e) {}
    }
  };
}
