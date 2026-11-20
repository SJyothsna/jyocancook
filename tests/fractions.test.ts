import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatQty, parseQty } from '../src/lib/fractions.ts';

describe('Ingredient quantity fractions', () => {
  it('parses fractions, mixed numbers and decimals', () => {
    assert.equal(parseQty('1/2'), 0.5);
    assert.equal(parseQty(' 1 1/2 '), 1.5);
    assert.equal(parseQty('0.5'), 0.5);
    assert.equal(parseQty('2'), 2);
    assert.equal(parseQty('1/3'), 0.3333);
  });

  it('treats an empty or invalid quantity as not set', () => {
    assert.equal(parseQty(''), null);
    assert.equal(parseQty('   '), null);
    assert.equal(parseQty('abc'), null);
    assert.equal(parseQty('1/0'), null);
    assert.equal(parseQty('-1'), null);
  });

  it('shows quantities as fractions', () => {
    assert.equal(formatQty(0.5), '1/2');
    assert.equal(formatQty(1.5), '1 1/2');
    assert.equal(formatQty(0.33), '1/3');
    assert.equal(formatQty(0.67), '2/3');
    assert.equal(formatQty(0.25), '1/4');
    assert.equal(formatQty(2), '2');
    assert.equal(formatQty(0.7), '0.7');
    assert.equal(formatQty(null), '');
  });

  it('can show a single fraction character so "1 1/2" never reads as "11/2"', () => {
    assert.equal(formatQty(1.5, true), '1 ½');
    assert.equal(formatQty(0.5, true), '½');
    assert.equal(formatQty(2.25, true), '2 ¼');
    assert.equal(formatQty(0.33, true), '⅓');
    assert.equal(formatQty(2, true), '2');
  });
});
