# Audit 3.0.7 → 3.1.0 (19. 11. 2026)

Ověřeno na živém promontaz.cz (desktop a emulace iPhone 13 v Chromiu), v kódu `main` (fe99643), v produkčním indexu promontaz-search (15 883 položek) a v Shoptet API (čtení).

## 1. Stav schopností (před 3.1)

| Schopnost | Stav 3.0.7 | Důkaz | 3.1.0 |
|---|---|---|---|
| A. Katalogové hledání (rozměry, kódy, diakritika, překlepy) | ✅ funkční | e2e + live | ✅ + oprava typu kabelu |
| A. Dotaz s množstvím („200 ks vrut 5x60“) | ❌ 0 výsledků | live: „200 ks vrut konstrukční 3,5x35“ → nic | ✅ |
| A. „cyky-j 3x2,5“ | ❌ 0 výsledků; „cyky-o“ vracel i CYKY-J; „h07v-k“ vracel H07V-U | produkční index | ✅ |
| B. Do košíku | ⚠️ částečně: vždy 1 ks prodejní jednotky, bez informace o jednotce | vrut 3,5x35 za 189 Kč = **balení 1000 ks**, karta to neuváděla | ✅ ověřený nákup (jednotka, balení, min/krok, cena, kód ze stránky produktu) |
| C. Seznam k nacenění | ✅ přidání, množství, mazání | e2e | ✅ + vložení seznamu, jednotky, export CSV |
| C. Upozornění na chybějící počet nebo rozměr | ❌ | – | ✅ |
| D. B2B (IČO, termín, přílohy, PSČ, záměr „větší množství / IČO / výkaz výměr“) | ✅ | e2e | ✅ + nabídka nacenění od 15 000 Kč v nákupu a u seznamu od 8 řádků |
| E. Kalkulačky | ⚠️ jen odkaz na /kalkulacky/ | – | ✅ 12 kalkulaček, nabídka při hledání, API `pmjQueue` pro přenos výsledku |
| F. Doprava | ⚠️ špatná cena (133,10 místo 143,10 Kč), chyběly dřevo, palety, těžké zásilky, doprava zdarma | /doprava-platba/ | ✅ ověřené podmínky |
| Poptávka (FormSubmit, přílohy, výpadek, duplicity) | ✅ velmi dobře ošetřená | 18 e2e scénářů | beze změny |
| Měření GA4 (bez PII, jen GA4, ne Ads, bez `form_*`) | ✅ | e2e + live consent | ✅ + konverzní události nákupu a seznamu |
| Mobil, Esc, fokus, aria-live, axe WCAG 2.1 AA | ✅ | e2e | ✅ (nové prvky v axe testu) |

## 2. Ověřená fakta (zdroj pravdy)

| Údaj | Hodnota | Zdroj |
|---|---|---|
| Minimální objednávka | **450 Kč** s DPH (ne 500 Kč) | košík Shoptetu: „Minimální cena objednávky je 450 Kč včetně DPH“ (testovací košík 104 Kč) |
| Doprava zdarma | **5 999 Kč** | `dataLayer.shoptet.cartInfo.freeShippingFrom = 5999` + /doprava-platba/ (výjimky: dřevo, palety, nadrozměrné) |
| Doprava | 143,10 Kč (do 29,9 kg / box 25 kg), 220 Kč (30–59,9 kg), 330 Kč (od 60 kg), dřevo od 1 000 Kč | /doprava-platba/ |

Pokud interně počítáte s minimem 500 Kč, je potřeba ho nejdřív změnit ve Shoptetu (Nastavení → Košík). Jarda i web pak pojedou podle nové hodnoty: `facts.min_order_czk` v config.json.

Metody dopravy přes Shoptet API ověřit nejdou: `shipping_methods_list` není v doplňku MCP Core dostupný. Ověřeno proto z košíku a ze stránky.

## 3. Nálezy mimo Jardu (prioritizace)

| # | Priorita | Nález | Dopad | Návrh |
|---|---|---|---|---|
| 1 | Vysoká | Index promontaz-search nemá **prodejní jednotku ani obsah balení**. Karty ve vyhledávání webu i v Jardovi ukazují „189 Kč“ u balení 1000 ks bez „/ bal“. | Zákazník nevidí, za co platí; hrozí omyl v množství | V `build-index.mjs` doplnit jednotku a `Obsah balení` (z Heureka feedu / exportu). Jarda pak nebude stahovat stránku produktu a jednotku ukáže už na kartě. Jediný zdroj pravdy pro web, Jardu i kalkulačky. |
| 2 | Vysoká | Hlavní vyhledávání webu (search-v3) najde pro „250 ks vrut 5x60“ **0 výsledků** (stejná chyba, jakou měl Jarda) | Zákazníci, kteří píšou s množstvím, odcházejí | Převzít `src/qty.js` (odstranění množství z dotazu) do promontaz-search. Zatím neupraveno, repo jen čtu. |
| 3 | Střední | Meta description produktů: „— **skladem, rychlá expedice** po celé ČR“ (šablona u vrutů, kramlí), OSB „skladem za výhodnou cenu“ | U dropshippingu jde o neověřený slib ve výsledcích Googlu | Šablonu popisu ve Shoptetu změnit na neutrální („s dopravou po celé ČR“) |
| 4 | Střední | /doprava-platba/: „Skladové zboží expedujeme do 48 hodin“ | Při více dodavatelích riziko nesplněného slibu | Ověřit u dodavatelů; Jarda lhůty záměrně neuvádí |
| 5 | Střední | Úvodní stránka: „Ještě dnes máte nacenění“. Jarda a formuláře: „obvykle do 24 hodin“. | Dva různé sliby | Sjednotit na jeden |
| 6 | Střední | search-v3 „h07v-k 4“ vrací i H07V-U (pevný vodič místo ohebného), „cyky-o“ i CYKYLO-O | Technicky jiný výrobek ve výsledcích | Převzít pravidlo typu za pomlčkou (`src/search.js → tokens`) |
| 7 | Nízká | Kalkulačky nemají cestu „poslat k nacenění“ (jen do košíku) | Větší odběry z kalkulaček nejdou do poptávky | Přidat tlačítko s `pmjQueue` (README → Kalkulačka → Jarda) |
| 8 | Nízká | Cookie lišta na mobilu zakrývá ikonu Jardy do volby cookies | Ponecháno záměrně: souhlas má přednost | – |

## 4. AI integrace (vyhodnocení)

Nezavádím ji. Rozhoduje přesnost katalogu, ne konverzace. Chyby nalezené v tomto auditu (množství, jednotky, typ kabelu) by jazykový model nevyřešil. Spolehlivě je vyřeší jen data (jednotky v indexu) a deterministická pravidla.

AI by přinesla:
- placenou službu (API klíč),
- posílání dotazů zákazníků třetí straně (GDPR, smlouva o zpracování),
- riziko vymyšlených parametrů a cen.

Jediné rozumné využití do budoucna: převod volně psané poptávky nebo fotky výkazu na řádky seznamu na straně obchodníka (interně, bez zákazníka). Vyžaduje schválení nákladů.

## 5. Bezpečnost a osobní údaje (3.1)

- **Stránka produktu:** stahuje se jen ze stejného původu nebo z `shop_base`. Do košíku se nic nevloží, pokud nesouhlasí kód, chybí cena nebo produkt má varianty.
- **`window.PMJ.add` / `pmjQueue`:**
  - názvy jen jako text (test s `<img onerror>`),
  - odkazy jen na e-shop,
  - množství 0–100 000,
  - jednotky z povoleného seznamu,
  - nejvýše 100 položek.
- **Export CSV:** jen položky seznamu, bez kontaktu.
- **Měření:** jen počty, kódy a zdroj. `search_term` se dál čistí od e-mailů a telefonů.

## 6. Vydání 3.1.1 (19. 11. 2026)

| Kontrola | Výsledek |
|---|---|
| Pages: dist/3.1.0, config, kanál = repo | ✅ shodné soubory |
| Testovací režim `pmj_ver` na promontaz.cz (desktop, iPhone 13, Pixel 7 emulace) | ✅ 8/8, 8/8, live 11/11 |
| Skutečný košík Shoptetu: 1 bal. vrutů po 1000 ks, 25 m kabelu | ✅ |
| Skutečné poptávky (TEST, info@): bez přílohy (AJAX) a s PDF + PNG | ✅ přijaty: PM-261119-JPA9040, PM-261119-J4QVZZE (3.1.0), PM-261119-J9KB8V5 (3.1.1) |
| GA4 příkazy gtag: 11 typů událostí, 1 akce = 1 událost, jen GA4, bez osobních údajů, bez duplicity po obnovení | ✅ |
| GA4 síť: poptávka s přílohou posílala `form_start`/`form_submit` | ❌ v 3.0.7 i 3.1.0 → opraveno v 3.1.1 (0×) |
| Kontrola dostupnosti FormSubmitu (6 s), služba odpovídala za 5–6 s | ❌ falešné „neodpovídá“ → 12 s |
| Doprava: Shoptet v pokladně PPL / DPD / box 143,10 Kč s DPH | ✅ Jarda správně. **Web /doprava-platba/ chybně uvádí „120 Kč bez DPH“**: správně 118,26 Kč (143,10 / 1,21). Ostatní řádky sedí. |
| Pokladna nabízí „Individuální doprava dřeva 1 000 Kč“ i u košíku bez dřeva (jen vruty) | ⚠️ nastavení Shoptetu, mimo Jardu |
| iPhone Safari (WebKit) a skutečný Android | ⚠️ neotestováno: v prostředí je jen Chromium (emulace iPhone 13 / Pixel 7) |
