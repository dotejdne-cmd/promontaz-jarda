# Výkon v2 × v3 3.0.3 (živý promontaz.cz, 7. 11. 2026)

`npm run perf`: varianty Zápatí načtené stejně (přepis HTML v testovacím prohlížeči), soubory ze skutečných GitHub Pages. Emulace Pixel 7, CPU 4×, 9 Mb/s / 170 ms, 5 běhů, neplatné běhy vyřazeny. Uvádím medián a rozsah (min–max). Tři série měření (6.–7. 11.) daly stejné závěry.

| Metrika | bez Jardy | v2 (dřívější Zápatí) | v3 3.0.3 (kanál stable) |
|---|---:|---:|---:|
| LCP ms | 2308 (1836–2484) | 2456 (2116–2484) | 2904 / 1828 v jiné sérii (1788–2904) |
| CLS | 0,001–0,052 | 0,052 | 0,049–0,052 |
| TBT ms (celá stránka) | 1509 (934–2630) | 2542 (1238–2788) | 2182–3179 (794–6927) |
| Požadavky Jardy při načtení | 0 | 3 | 3 |
| kB Jardy při načtení (přenos) | 0 | 23 | 13 |
| INP ms (klik na ikonu + hledání) | – | 136–160 (128–200) | 40–144 (40–160) |
| Klik → panel ms | – | 500–951 (419–1021) | 983–1020 (922–1133) |
| První hledání ms (index ~1 MB) | – | 2762–2862 | 2746–3075 |

**Závěr**
- **Načtení stránky:** rozdíly LCP, CLS a TBT mezi variantami jsou menší než rozptyl běhů téže varianty. TBT kolísá až o 6 s kvůli nestabilní síti testovacího prostředí. **Měřitelný dopad v3 na načtení oproti v2 není.** Jarda startuje až po `load` v klidu prohlížeče.
- **Data:** v3 stahuje při načtení o 43 % méně (13 kB proti 23 kB) při stejném počtu požadavků (3). Katalog se stahuje až při prvním hledání.
- **Interakce:** INP v3 je nižší než u v2 (40–144 proti 136–200 ms).
- **Otevření panelu:** u v3 ~1 s. Rozbor ukázal, že čas tvoří síť: aplikace a `config.app.json` se stahují souběžně (od 3.0.3) za ~350–500 ms, panel se pak ukáže ~50 ms po jejich stažení, zbytek je kolísání sítě. v2 má stejný rozptyl (419–1021 ms). Cílenou příčinu v kódu, kterou by šlo odstranit, měření nepotvrdilo.
- **První hledání:** stejné (~2,8 s na zpomaleném mobilu). Rozhoduje stažení indexu promontaz-search.

Neověřeno: reálná zařízení a terénní data (CrUX). Pozor: při intenzivním testování Shoptet dočasně blokuje IP („Access temporarily blocked“, HTTP 403). Živé testy proto nepouštějte ve smyčce.
