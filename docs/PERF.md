# Výkon: bez Jardy × v2 × v3 (živý promontaz.cz, 6. 11. 2026)

`npm run perf`, stránka produktu Kramle tesařská 10x200, emulace Pixel 7, CPU 4× zpomalené, síť 9 Mb/s / 170 ms, medián z 5 běhů (v2 a v3 podstrčené stejným způsobem, ostatní skripty webu beze změny).

| Metrika | bez Jardy | v2 | v3 3.0.0 |
|---|---:|---:|---:|
| LCP ms | 1804 | 1596 | 1688 |
| CLS | 0,052 | 0,052 | 0,052 |
| TBT ms (načtení, celá stránka) | 1690 | 1747 | 1773 |
| Čas skriptů ms (celá stránka) | 1616 | 1702 | 1723 |
| Požadavky Jardy při načtení | 0 | 3 | 3 |
| **kB Jardy při načtení** | 0 | **39** | **15** |
| Klik na ikonu → panel ms | – | 162 | 191 |
| První hledání ms (vč. stažení indexu ~1 MB) | – | 2660 | 2645 |
| TBT ms během prvního hledání | – | 604 | 525 |

**Čtení výsledků**
- Rozptyl mezi běhy je u TBT a času skriptů ±200 ms, rozdíly mezi variantami (50–100 ms) jsou v šumu. **Ani v2, ani v3 nemá měřitelný vliv na LCP, CLS ani TBT**, protože obě startují až po `load` v klidu prohlížeče.
- v3 stahuje se stránkou o **61 % méně dat** (15 kB místo 39 kB): menší zavaděč, logo WebP 2,5 kB místo JPG 11,5 kB. Aplikace (15,6 kB gzip) se stahuje až po najetí, fokusu nebo dotyku ikony, proto je první otevření o ~30 ms pomalejší.
- První hledání je v obou verzích ~2,6 s na zpomaleném mobilu. Rozhoduje stažení indexu promontaz-search (~1 MB gzip), který nesmíme měnit. Příprava indexu ve v3 běží po dávkách (nižší TBT během hledání).
- Pro budoucí PageSpeed: TBT 1,7 s pochází ze skriptů webu, ne z Jardy.

Neověřeno: reálné zařízení (iOS Safari, Android), data CrUX / PageSpeed Insights z terénu.
