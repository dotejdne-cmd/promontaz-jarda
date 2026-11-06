import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepRules, classify } from '../src/intent.js';
import { clean } from '../src/track.js';

const app = JSON.parse(fs.readFileSync(new URL('../config.app.json', import.meta.url)));
const R = prepRules(app.intent_rules);
const c = q => classify(q, R);
const is = (q, intent, mode) => {
  const r = c(q);
  assert.equal(r.intent, intent, `${q} → ${JSON.stringify(r)}`);
  if (mode) assert.equal(r.mode, mode, `${q} → ${JSON.stringify(r)}`);
};

test('přímé dotazy', () => {
  is('Kolik stojí poštovné?', 'doprava', 'direct');
  is('kdy mi to dodáte', 'doprava', 'direct');
  is('doprava', 'doprava', 'direct');
  is('jde platit kartou?', 'platba', 'direct');
  is('můžu zaplatit převodem', 'platba', 'direct');
  is('chci fakturu na IČO', 'b2b', 'direct');
  is('potřebuju větší množství', 'b2b', 'direct');
  is('nákup na fakturu se splatností', 'b2b', 'direct');
  is('můžu mluvit s člověkem', 'clovek', 'direct');
  is('kde je moje objednávka', 'objednavka', 'direct');
  is('stav objednávky', 'objednavka', 'direct');
  is('chci reklamovat', 'objednavka', 'direct');
  is('pošlete mi kopii faktury', 'faktura', 'direct');
  is('daňový doklad k objednávce', 'faktura', 'direct');
});

test('produktové dotazy se nepřesměrují', () => {
  for (const q of ['vrut 5x60', 'kabel CYKY 3x2,5', 'osb 18', 'kramle 10x200', 'pur pěna', 'hmoždinky 8x40', 'wago 221-413'])
    assert.equal(c(q).mode, 'search', q);
});

test('jedno slovo ve věcném dotazu → hledat a záměr jen nabídnout', () => {
  is('doprava dřeva 4 m', 'doprava', 'mixed');
  is('telefonní kabel', 'clovek', 'mixed');          // „telefon“ nesmí poslat na WhatsApp
  is('nabídka OSB desek 18 mm', 'b2b', 'mixed');
  is('firma kabely CYKY 3x2,5', 'b2b', 'mixed');
});

test('nejasné dotazy → zeptat se', () => {
  const r = c('faktura objednávka');
  assert.equal(r.mode, 'clarify');
  assert.deepEqual(r.alt.sort(), ['faktura', 'objednavka']);
});

test('měření bez osobních údajů', () => {
  assert.equal(clean('jan@firma.cz osb'), '[skryto] osb');
  assert.equal(clean('volejte 722 792 670'), 'volejte [skryto]');
  assert.equal(clean('+420 722792670'), '[skryto]');
  assert.equal(clean('kotva m8x100'), 'kotva m8x100');
  assert.equal(clean('8591530101197'), '8591530101197'); // EAN zůstane
  assert.equal(clean(5), 5);
});
