import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQty, parseLines, qtyLabel } from '../src/qty.js';

const pq = s => { const r = parseQty(s); return [r.q, r.unit, r.query]; };
test('množství na začátku', () => {
  assert.deepEqual(pq('200 ks vrut konstrukční 3,5x35'), [200, 'ks', 'vrut konstrukční 3,5x35']);
  assert.deepEqual(pq('3 bal. hmoždinky 8x40'), [3, 'bal', 'hmoždinky 8x40']);
  assert.deepEqual(pq('20× OSB 18'), [20, '', 'OSB 18']);
  assert.deepEqual(pq('20x kramle 10x200'), [20, '', 'kramle 10x200']);
  assert.deepEqual(pq('200 vrut 5x60'), [200, '', 'vrut 5x60']);
  assert.deepEqual(pq('50m kabel CYKY 3x2,5'), [50, 'm', 'kabel CYKY 3x2,5']);
});
test('množství na konci', () => {
  assert.deepEqual(pq('vrut 5x60 200 ks'), [200, 'ks', 'vrut 5x60']);
  assert.deepEqual(pq('kabel CYKY 3x2,5 50 m'), [50, 'm', 'kabel CYKY 3x2,5']);
  assert.deepEqual(pq('hmoždinka 8x40 - 100ks'), [100, 'ks', 'hmoždinka 8x40']);
  assert.deepEqual(pq('kramle 10x200 12×'), [12, '', 'kramle 10x200']);
  assert.deepEqual(pq('dlažba 60x60 20 m2'), [20, 'm2', 'dlažba 60x60']);
});
test('rozměry a velikosti balení nejsou množství', () => {
  for (const s of ['kramle 10x200', '8 x 200', 'CYKY 3x2,5', 'OSB 18 mm', 'lepidlo 25 kg', 'silikon 310 ml', '10 kg lepidlo', '8 mm vrták', 'M8x100', '221-413', 'KVH 120/120/5000'])
    assert.equal(parseQty(s).q, 0, s);
});
test('vložený seznam: řádky, odrážky, Excel, chybějící počet', () => {
  const l = parseLines('1. 200 ks vrut 5x60\n- kabel CYKY 3x2,5 50 m\nOSB 18\t12\n\nkramle 10x200;  5 bal hmoždinky 8x40\n   ');
  assert.deepEqual(l.map(x => [x.q, x.unit, x.query, x.warn.join()]), [
    [200, 'ks', 'vrut 5x60', ''], [50, 'm', 'kabel CYKY 3x2,5', ''], [12, '', 'OSB 18', ''], [0, '', 'kramle 10x200', 'qty'], [5, 'bal', 'hmoždinky 8x40', '']]);
  assert.equal(parseLines(Array(80).fill('vrut 5x60').join('\n')).length, 50);
  assert.equal(parseLines('12345\n---').length, 0);
});
test('popisek množství', () => { assert.equal(qtyLabel(2.5, 'm'), '2,5 m'); assert.equal(qtyLabel(3, ''), '3×'); assert.equal(qtyLabel(0, 'ks'), ''); });
