// Zveřejněné verze jsou neměnné: soubory v dist/<verze>/, které už jsou na origin/main (= GitHub Pages),
// se nesmí změnit. Změna kódu = nová verze v package.json → nový adresář → nová adresa ve Shoptetu.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const sh = c => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let base = process.env.RELEASE_BASE || 'origin/main', bad = 0;
try { sh(`git rev-parse --verify ${base}`); } catch { console.log(`(${base} není k dispozici – přeskočeno)`); process.exit(0); }
const published = sh(`git ls-tree -r --name-only ${base} dist/`).split('\n').filter(f => /^dist\/\d+\.\d+\.\d+\//.test(f));
for (const f of published) {
  const old = sh(`git show ${base}:${f}`);
  if (!fs.existsSync(f)) { console.error(`✗ ${f} byl smazán – zveřejněnou verzi nemažte (rollback na ni musí fungovat)`); bad++; }
  else if (fs.readFileSync(f, 'utf8') !== old) { console.error(`✗ ${f} se změnil – zvyšte verzi v package.json`); bad++; }
}
const v = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
if (!fs.existsSync(`dist/${v}/jarda.min.js`)) { console.error(`✗ chybí dist/${v}/ – spusťte npm run build`); bad++; }
console.log(bad ? `${bad} chyb` : `✓ zveřejněné verze beze změny (${published.length} souborů), aktuální ${v}`);
process.exit(bad ? 1 : 0);
