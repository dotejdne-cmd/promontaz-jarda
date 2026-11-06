# Report přínosu Jardy (GA4) a podklady pro SEO

## 1. Jednorázové nastavení v GA4 (15 minut)

1. **Admin → Vlastní definice → Vytvořit vlastní dimenze** (rozsah: Událost):
   `search_term`, `results_count`, `missing_term`, `jarda_source`, `chip`, `intent`, `mode`, `item_source`, `quote_source`, `item_id`, `page_type`, `jarda_version`, `result`, `context`.
   Metriky (rozsah Událost, standardní jednotka): `items_count`, `attachments_count`, `list_count`.
2. **Admin → Události → označit jako klíčovou událost:** `jarda_quote_accepted`.
   `jarda_quote_submit` jako klíčovou neoznačujte. Je to jen pokus o odeslání.
3. **Google Ads: nic neimportovat.** Pokud by tým chtěl poptávky Jardy vidět v Ads, importovat `jarda_quote_accepted` jen jako *sekundární* konverzi v kategorii „Odeslání formuláře pro potenciální zákazníky“, nikdy jako „Nákup“. Nákupní konverze zůstane jediná primární.
4. Pro filtr interních testů: dimenze `jarda_test` (nebo vyloučit události s `jarda_test = true`).

## 2. Týdenní report „Jarda“ (Průzkum → Volný formát / Cesta)

**A. Trychtýř (Průzkum cesty, uzavřený):**
`jarda_open` → `jarda_search` NEBO `jarda_chip_click` → `jarda_add_to_list` → `jarda_quote_start` → `jarda_quote_submit` → `jarda_quote_accepted`.

| KPI | Definice | Proč |
|---|---|---|
| Přijaté poptávky | počet `jarda_quote_accepted` | hlavní metrika |
| Míra dokončení | `accepted / submit` | spolehlivost odeslání (FormSubmit, ověření robota) |
| Neověřená odeslání | počet `jarda_quote_unconfirmed` | kolik poptávek se možná ztratilo |
| Konverze otevření | `accepted / open` | užitečnost Jardy |
| Poptávky s IČO | `submit` s `has_ico = true` | podíl B2B |
| Vložení do košíku | `jarda_add_to_cart` s `result = ok` | přímý nákup z Jardy |
| Nenalezené dotazy | počet `jarda_search_no_results` | mezery v sortimentu a obsahu |

**B. Asistovaný obrat (orientačně):** Segment „Uživatelé s `jarda_open`“ proti ostatním: konverzní poměr nákupu a průměrná objednávka. Je to korelace, ne příčina. Pro skutečný přínos doporučuji později test s kontrolní skupinou (část návštěv bez Jardy).

**C. Kvalita poptávek (mimo GA4):** `lead_id` (PM-RRMMDD-J…) je v předmětu e-mailu. Obchod si v tabulce u každé poptávky Jardy zapíše výsledek (nabídka / objednávka / hodnota). Spojení přes `lead_id` dá skutečnou konverzi poptávka → objednávka a tržby z Jardy, bez osobních údajů v GA4.

## 3. Podklady pro SEO tým (měsíčně)

Průzkum → Volný formát, události `jarda_search` a `jarda_search_no_results`, řádky `search_term`, metrika Počet událostí, posledních 28 dní.

| Tabulka | Filtr | Co s tím |
|---|---|---|
| **Nenalezené dotazy** | `jarda_search_no_results`, řádky `search_term`, `missing_term` | chybějící sortiment, chybějící synonyma (`config.app.json → synonyms`), chybějící slova v názvech produktů |
| **Nejhledanější s výsledky** | `jarda_search`, `results_count > 0` | témata pro kategorie, filtry a obsah (kalkulačky, návody) |
| **Hledáno, ale neprokliknuto** | `jarda_search` bez `jarda_product_click` (srovnat počty podle `search_term`) | slabé názvy nebo fotky produktů, špatné řazení |
| **Prokliky na produkty** | `jarda_product_click`, řádky `item_id`, `index` | produkty, které lidé hledají textem: kandidáti na lepší SEO texty |

Tip: totéž měří i našeptávač (`naseptavac_nic`), proto se vyplatí porovnat obě tabulky nenalezených dotazů.

## 4. Co z GA4 ověřit po nasazení

V3 posílá `gtag('event', …, {send_to: 'GA4'})`. Skupina `GA4` je v konfiguraci gtag na webu (ověřeno v dataLayer). Dokud zákazník neodsouhlasí analytické cookies, posílá GA4 jen anonymní signály podle Consent Mode. Čísla proto budou nižší než skutečnost (GA4 je částečně dopočítává).
