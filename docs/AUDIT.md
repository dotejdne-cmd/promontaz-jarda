# Audit v2 (produkce k 6. 11. 2026) → změny ve v3

| # | Zjištění v2 | Dopad | Řešení v3 |
|---|---|---|---|
| 1 | Události se posílají jen `dataLayer.push({event})`, ale web **nemá GTM**, jen gtag.js | Události Jardy se do GA4 **s vysokou pravděpodobností nedostanou** (gtag posílá jen příkazy `gtag('event')`). Ověřte v GA4 → Přehledy → Události, zda existuje `jarda_open`. | `gtag('event', …, {send_to:'GA4'})` + dataLayer; nikdy do Ads |
| 2 | Při načtení stránky se stahuje celý widget (23 kB JS) + logo 11,5 kB | zbytečná zátěž u 100 % návštěv | zavaděč 8 kB (3,5 kB gzip) + logo WebP 2,5 kB; aplikace až při interakci |
| 3 | Záměr podle prvního nalezeného slova („telefon“, „faktura“) | chybné přesměrování (např. „telefonní kabel“ → WhatsApp, „nabídka OSB“ → formulář) | bodování frází a slov, zbytek dotazu rozhoduje; nejasné → otázka |
| 4 | Faktura = nacenění | zákazník s dotazem na doklad dostal poptávkový formulář | samostatné záměry: B2B / faktura k objednávce / stav objednávky |
| 5 | Karty bez fotky, bez kódu, jen „+ do seznamu“ | horší orientace, žádná cesta k přímému nákupu | náhled 100×100, kód, „Do košíku“ (ověřeno přes Shoptet API), varianty → odkaz |
| 6 | Bez výsledků jen obecná hláška | ztráta zákazníka | které slovo chybí + výsledky bez něj na kliknutí + nacenění |
| 7 | Formulář: 1 příloha, bez PSČ/IČO/termínu | slabší B2B poptávky, doptávání | až 10 příloh (PDF/XLSX/CSV/JPG/PNG, 10 MB, kontrola formátu), PSČ, IČO s kontrolou, termín |
| 8 | Odesílal se viditelný formulář; po Zpět z FormSubmitu může tlačítko zůstat „Odesílám…“ (bfcache, hlavně iOS – neověřeno na zařízení) | zablokovaná opakovaná poptávka | skrytý formulář, odblokování po `pageshow` |
| 9 | Bez návratu z FormSubmitu nic | ztracené poptávky bez stopy | `jarda_quote_unconfirmed` + upozornění zákazníka, seznam zůstává |
| 10 | Rozepsaný text formuláře se ztratil při zavření/přechodu | ztráta práce zákazníka | koncept v sessionStorage, obnoví se |
| 11 | Jeden soubor `dist/jarda.min.js` + ruční `?v=` | riziko staré cache, rollback jen „smazat řádek“ | verzované adresáře `dist/<verze>/`, neměnné (CI), rollback = předchozí adresa |
| 12 | Vypnutí jen úpravou Shoptetu | pomalá reakce při problému | `config.json → enabled: false` (do 10 min), `?pmj=off` |
| 13 | Testy jen hledání | regrese UI nezachytí | 25 scénářů v prohlížeči + axe-core + test na živém webu + výkon |
| 14 | Cookie lišta na mobilu zakrývá ikonu do odsouhlasení (v2 i v3) | Jarda dostupný až po volbě cookies | ponecháno záměrně – lišta má přednost (souhlas), otevřený panel je nad ní |

## Vědomě neděláno (a proč)

- **ZIP přílohy**: FormSubmit s nimi není ověřený a formulář /nacenit-material/ je také nebere. Zákazník dostane jasnou hlášku (soubory jednotlivě nebo odkaz v poznámce).
- **Do košíku u variant**: index slučuje varianty a nemá jejich kódy. Varianta se vybírá na stránce produktu.
- **Skladovost, dodací lhůty**: index se staví jednou za noc a sklad v něm nemá autoritativní hodnotu. Jarda je nikde neuvádí.
- **Související produkty** mimo montážní sady: Shoptet je na stránce nevypisuje a vymýšlet je nesmíme. Montážní sady používají jen SKU z vlastního popisu.
- **Doprava zdarma** (Shoptet uvádí 5 999 Kč): čeká na potvrzení majitele (`facts.free_shipping_from_czk`).
