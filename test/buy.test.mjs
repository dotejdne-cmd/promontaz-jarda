// Nákupní údaje ze skutečných stránek produktů promontaz.cz (uloženo 19. 11. 2026, test/fixtures/*.html.gz).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseProduct, plan, snap, sameCode } from '../src/buy.js';

const page = f => parseProduct(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/' + f + '.html.gz', import.meta.url))).toString('utf8'));

test('vrut po balení 1000 ks: jednotka, balení, cena, kód, min/krok', () => {
  const p = page('vrut-bal');
  assert.deepEqual([p.unit, p.pack, p.price, p.code, p.min, p.step, p.max, p.dec, p.variants], ['bal', { n: 1000, unit: 'ks' }, 189, 'VR_10005', 1, 1, 9999, 0, false]);
});
test('kramle po kusech, kabel po metrech, OSB po kusech', () => {
  assert.equal(page('kramle-ks').unit, 'ks');
  assert.equal(page('kramle-ks').code, 'HR_10075');
  assert.equal(page('kabel-m').unit, 'm');
  assert.equal(page('osb-ks').unit, 'ks');
});
test('produkt s variantami se pozná', () => { assert.equal(page('lepidlo-varianty').variants, true); });
test('jiná stránka než produkt → null', () => { assert.equal(parseProduct('<html><body>kategorie</body></html>'), null); });

test('200 ks vrutů po 1000 ks → 1 balení, 5000 ks → 5 balení', () => {
  const p = page('vrut-bal');
  assert.deepEqual(plan(p, { q: 200, unit: 'ks' }), { amount: 1, conv: 'pack', note: '', over: false, total: 189 });
  assert.equal(plan(p, { q: 5000, unit: 'ks' }).amount, 5);
  assert.equal(plan(p, { q: 1001, unit: 'ks' }).amount, 2);
});
test('holé číslo u balení: malé → zeptat se, řádově větší → kusy', () => {
  const p = page('vrut-bal');
  assert.equal(plan(p, { q: 200, unit: '' }).conv, 'ask');
  assert.equal(plan(p, { q: 200, unit: '' }).amount, 1);
  assert.deepEqual([plan(p, { q: 4000, unit: '' }).conv, plan(p, { q: 4000, unit: '' }).amount], ['pack', 4]);
  assert.deepEqual([plan(p, { q: 3, unit: 'bal' }).conv, plan(p, { q: 3, unit: 'bal' }).amount], ['same', 3]);
});
test('kabel: 50 m → 50; 25 ks u kabelu → zeptat se', () => {
  const p = page('kabel-m');
  assert.deepEqual([plan(p, { q: 50, unit: 'm' }).conv, plan(p, { q: 50, unit: 'm' }).amount], ['same', 50]);
  assert.equal(plan(p, { q: 25, unit: 'ks' }).conv, 'ask');
});
test('kusové zboží bez jednotky = kusy; bez požadavku = minimum', () => {
  const p = page('osb-ks');
  assert.equal(plan(p, { q: 12, unit: '' }).amount, 12);
  assert.equal(plan(p, null).conv, 'default');
});
test('min, krok a max ze Shoptetu', () => {
  const f = { unit: 'ks', min: 5, step: 5, max: 100, dec: 0, price: 10 };
  assert.equal(snap(7, f), 10); assert.equal(snap(1, f), 5);
  assert.deepEqual(plan(f, { q: 7, unit: 'ks' }), { amount: 10, conv: 'same', note: 'rounded', over: false, total: 100 });
  assert.equal(plan(f, { q: 500, unit: 'ks' }).over, true);
  assert.equal(snap(1.23, { min: 0.5, step: 0.5, dec: 1 }), 1.5);
});
test('ks s obsahem balení > 1 (např. sáček 100 ks prodávaný jako 1 ks) → zeptat se', () => {
  const f = { unit: 'ks', min: 1, step: 1, max: 9999, dec: 0, price: 30, pack: { n: 100, unit: 'ks' } };
  assert.equal(plan(f, { q: 300, unit: 'ks' }).conv, 'ask');
});
test('shoda kódu', () => { assert.ok(sameCode('VR_10005', 'vr-10005')); assert.ok(!sameCode('VR_10005', 'VR_10006')); assert.ok(!sameCode('', '')); });
