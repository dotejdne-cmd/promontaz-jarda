import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { norm, buildIndex, search, prepSynonyms, thumbUrl } from '../src/search.js';

const idx = buildIndex(JSON.parse(fs.readFileSync(new URL('./fixture-index.json', import.meta.url))));
const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const app = JSON.parse(fs.readFileSync(new URL('../config.app.json', import.meta.url)));
const SYN = prepSynonyms(app.synonyms);
const opts = { limit: 50, replace: cfg.search_replace, synonyms: SYN };
const names = q => search(idx, q, opts).results.map(r => r.n);

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
  assert.ok(names('m80').every(n => !/M8x/.test(n)));
  assert.ok(names('kotva m8').length > 0 && names('kotva m8').every(n => /M8x/.test(n)));
  assert.equal(names('osb 2500/1250/1').length, 0);
});
test('rozměry v pořadí polí', () => {
  assert.ok(names('KVH 120x5000').includes('KVH 120/120/5000'));
  assert.ok(names('osb 1250x18').includes('OSB 2500/1250/18 RH'));
  assert.equal(names('KVH 5000x120').length, 0);
});
test('řazení: přesná shoda názvu a krátké názvy první', () => {
  assert.equal(names('turbo sroub 7,5 x 92')[0], 'Den Braven Turbo šroub s plochou hlavou 7,5 mm × 92 mm — bal. 100 ks');
  assert.equal(names('kvh 120x120x5000')[0], 'KVH 120/120/5000');
  assert.ok(names('cyky 3x2,5')[0].startsWith('Kabel CYKY-J 3x2,5'));
});
test('kód produktu a EAN mají přednost', () => {
  assert.equal(search(idx, 'KO_10119').results[0].n, 'HASPL Hmoždinka natloukací 8x100mm zápustná, polypropylen');
  assert.equal(search(idx, 'ko-10119').results[0].c, 'KO_10119');
  assert.equal(search(idx, '8591530101197').total, 1);
  assert.equal(search(idx, 'KO 10119').results[0].c, 'KO_10119');
});
test('ohýbání slov (šroubů → šroub)', () => {
  assert.ok(names('okenních šroubů').some(n => n.includes('Okenní šroub')));
});
test('synonyma jen technicky rovnocenná', () => {
  assert.ok(names('hranol 120x120').includes('KVH 120/120/5000'));       // hranol → KVH
  assert.ok(names('pozinkovaný drát').some(n => n.includes('Vazací drát'))); // pozinkovaný → zinek/ZB/ZZ i doslovně
  assert.ok(names('dibl 8x100').some(n => n.includes('Hmoždinka natloukací 8x100')));
});
test('náhrady ze config.json (turbošroub)', () => {
  assert.ok(search(idx, 'turbošroub 7,5x92', opts).results[0].n.includes('Turbo šroub'));
});
test('nic nenalezeno: chybějící slovo a nabídka bez něj', () => {
  const r = search(idx, 'sádrokarton knauf 12,5', opts);
  assert.equal(r.total, 0);
  const r2 = search(idx, 'kotva m8 nerez', opts);
  assert.equal(r2.total, 0);
  assert.deepEqual(r2.missing, ['nerez']);
  assert.equal(r2.partial.without, 'nerez');
  assert.ok(r2.partial.results.every(i => /M8x/.test(i.n)));
});
test('top 5, cena a obrázek z indexu', () => {
  const r = search(idx, 'osb');
  assert.equal(r.results.length, 5);
  assert.ok(r.total > 5);
  assert.equal(typeof r.results[0].p, 'number');
});
test('na živém indexu (pokud je stažený)', { skip: !process.env.LIVE_INDEX }, () => {
  const live = buildIndex(JSON.parse(fs.readFileSync(process.env.LIVE_INDEX)));
  const t0 = Date.now();
  const r = search(live, 'vrut 5x60', opts);
  assert.ok(r.total > 5);
  assert.ok(Date.now() - t0 < 300);
  assert.ok(search(live, 'kramle 10 x 200', opts).results[0].n.includes('Kramle tesařská 10x200'));
});
test('náhled 100×100: orig i podepsaný big/ (bez podpisu)', () => {
  const B = app.thumb_base;
  assert.equal(thumbUrl('orig/52119_kramle.png?69d66807', B), B + '52119_kramle.png?69d66807');
  assert.equal(thumbUrl('big/70146_osb.png?ff=1&x=1024&y=768&q=85&ts=6a215edf&sg=161563f2', B), B + '70146_osb.png?6a215edf');
  assert.equal(thumbUrl('', B), '');
});
