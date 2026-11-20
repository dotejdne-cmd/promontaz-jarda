/* 3.2: položky seznamu (neuvedený počet) a prodejní jednotka z indexu promontaz-search (pozice 10, 11). */
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://www.promontaz.cz/x/', origin: 'https://www.promontaz.cz' };
const { cleanItem, listMerge } = await import('../src/util.js');
const { buildIndex, unitLabel } = await import('../src/search.js');

test('neuvedený počet zůstane neuvedený (q = 0), nikdy tiše 1 ks', () => {
  assert.equal(cleanItem({ n: 'vrut' }).q, 0);
  assert.equal(cleanItem({ n: 'vrut', q: '' }).q, 0);
  assert.equal(cleanItem({ n: 'vrut', q: -5 }).q, 0);
  assert.equal(cleanItem({ n: 'vrut', q: 'abc' }).q, 0);
  assert.equal(cleanItem({ n: 'vrut', q: '2,5' }).q, 2.5);
  assert.equal(cleanItem({ n: 'vrut', q: 12 }).q, 12);
});

test('sloučení stejné položky: známý + neznámý počet = známý, neznámý + neznámý = neznámý', () => {
  const l = [];
  listMerge(l, [{ n: 'OSB 18', u: '/osb/' }]);
  assert.equal(l[0].q, 0);
  listMerge(l, [{ n: 'OSB 18', u: '/osb/' }]);
  assert.equal(l.length, 1); assert.equal(l[0].q, 0);
  listMerge(l, [{ n: 'OSB 18', u: '/osb/', q: 4 }]);
  assert.equal(l[0].q, 4);
  listMerge(l, [{ n: 'OSB 18', u: '/osb/' }]);
  assert.equal(l[0].q, 4, 'přidání bez počtu nepřičte 1 ks');
  listMerge(l, [{ n: 'OSB 18', u: '/osb/', q: 6 }]);
  assert.equal(l[0].q, 10);
  listMerge(l, [{ n: 'OSB 18', u: '/osb/', q: 2, un: 'bal' }]);
  assert.equal(l.length, 2, 'jiná jednotka = jiná položka');
});

test('jednotka a balení z indexu (pozice 10, 11) jen u produktů bez variant; popisek jako vyhledávání 3.2', () => {
  const idx = buildIndex({ base: 'https://www.promontaz.cz/', items: [
    ['Vrut 3,5x35', 'v/', '', 189, 0, 'VR_10005', 0, 1, 0, '', 'bal', '1000 ks'],
    ['Lepidlo', 'l/', '', 99, 0, 'LP_1', 0, 1, 1, '', 'ks', '25 kg'],
    ['Kramle', 'k/', '', 52, 0, 'HR_10075', 0, 1, 0, '']] });
  assert.deepEqual([idx[0].un, idx[0].pk], ['bal', '1000 ks']);
  assert.deepEqual([idx[1].un, idx[1].pk], ['', ''], 'varianty: jednotka se neukazuje');
  assert.deepEqual([idx[2].un, idx[2].pk], ['', ''], 'starší index bez pozic 10, 11');
  assert.equal(unitLabel('bal', '1000 ks'), '/ bal (1000 ks)');
  assert.equal(unitLabel('ks', '25 kg'), '/ ks (25 kg)');
  assert.equal(unitLabel('m', '100 m'), '/ m');
  assert.equal(unitLabel('ks', '1 ks'), '/ ks');
  assert.equal(unitLabel('m2', ''), '/ m²');
  assert.equal(unitLabel('', '1000 ks'), '', 'bez jednotky nic – nedomýšlet');
  assert.equal(unitLabel('<b>', ''), '', 'jen krátké písmenné jednotky');
});
