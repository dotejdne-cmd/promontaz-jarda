import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { norm, buildIndex, search, detectIntent, safeQuery } from '../src/search.js';

const idx = buildIndex(JSON.parse(fs.readFileSync(new URL('./fixture-index.json', import.meta.url))));
const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const names = q => search(idx, q, 50).results.map(r => r.n);

test('rozměry: 8x200 = 8×200 = 8 x 200', () => {
  assert.equal(norm('8x200'), norm('8×200'));
  assert.equal(norm('8 x 200'), '8x200');
  assert.equal(norm('8 X 200 mm'), '8x200 ');
});
test('diakritika a desetinná čárka', () => {
  assert.deepEqual(names('hmozdinka natloukaci'), names('hmoždinka natloukací'));
  assert.ok(names('3x1,5').some(n => n.includes('CYKY-J 3x1,5')));
  assert.ok(names('CYKY 3x1.50').some(n => n.includes('CYKY-J 3x1,5')));
});
test('čísla se nedoplňují', () => {
  assert.ok(!names('m80').length || names('m80').every(n => !/M8x/.test(n)));
  assert.ok(names('kotva m8').every(n => /M8x/.test(n)));
  assert.ok(!names('osb 2500/1250/1').length);
});
test('rozměry v pořadí polí', () => {
  assert.ok(names('KVH 120x5000').includes('KVH 120/120/5000'));
  assert.ok(names('osb 1250x18').includes('OSB 2500/1250/18 RH'));
  assert.ok(!names('KVH 5000x120').length);
});
test('turbo šroub 7,5 x 92', () => {
  assert.equal(names('turbo sroub 7,5 x 92')[0], 'Den Braven Turbo šroub s plochou hlavou 7,5 mm × 92 mm — bal. 100 ks');
});
test('kód produktu má přednost', () => {
  assert.equal(search(idx, 'KO_10119').results[0].n, 'HASPL Hmoždinka natloukací 8x100mm zápustná, polypropylen');
  assert.equal(search(idx, '8591530101197').total, 1);
});
test('ohýbání slov (šroubů → šroub)', () => {
  assert.ok(names('okenních šroubů').some(n => n.includes('Okenní šroub')));
});
test('nic nenalezeno', () => {
  assert.equal(search(idx, 'sádrokarton knauf 12,5').total, 0);
});
test('top 5 a cena s DPH', () => {
  const r = search(idx, 'osb');
  assert.equal(r.results.length, 5);
  assert.ok(r.total > 5);
});
test('záměry z config.json', () => {
  const I = cfg.intents;
  assert.equal(detectIntent('Kolik stojí poštovné?', I), 'doprava');
  assert.equal(detectIntent('kdy mi to dodáte', I), 'doprava');
  assert.equal(detectIntent('jde platit kartou?', I), 'platba');
  assert.equal(detectIntent('chci fakturu na IČO', I), 'naceneni');
  assert.equal(detectIntent('potřebuju větší množství', I), 'naceneni');
  assert.equal(detectIntent('můžu mluvit s člověkem', I), 'clovek');
  assert.equal(detectIntent('vrut 5x60', I), '');
  assert.equal(detectIntent('kabel CYKY 3x2,5', I), '');
});
test('měření bez e-mailu a telefonu', () => {
  assert.equal(safeQuery('jan@firma.cz osb'), '[skryto] osb');
  assert.equal(safeQuery('volejte 722 792 670'), 'volejte [skryto]');
  assert.equal(safeQuery('kotva m8x100'), 'kotva m8x100');
});
test('náhrady ze config.json (turbošroub)', () => {
  assert.ok(search(idx, 'turbošroub 7,5x92', 5, cfg.search_replace).results[0].n.includes('Turbo šroub'));
});
