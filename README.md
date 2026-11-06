# Jarda: virtuální poradce pro promontaz.cz

Interaktivní průvodce bez AI. Najde materiál v katalogu, sestaví seznam k nacenění a odešle poptávku i s fotkou. Na dotazy k dopravě a platbě odpovídá jen texty z `config.json`. Nahrazuje původní bublinu `promontaz-jarda.js` v1.

- Bez placených služeb a bez knihoven (vanilla JS + CSS). `dist/jarda.min.js` má asi 22 kB.
- Katalog čte z indexu vyhledávání (`https://dotejdne-cmd.github.io/promontaz-search/index.json`), pouze ke čtení. Repo `promontaz-search` se nemění.
- Poptávky jdou přes FormSubmit na `info@promontaz.cz`, stejně jako formulář na `/nacenit-material/`.
- Hosting: GitHub Pages z větve `main`.

## Nasazení do Shoptetu

1. V Shoptetu otevřete **Vzhled a obsah → Editor → HTML kód → Zápatí**.
2. **Smažte** řádek se starým Jardou:
   ```html
   <script src="https://www.promontaz.cz/user/documents/upload/promontaz-jarda.js?v=2" defer></script>
   ```
   (Nechte si ho stranou kvůli rollbacku. Když zůstanou oba, nový Jarda se nespustí, aby se widgety nepraly.)
3. Na stejné místo vložte:
   ```html
   <script defer src="https://dotejdne-cmd.github.io/promontaz-jarda/dist/jarda.min.js?v=2"></script>
   ```
4. Uložte a otevřete web v anonymním okně.

**Rollback:** smažte řádek nového Jardy ze Zápatí. Pokud chcete zpátky starou bublinu, vraťte původní řádek z kroku 2.

**Test na živém webu bez zkreslení poptávek:** přidejte k adrese `?pmj=test`, např. `https://www.promontaz.cz/?pmj=test`. Předmět e-mailu pak začíná „TEST –“ a události v dataLayer mají `jarda_test: true`. E-mail se ale opravdu odešle.

## Úprava textů a pravidel: `config.json`

Stačí upravit `config.json` v GitHubu (tužka → Commit). Žádný build není potřeba. Změna se projeví do 10 minut (cache GitHub Pages).

| Klíč | Co dělá |
|---|---|
| `texts.*` | Všechny věty Jardy (pozdrav, bublina, hlášky hledání, poděkování…). `{n}` a `{x}` jsou čísla doplňovaná automaticky. |
| `facts.min_order_czk` | Minimální objednávka (450). Používá se v odpovědi o dopravě a v hlášce v košíku. |
| `facts.shipping_from` | „Doprava od…“ (133,10 Kč s DPH). |
| `facts.cables` | Věta o kabelech jen na adresu. |
| `facts.free_shipping_from_czk` | Doprava zdarma. Teď `null`, takže se neukazuje. Shoptet i stránka /doprava-platba/ uvádí 5 999 Kč. Pro zapnutí sem napište `5999`. |
| `facts.payment` | Odpověď na dotazy k platbě (převzato ze stránky /doprava-platba/). |
| `links.*` | Odkazy na dopravu, kalkulačky, nacenění a ochranu osobních údajů. |
| `auto_open` | Automatická bublina: `enabled`, `after_seconds` (20), `on_pageview` (2. stránka v relaci). |
| `intents` | Klíčová slova pro volný text: `doprava`, `platba`, `naceneni`, `clovek`. Stačí začátek slova; skloňování se zkracuje automaticky. Co nesedí na žádný záměr, Jarda hledá jako produkt. |
| `search_replace` | Náhrady v hledání, např. `turbošroub` → `turbo šroub`. |
| `whatsapp`, `logo`, `formsubmit_endpoint`, `index_url` | Kontakty a zdroje. |

Widget si nikdy nevymýšlí dostupnost, dodací lhůty, slevy ani technické vlastnosti. Karty produktů ukazují jen název, cenu s DPH a odkaz z indexu. Sklad se nezobrazuje, protože index se staví jednou za noc.

## Jak se chová

- **Spouštěč** vpravo dole (logo `jarda.jpg` z webu). Nezobrazuje se v pokladně (`/objednavka/`, kroky objednávky, děkovná stránka).
- **Automatická bublina** se ukáže nejdřív po 20 s na stránce, nebo už na 2. zobrazené stránce. Nejvýš 1× za relaci (sessionStorage) a ne po ručním otevření. Odkaz „Neotevírat automaticky“ ji vypne natrvalo (localStorage `pmj2_noauto`).
- **Úvod:** Najít materiál / Nacenit seznam nebo fotku / Spočítat spotřebu / Doprava a platba / Napsat člověku.
- **Hledání:** index se stáhne až při prvním hledání (asi 1 MB gzip) a pak zůstává v paměti stránky (a v cache prohlížeče). Normalizace diakritiky a rozměrů (`8x200 = 8×200 = 8 x 200`, `3,5 = 3.5`). Čísla se nedoplňují (`m8 ≠ m80`). Zobrazí se 5 nejlepších výsledků. Když nic nenajde: „Tohle v katalogu nevidím, ale naceníme to. Přidat do seznamu?“
- **Seznam k nacenění** je v localStorage (`pmj2_list`): množství, mazání, přežije přechod mezi stránkami.
- **Nacenění:** seznam (předvyplněný), fotka nebo PDF do 10 MB, e-mail nebo telefon (aspoň jedno), poznámka a honeypot `_honey`. Odesílá se klasickým formulářem na FormSubmit (jen tak projdou přílohy). FormSubmit může ukázat kontrolu „nejste robot“ a pak vrátí zákazníka na stejnou stránku s `?pmj_sent=…`. Jarda ukáže „Děkujeme, ozveme se obvykle do 24 hodin.“ a vyprázdní seznam.
- **Stránka produktu:** název a kód z `dataLayer` (`shoptet.product`), u variant kód z DOM (`.p-code`). Množství se vezme z pole Množství. Čip „Větší množství? Naceníme“ je první.
- **Košík:** hláška „Do minimální objednávky chybí X Kč“. Ověřeno na živém košíku: `shoptet.cartInfo.getNoBillingShippingPrice.withVat` = hodnota zboží s DPH bez dopravy a platby (2× kramle 52 Kč → 104 → „chybí 346 Kč“). Ukáže se jen na `/kosik/`, když jsou v košíku položky. dataLayer se po změně množství přes AJAX neaktualizuje spolehlivě, proto hláška po události `ShoptetCartUpdated` zmizí. Po obnovení stránky se znovu spočítá.
- **WhatsApp:** `https://wa.me/420722792670` s předvyplněnou zprávou, URL aktuální stránky a případně seznamem.

## Měření (window.dataLayer)

| Událost | Parametry |
|---|---|
| `jarda_open` | `jarda_source`: `click` / `teaser` / `quote_sent` |
| `jarda_chip_click` | `chip`: `najit`, `nacenit`, `spotreba`, `doprava`, `clovek`, `produkt`, `neotevirat_automaticky` |
| `jarda_search` | `query` (e-maily a telefonní čísla nahrazeny `[skryto]`), `results_count`, při výpadku indexu `index_error: true` |
| `jarda_add_to_list` | `item_source`: `search` / `product` / `free_text` |
| `jarda_quote_sent` | `lead_id` (PM-RRMMDD-J…), `items_count`, `has_attachment`. Posílá se **až po návratu z FormSubmitu**, ne po kliknutí. |
| `jarda_whatsapp` | `list_count` |

Do událostí se nikdy neposílá e-mail ani telefon. Hlavní metrika je `jarda_quote_sent`: v GTM založte trigger „Vlastní událost = jarda_quote_sent“ a z něj GA4 `generate_lead` (případně konverzi Ads s `transaction_id = lead_id`).

## Zátěž stránky

- Při načtení stránky: `jarda.min.js` (~9,6 kB gzip), `config.json` (~2 kB), logo `jarda.jpg` (11 kB, stejné jako dosud). Start až po události `load` a v klidu prohlížeče (`requestIdleCallback`), takže neovlivní LCP ani první vykreslení.
- Plné styly panelu (`jarda.css`, ~3 kB gzip) se stahují až při najetí na ikonu nebo otevření.
- Katalog (~1 MB gzip) se stahuje jen při prvním hledání. Příprava 15 000 položek běží po dávkách, aby neblokovala stránku.
- Ověřeno na živém promontaz.cz (Playwright): na stránce produktu přibyly jen tři výše uvedené požadavky, bez chyb v konzoli. První hledání trvalo ~0,8 s včetně stažení indexu, další ~50 ms.

## Vývoj

```bash
npm install
```
```bash
npm test
```
```bash
npm run build
```

- `src/main.js`: UI a logika, `src/search.js`: normalizace, hledání, záměry, `src/jarda.css`: styly (vše pod `.pmj-root`, třídy `.pmj-…`).
- `dist/` se commituje. GitHub Actions kontroluje testy a že `dist/` odpovídá `src/`.
- `demo.html`: stránka produktu, kategorie, košíku (pod a nad 450 Kč), nedostupný index, rychlá automatická bublina. Spuštění: `python3 -m http.server` a otevřít `http://localhost:8000/demo.html`. Formulář se v demu neodesílá (`dry_run`), jen simuluje návrat.

## Checklist ručního testu před nasazením

Testujte s `?pmj=test` a s vymazaným localStorage/sessionStorage (anonymní okno).

**Desktop (Chrome / Edge / Firefox)**
- [ ] Dokud zákazník neodklikne cookie lištu Shoptetu, ikona Jardy je pod ní (lišta má přednost). Otevřený panel je nad lištou.
- [ ] Spouštěč vpravo dole nepřekrývá tlačítko „nahoru“, cookie lištu ani košík Merkuru.
- [ ] Klik otevře panel, kurzor je v poli. Esc a × zavřou panel a fokus se vrátí na spouštěč.
- [ ] Tab projde čipy, tlačítka, pole i křížek ve správném pořadí s viditelným rámečkem.
- [ ] Najít materiál: `kramle 10 x 200`, `vrut 5x60`, `CYKY 3x2,5`, `osb 18`, kód `HR_10075` vrátí správné karty s cenou s DPH a odkazem.
- [ ] Nesmysl (`sádrokartonová deska knauf`) ukáže „Tohle v katalogu nevidím…“ a jde přidat jako text.
- [ ] Volný text: `kolik je poštovné` → doprava, `platba kartou` → platba, `faktura na IČO` → nacenění, `chci mluvit s člověkem` → WhatsApp.
- [ ] Seznam: přidat 2–3 položky, změnit množství, smazat, přejít na jinou stránku. Seznam zůstane.
- [ ] Nacenit: bez kontaktu ukáže chybu. Se špatným e-mailem ukáže chybu. Soubor nad 10 MB nebo `.docx` odmítne.
- [ ] Odeslání s fotkou (JPG) a jen s telefonem: e-mail přijde na info@promontaz.cz s předmětem „TEST – Poptávka PM-… – widget Jarda – 1 příl.“, tabulkou a přílohou. Po návratu je poděkování, seznam je prázdný a v dataLayer je `jarda_quote_sent`.
- [ ] Odeslání jen s e-mailem: „Odpovědět“ v e-mailu míří na zákazníkův e-mail.
- [ ] Stránka produktu: čip „Větší množství? Naceníme“ přidá produkt s množstvím z pole Množství. U produktu s variantami se vezme kód vybrané varianty.
- [ ] Košík pod 450 Kč ukáže „Do minimální objednávky chybí X Kč“, nad 450 Kč nic. V pokladně (`/objednavka/…`) se Jarda nezobrazí.
- [ ] Automatická bublina: po 20 s, nebo hned na 2. stránce, jen jednou za relaci. Po „Neotevírat automaticky“ už nikdy.
- [ ] Ve starém widgetu nic nezůstalo (žádné dvě ikony vpravo dole).
- [ ] Konzole bez chyb. Vzhled Merkuru (tlačítka, formuláře, hlavička) beze změny.

**Mobil (Android Chrome)**
- [ ] Panel přes celou obrazovku, nic nepřetéká do strany, stránka pod ním neroluje.
- [ ] Psaní do pole nezoomuje stránku. Klávesnice nepřekryje pole ani tlačítko Odeslat.
- [ ] Výběr fotky z fotoaparátu i galerie a odeslání.
- [ ] Tlačítko WhatsApp otevře aplikaci s předvyplněnou zprávou a URL stránky.

**Safari iOS (iPhone)**
- [ ] Totéž co mobil. Navíc: panel sedí nad spodní lištou Safari (safe-area), × je dosažitelný.
- [ ] Fotka z fotoaparátu (Safari ji díky omezení na JPG/PNG/PDF má převést z HEIC na JPG; pokud ne, formulář ji odmítne s hláškou).
- [ ] Návrat z FormSubmitu ukáže poděkování (sessionStorage funguje i v anonymním panelu).
- [ ] Odkaz na kartě produktu otevře produkt ve stejném okně a seznam po návratu zůstane.

**Zpomalená síť (DevTools → Network → Slow 3G)**
- [ ] Web se načte stejně rychle jako bez Jardy (Jarda startuje až po `load`).
- [ ] První hledání ukáže „Hledám v katalogu…“ a výsledky přijdou do ~45 s (index ~1 MB). Druhé hledání je okamžité.

**Nedostupný index** (DevTools → Network → Block request URL `index.json`)
- [ ] Hledání ukáže „Katalog se teď nepodařilo načíst…“ s tlačítky Přidat do seznamu a WhatsApp. Nacenění funguje dál.
- [ ] Zablokovaný `config.json`: Jarda se ukáže se základními texty, doprava odkazuje jen na stránku /doprava-platba/ (žádná čísla).
