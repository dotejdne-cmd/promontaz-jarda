# Jarda: prodejní asistent ProMontaz.cz

Lehký průvodce nákupem bez AI a bez placených služeb. Najde materiál v katalogu (fotka, cena s DPH, kód, odkaz), vloží jednoduché produkty do košíku přes Shoptet, sestaví seznam k nacenění a odešle B2B poptávku i s přílohami. Na dotazy k dopravě, platbě, objednávkám a fakturám odpovídá jen texty z configu a odkazy. Nic si nevymýšlí: žádná skladovost, termíny, slevy ani technická doporučení.

**Stav (19. 11. 2026):** zákazníci mají **3.0.7** (kanál `stable`). **3.1.0** je testovací verze, zapnete ji jen ve svém prohlížeči přes `?pmj_ver=3.1.0` (viz [Novinky 3.1](#novinky-31)).

| | v2 (dřív v produkci) | v3 |
|---|---|---|
| Soubor ve Shoptetu | `dist/jarda.min.js?v=2` | `dist/stable/jarda.min.js` (kanál) |
| Stahuje se se stránkou | 23 kB JS (9,6 kB gzip) + config + logo 11,5 kB | zavaděč 8 kB (3,5 kB gzip) + config + logo 2,5 kB |
| Při otevření | CSS 9 kB | aplikace s CSS 43 kB (15,5 kB gzip) + `config.app.json` |
| Měření v GA4 | **nedorazí** (`dataLayer.push`, web nemá GTM) | `gtag('event', …, {send_to: 'GA4'})` |

## Nasazení: jeden řádek v Zápatí napořád

Zápatí bude mít jediný řádek, **kanál** `dist/stable/jarda.min.js`:
```html
<script defer src="https://dotejdne-cmd.github.io/promontaz-jarda/dist/stable/jarda.min.js"></script>
```
- Kanál dnes ukazuje na **v2**, takže zákazníci po výměně řádku nepoznají rozdíl (malý stub 0,6 kB gzip, který načte v2).
- **Test jiné verze jen ve vašem prohlížeči:** otevřete `https://www.promontaz.cz/?pmj_ver=3.0.7`. Volba se uloží do localStorage tohoto prohlížeče a platí na všech stránkách, dokud ji nezrušíte přes `?pmj_ver=reset`. `?pmj_ver=2` vynutí v2. Neexistující verze se sama vrátí na výchozí. Ostatní zákazníci nic nepoznají.
- `?pmj=test` jen označí testovací poptávky (předmět „TEST –“, `jarda_test` v měření). Verzi nevybírá. Pro test v3 použijte obojí: `?pmj_ver=3.0.7&pmj=test`.
- **Přepnutí všech zákazníků** (bez úpravy Shoptetu): v `package.json` nastavit `"jarda": {"stable": "3.0.4"}`, spustit `npm run build` a commitnout do `main`. Do 10 minut (cache GitHub Pages) mají všichni v3. Kanál je pak kopie zavaděče v3, takže nepřibude žádný požadavek navíc.
- **Rollback:** `"stable": "2"` (nebo předchozí verze), build a commit. Do 10 minut je zpět. Nouzově: `config.json → "enabled": false` vypne v3, nebo v Zápatí vrátit přímo `…/dist/jarda.min.js?v=2`.
- Dvě instance nevzniknou: každá verze se ukončí, pokud už Jarda na stránce běží (`window.__pmj`), i kdyby v Zápatí zůstal i starý řádek.

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

- `facts.*`: minimální objednávka (450 Kč, ověřeno v košíku Shoptetu 19. 11. 2026), doprava od 143,10 Kč s DPH, kabely jen na adresu, platba. `free_shipping_from_czk` zůstává `null`, protože 3.0.x by vypsala hranici bez výjimek.
- `shipping` (config.app.json, čte 3.1+): ověřená pravidla dopravy z /doprava-platba/ (hmotnost, dřevo, palety), doprava zdarma od 5 999 Kč **s výjimkami** (`free_note`) a datum ověření `verified`. Build odmítne dopravu zdarma bez výjimek a bez data ověření. Na webu má přednost hodnota ze Shoptetu (`cartInfo.freeShippingFrom`).
- `calculators`: 12 kalkulaček z /kalkulacky/ s klíčovými slovy. Hledání „osb 18“ nabídne kalkulačku OSB.
- `cart_add.b2b_hint_from_czk`: od této částky (15 000 Kč) Jarda v nákupním řádku nabídne nacenění. Nic neslibuje, žádné slevy.
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

## Novinky 3.1

Zaměřeno na dokončený nákup a kvalitní poptávky, ne na nové chatovací funkce.

- **Množství v dotazu.** „200 ks vrut 5x60“, „kabel CYKY 3x2,5 50 m“, „20× OSB 18“. Dřív takový dotaz nenašel nic (číslo 200 se bralo jako rozměr).
- **Ověřený nákup (Do košíku).** Před vložením Jarda načte stránku produktu v e-shopu a převezme z ní jednotku (`/ bal`, `/ m`), parametr „Obsah balení“, min/krok/max pole Množství, cenu s DPH a kód. Pak:
  - „250 ks“ u vrutů po 1000 ks převede na **1 bal.**,
  - zobrazí cenu celkem a hlídá min/krok,
  - u nejasné jednotky se zeptá.
  Bez ověření (jiný kód, chyba sítě, varianty) se do košíku nic nevloží a Jarda nabídne odkaz na produkt. Index se staví jednou za noc a jednotky ani balení nemá, proto se čte stránka. Ověřeno na živém webu: do skutečného košíku Shoptetu šlo 1 bal. VR_10005 a 25 m kabelu.
- **Vložený seznam materiálu.** Čip „Vložit seznam materiálu“ nebo vložení víceřádkového textu do pole (i tabulka z Excelu). Každý řádek se dohledá v katalogu a označí: nalezeno / upřesněte rozměr nebo typ / mimo katalog / chybí počet. Jedním tlačítkem jde vše k nacenění: nalezené jako konkrétní produkt, ostatní jako text.
- **Export seznamu.** CSV pro Excel (středník, UTF-8) a kopírování. Jen položky, žádné kontaktní údaje.
- **Kalkulačky.** Čip „Spočítat spotřebu“ vypíše 12 kalkulaček. Hledání nabídne odpovídající kalkulačku. Kalkulačky mohou výsledek poslat Jardovi, viz níže.
- **Doprava.** Ověřené podmínky: 143,10 / 220 / 330 Kč podle hmotnosti, dřevo individuálně od 1 000 Kč, palety individuálně, zdarma od 5 999 Kč s výjimkami, kabely jen na adresu. Žádné dodací lhůty ani slib společné expedice.
- **Hledání: typ kabelu.** „cyky-j 3x2,5“ dřív nenašel nic a „cyky-o 3x1,5“ vracel i CYKY-J. Stejně tak „h07v-k“ vracel i H07V-U (pevný místo ohebného). Opraveno. Na 45 běžných dotazech nad produkčním indexem se jinak výsledky nezměnily.
- **Rychlost.** Katalog se začne stahovat s prvním napsaným znakem, ne až po Enteru. Aplikace se stahuje až při interakci: 23,8 kB gzip (dřív 18 kB). Zavaděč na každé stránce má 4,03 kB gzip (dřív 3,96 kB).
- **Oprava v šabloně Merkur.** Šablona skrývá nativní zaškrtávací políčka. Jarda je teď vynucuje vlastním stylem.

### Kalkulačka → Jarda (bez opisování)

Do skriptu kalkulačky ve Shoptetu přidejte tlačítko „Poslat k nacenění“ s tímto voláním. Funguje, i když se Jarda ještě nenačetl:
```js
function poslatJardovi(polozky) { // [{n: 'OSB 2500/1250/18 RH', c: 'J_00076', u: '/osb-desky/osb-2500-1250-18-rh/', q: 14, un: 'ks'}]
  (window.pmjQueue = window.pmjQueue || []).push({ items: polozky, source: 'kalk-osb' });
}
```
- Jarda položky vyčistí (jen text, odkazy jen na promontaz.cz, nejvýše 100 položek), přidá je do seznamu a otevře seznam.
- Do měření jde jen `jarda_api_add` se zdrojem a počtem.
- Kalkulačky dnes vkládají do košíku samy (`cartShared.addToCart`, počet balení). Tohle je doplněk pro větší odběry a poptávky.

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
| `jarda_add_to_cart` | `item_id`, `result` (ok/fail), `quantity`, `qty_conversion` (default/same/pack/ask) |
| `jarda_cart_verify` | `item_id`, `result` (ok/variant/mismatch/error), `qty_conversion` |
| `jarda_list_import` | `lines`, `matched`, `ambiguous`, `unmatched`, `missing_qty` |
| `jarda_list_export` | `format` (csv/copy), `list_count` |
| `jarda_calc_click` | `calc`, `from` (chip/search) |
| `jarda_api_add` | `api_source` (např. kalk-osb), `items_added` |
| `jarda_list_view` | `list_count` |
| `jarda_quote_start` | `list_count`, `quote_source` |
| `jarda_quote_submit` | `lead_id`, `items_count`, `attachments_count`, `has_zip`, `has_ico`, `quote_source` |
| `jarda_quote_accepted` | `lead_id`, `items_count`, `attachments_count` |
| `jarda_quote_unconfirmed` | `lead_id` |
| `jarda_whatsapp`, `jarda_contact_click` | `context`, `channel`, `list_count` |

Všechny události mají `jarda_version`. Postup v GA4 a návrh reportu je v [`docs/REPORT.md`](docs/REPORT.md).

**Obchodní konverze (doporučení pro GA4 → Administrace → Klíčové události):**

| Cíl | Událost | Poznámka |
|---|---|---|
| Poptávka přijata | `jarda_quote_accepted` | hlavní metrika; `lead_id` páruje s e-mailem na info@ |
| Zboží v košíku | `jarda_add_to_cart` s `result = ok` | v GA4 přes „Vytvořit událost“ (podmínka `result = ok`) jako `jarda_cart_ok` |
| Předání obchodníkovi | `jarda_whatsapp`, `jarda_contact_click` | kontakt mimo web |
| Kvalita hledání | `jarda_search_no_results`, `jarda_list_import.unmatched` | co v katalogu chybí |

Hledání → klik na produkt → košík: `jarda_search` → `jarda_product_click` / `jarda_cart_verify` → `jarda_add_to_cart`. Duplicity nevznikají: `jarda_quote_sent` jde jen do `dataLayer` (kompatibilita s v2), ne do GA4. Shoptet při vložení do košíku posílá vlastní `add_to_cart`, ten Jarda nijak nezdvojuje.

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

- `npm test`: hledání, záměry, množství a seznam, nákupní údaje ze **skutečných stránek produktů** (`test/fixtures/*.html.gz`). 34 testů.
- `npm run test:e2e`: 47 scénářů v Chromiu nad `demo.html` (desktop a mobil, přístupnost axe-core, bez sítě).
- `node test/live/local.cjs` (`MOBILE=1` pro iPhone): **nenasazená** verze z tohoto repa na živém promontaz.cz. Podstrčí se jen v testovacím prohlížeči. Obsahuje ověřený nákup do skutečného košíku Shoptetu (bez objednávky), vložený seznam a dopravu. 8 kontrol.
- `node test/live/live.cjs`: 11 kontrol na živém promontaz.cz. Web se nemění, poptávka se neodešle.
- `node test/live/channel.cjs`: kanál se skutečnými soubory z Pages. Nové Zápatí se simuluje jen v testovacím prohlížeči.
- `node test/live/consent.cjs`: GA4 před a po souhlasu s cookies (gcs, měřicí ID, nic do Ads, žádné `form_*`, žádné osobní údaje).
- `npm run perf`: srovnání bez Jardy / v2 / v3 na živém webu.

## Checklist ručního testu 3.1.0 (před přepnutím stable)

Testujte na `https://www.promontaz.cz/?pmj_ver=3.1.0&pmj=test`. Zpět na výchozí verzi: `?pmj_ver=reset`.

- [ ] Telefon: „250 ks vrut konstrukční 3,5x35 zz“ → Do košíku → nabídne **1 bal. (1000 ks) = 189 Kč** → Vložit → košík v hlavičce ukáže 1 bal.
- [ ] Telefon: „kabel cyky-j 3x2,5 25 m“ → 25 m. „cyky-o 3x1,5“ → jen CYKY-O.
- [ ] Produkt s variantami (např. MAMUT GLUE FLEXI) → jen „Vybrat variantu“, nic do košíku.
- [ ] „Vložit seznam materiálu“: zkopírovat 5–10 řádků z Excelu → zaškrtávací políčka jsou vidět → Přidat vše k nacenění → poptávka (jen telefon) → e-mail na info@ s položkami a jednotkami.
- [ ] Seznam → „Stáhnout pro Excel (CSV)“ → otevřít v Excelu, diakritika a sloupce jsou v pořádku (iPhone: soubor se uloží do Souborů).
- [ ] Doprava a platba: texty odpovídají /doprava-platba/ (143,10 / 220 / 330 Kč, dřevo, palety, zdarma od 5 999 Kč s výjimkami).
- [ ] Pomalá síť (Chrome DevTools → Slow 4G): hledání do ~7 s, ověření balení ~1–2 s. Při výpadku katalogu jde vše dál k nacenění.
- [ ] GA4 DebugView: `jarda_cart_verify`, `jarda_add_to_cart` (result ok), `jarda_list_import`, `jarda_quote_accepted`.
- [ ] Přepnutí všem: `package.json → "jarda": {"stable": "3.1.0"}`, `npm run build`, commit do `main`. Rollback: zpět `"3.0.7"`.

## Checklist ručního testu před přepnutím Zápatí (3.0)

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
