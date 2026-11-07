# Jarda: prodejní asistent ProMontaz.cz

Lehký průvodce nákupem bez AI a bez placených služeb. Najde materiál v katalogu (fotka, cena s DPH, kód, odkaz), vloží jednoduché produkty do košíku přes Shoptet, sestaví seznam k nacenění a odešle B2B poptávku i s přílohami. Na dotazy k dopravě, platbě, objednávkám a fakturám odpovídá jen texty z configu a odkazy. Nic si nevymýšlí: žádná skladovost, termíny, slevy ani technická doporučení.

| | v2 (dnes v produkci) | v3 (tato větev) |
|---|---|---|
| Soubor ve Shoptetu | `dist/jarda.min.js?v=2` | `dist/3.0.0/jarda.min.js` |
| Stahuje se se stránkou | 23 kB JS (9,6 kB gzip) + config + logo 11,5 kB | zavaděč 8 kB (3,5 kB gzip) + config + logo 2,5 kB |
| Při otevření | CSS 9 kB | aplikace s CSS 43 kB (15,5 kB gzip) + `config.app.json` |
| Měření v GA4 | **nedorazí** (`dataLayer.push`, web nemá GTM) | `gtag('event', …, {send_to: 'GA4'})` |

## Nasazení (dělá majitel, po schválení)

1. Sloučit větev `jarda-v3` do `main`. GitHub Pages zveřejní soubory do `dist/3.0.0/`. **Web se tím nezmění**, Zápatí pořád načítá v2.
2. Ověřit na `https://dotejdne-cmd.github.io/promontaz-jarda/demo.html`.
3. V Shoptetu (**Vzhled a obsah → Editor → HTML kód → Zápatí**) nahradit řádek v2:
   ```html
   <script defer src="https://dotejdne-cmd.github.io/promontaz-jarda/dist/3.0.0/jarda.min.js"></script>
   ```
4. Otestovat na `https://www.promontaz.cz/?pmj=test` podle checklistu níže. V testovacím režimu má předmět e-mailu „TEST –“ a události mají `jarda_test: true`.

**Rollback:** v Zápatí vrátit předchozí řádek, tedy `…/dist/jarda.min.js?v=2` pro v2 nebo starší `dist/<verze>/`. Zveřejněné verze se nikdy nepřepisují (kontroluje CI), takže návrat funguje vždy.
**Okamžité vypnutí bez Shoptetu:** v `config.json` nastavit `"enabled": false`. Projeví se do 10 minut (cache GitHub Pages), v3 se pak nezobrazí. Pro jednu stránku stačí parametr `?pmj=off`.

## Verzování a vydání

- Kód je v `src/`. `npm run build` vytvoří `dist/<verze z package.json>/` (`jarda.min.js` = zavaděč, `jarda-app.min.js` = aplikace se styly).
- **Každá změna kódu = nová verze** v `package.json`, tedy nový adresář a nová adresa v Zápatí. Prohlížeče tak nikdy nemíchají starý a nový kód a cache nevadí.
- `dist/jarda.min.js` a `dist/jarda.css` jsou zmrazená v2 (kontrolní součty v `scripts/build.mjs`). Zdroj v2 je v commitu `1bd35e3` na `main` (lokální tag `v2.0.0`).
- CI (`.github/workflows/test.yml`) při každém push spustí:
  - jednotkové testy,
  - build s rozpočty velikosti (zavaděč ≤ 4 kB gzip, aplikace ≤ 16 kB gzip),
  - kontrolu, že `dist/` odpovídá `src/`,
  - kontrolu, že se zveřejněné verze nezměnily (`check:release`),
  - regresní testy v prohlížeči.

## Úpravy bez programování

| Soubor | Co v něm je | Kdy se stahuje |
|---|---|---|
| `config.json` | Zapnutí/vypnutí, auto-bublina, kontakty, odkazy, fakta o dopravě a platbě, základní texty (sdílené s v2) | se stránkou (~2 kB gzip) |
| `config.app.json` | Pravidla pro rozpoznání dotazů, synonyma, texty v3, nastavení poptávky a košíku | až při otevření Jardy |

- `facts.*`: minimální objednávka (450 Kč), doprava od 133,10 Kč s DPH, kabely jen na adresu, platba. `free_shipping_from_czk` je `null`. Shoptet uvádí 5 999 Kč, zapne se až po potvrzení.
- `intent_rules`: `{záměr: {phrases, words}}`. Fráze má 3 body, slovo 2 body. Jedno slovo ve věcném dotazu (např. „telefonní kabel“) zákazníka nepřesměruje: Jarda hledá produkt a záměr jen nabídne jako tlačítko.
- `synonyms`: jen technicky rovnocenné výrazy. Převzato ze schváleného seznamu promontaz-search v3.
- `cart_add.enabled`: tlačítko „Do košíku“ (jen produkty bez variant, viz níže).
- `quote`: formáty a limity příloh, volby termínu.
- `intents` a `search_replace` v `config.json` čte i v2. Jejich tvar neměňte.

## Funkce v3

**Hledání.**
- Lokální index z promontaz-search: jen čtení, stahuje se až při prvním hledání (~1 MB gzip) a připravuje po dávkách.
- Normalizace rozměrů, diakritiky a koncovek. Čísla se nedoplňují (`m8 ≠ m80`).
- Řazení: přesná shoda v názvu, první slovo, vše v názvu.
- Synonyma a vyhledání podle kódu a EAN.
- Karta produktu: náhled 100×100 ze Shoptetu (`/user/shop/related/`), cena s DPH (u variant „od“), kód, „+ k nacenění“, „Do košíku“ nebo „Vybrat variantu“.
- Bez výsledku: Jarda řekne, které slovo v katalogu není, a výsledky bez něj nabídne jen na kliknutí. Dotaz lze přidat k nacenění.
- Přes 5 výsledků vede odkaz na `/vyhledavani/?string=…`.

**Do košíku.** Volá `shoptet.cartShared.addToCart({productCode, amount: 1})`.
- Jen produkty bez variant a jen pokud Shoptet API na stránce existuje.
- „✓ V košíku“ se ukáže až po události `ShoptetCartUpdated`. Jinak Jarda nabídne otevřít produkt.
- Ověřeno na živém webu (testovací košík).
- Kódy v indexu odpovídají kódům ve Shoptetu (namátkou ověřeno přes Shoptet API).

**Rozpoznání dotazů.** Materiál, B2B nacenění, doprava, platba, existující objednávka, faktura/doklad, obchodník. U nejasného dotazu se Jarda zeptá.

**Kontext stránky.**
- Produkt: čip „Větší množství? Naceníme“ (s množstvím z pole Množství).
- Montážní sada: „Co obsahuje sada“, pouze komponenty uvedené v popisu jako `(SKU …)`.
- Košík: chybějící částka do minima (z dataLayer) a „Poslat košík k nacenění“.
- Automatická bublina: max 1× za relaci, ne v košíku ani v pokladně, kontextový text, trvale vypnutelná.

**B2B poptávka.**
- Viditelná pole: seznam (předvyplněný), přílohy, e-mail nebo telefon, PSČ.
- Pod rozbalením: IČO (s kontrolou), termín, poznámka.
- Přílohy stejně jako ověřený formulář /nacenit-material/: PDF, XLSX, CSV, JPG, PNG, max 10 souborů a 10 MB, kontrola skutečného formátu souboru.
- **ZIP se nepřijímá**: FormSubmit s ním ověřený není a jiný formulář na webu ho také nebere.

**Spolehlivé odeslání.**
- Odesílá se skrytý formulář. Viditelný zůstává, takže návrat tlačítkem Zpět nic nesmaže.
- Rozepsaná poptávka se drží v `sessionStorage` (jen tato karta), seznam v `localStorage`.
- Dvojí odeslání brání zámek tlačítka. Po návratu z bfcache (iOS) se zámek uvolní.
- `jarda_quote_submit` = formulář odeslán. `jarda_quote_accepted` = FormSubmit poptávku přijal a vrátil zákazníka na `?pmj_sent=ID`. To **není** potvrzení doručení do schránky, to ze stránky ověřit nejde.
- Bez návratu do 20 s: při dalším otevření Jarda upozorní („možná se neodeslala“) a seznam zůstává.
- Obnovení stránky s `?pmj_sent` se nezapočítá dvakrát.

**Osobní údaje.** E-mail, telefon, IČO ani poznámka nikdy nejdou do měření. Hledané výrazy se čistí od e-mailů a telefonních čísel. Kontakt se ukládá jen do `sessionStorage` a po přijetí se maže.

## Měření (GA4)

Web nemá GTM, jen gtag.js se skupinou `GA4` (`G-3KY8CWHMHY`) a Google Ads. Jarda posílá události **jen do GA4** (`send_to: 'GA4'`), nikdy do Ads. Poptávky Jardy tak nejsou nákupní konverze. Souběžně jdou i do `dataLayer` (pro případný GTM a testy).

| Událost | Parametry |
|---|---|
| `jarda_open` | `jarda_source` (click/teaser/quote_accepted), `page_type` |
| `jarda_teaser_show`, `jarda_noauto` | `page_type` |
| `jarda_chip_click` | `chip`, `page_type` |
| `jarda_intent` | `intent`, `mode` (direct/mixed/clarify) |
| `jarda_search` | `search_term`, `results_count` (−1 = index nedostupný), `page_type` |
| `jarda_search_no_results` | `search_term`, `missing_term` |
| `jarda_product_click` | `item_id` (kód), `index`, `search_term` |
| `jarda_add_to_list` | `item_source` (search/product/set/cart/free_text/partial), `list_count` |
| `jarda_add_to_cart` | `item_id`, `result` (ok/fail) |
| `jarda_list_view` | `list_count` |
| `jarda_quote_start` | `list_count`, `quote_source` |
| `jarda_quote_submit` | `lead_id`, `items_count`, `attachments_count`, `has_zip`, `has_ico`, `quote_source` |
| `jarda_quote_accepted` | `lead_id`, `items_count`, `attachments_count` |
| `jarda_quote_unconfirmed` | `lead_id` |
| `jarda_whatsapp`, `jarda_contact_click` | `context`, `channel`, `list_count` |

Všechny události mají `jarda_version`. Postup v GA4 a návrh reportu je v [`docs/REPORT.md`](docs/REPORT.md).

## Testy

```bash
npm ci
```
```bash
npm test
```
```bash
npm run build
```
```bash
npm run test:e2e
```
```bash
node test/live/live.cjs
```
```bash
npm run perf
```

- `npm test`: hledání a záměry, 17 testů.
- `npm run test:e2e`: 25 scénářů v Chromiu nad `demo.html` (desktop a mobil, přístupnost axe-core, bez sítě).
- `node test/live/live.cjs`: 11 kontrol na živém promontaz.cz. Web se nemění, poptávka se neodešle.
- `npm run perf`: srovnání bez Jardy / v2 / v3 na živém webu.

## Checklist ručního testu před přepnutím Zápatí

Testujte s `?pmj=test` v anonymním okně.

- [ ] **Skutečná poptávka** s 1 fotkou + 1 XLSX a jen telefonem: e-mail na info@ s předmětem „TEST – Poptávka PM-… – widget Jarda – 2 příl.“, obě přílohy, tabulka polí. Po návratu poděkování a prázdný seznam.
- [ ] Poptávka jen s e-mailem: „Odpovědět“ míří na zákazníka.
- [ ] FormSubmit ukáže kontrolu „nejste robot“: po potvrzení návrat na stejnou stránku. Po zavření bez potvrzení a návratu Jarda ukáže „možná se neodeslala“.
- [ ] Do košíku z výsledků u 2–3 různých produktů (vrut, kabel, chemie). Košík v hlavičce se aktualizuje.
- [ ] iPhone (Safari): otevření, hledání s fotkami, fotka z fotoaparátu, odeslání, Zpět z FormSubmitu.
- [ ] Android (Chrome): totéž. Klávesnice nepřekryje pole.
- [ ] Desktop: Tab a Esc, cookie lišta (ikona pod ní, otevřený panel nad ní).
- [ ] GA4 → Admin → DebugView s `?pmj=test`: přichází `jarda_open`, `jarda_search`, `jarda_quote_accepted`.
- [ ] Google Ads: v Konverzích nepřibyla žádná akce z Jardy.
