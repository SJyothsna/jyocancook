import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyListFormat, stepBlocks, unitLabel } from '../src/lib/recipe-text.ts';

describe('unitLabel', () => {
  it('capitalises tsp and tbsp, whatever the stored case', () => {
    assert.equal(unitLabel('tbsp'), 'Tbsp');
    assert.equal(unitLabel('TBSP'), 'Tbsp');
    assert.equal(unitLabel('tsp'), 'Tsp');
  });

  it('leaves other units as typed', () => {
    assert.equal(unitLabel('cup'), 'cup');
    assert.equal(unitLabel('to taste'), 'to taste');
  });
});

describe('stepBlocks', () => {
  it('turns bullet lines into a list and keeps plain lines as text', () => {
    assert.deepEqual(stepBlocks('Heat oil.\n- Add onions\n• Add salt\nStir well.'), [
      { type: 'p', lines: ['Heat oil.'] },
      { type: 'ul', lines: ['Add onions', 'Add salt'] },
      { type: 'p', lines: ['Stir well.'] },
    ]);
  });

  it('turns numbered lines into an ordered list', () => {
    assert.deepEqual(stepBlocks('1. Wash rice\n2) Soak it\n\n3. Cook'), [
      { type: 'ol', lines: ['Wash rice', 'Soak it', 'Cook'] },
    ]);
  });

  it('keeps the line breaks of plain text', () => {
    assert.deepEqual(stepBlocks('First line\nSecond line'), [{ type: 'p', lines: ['First line', 'Second line'] }]);
  });
});

describe('applyListFormat', () => {
  it('adds bullets, then takes them away again', () => {
    const bulleted = applyListFormat('Heat oil\nAdd onions', 'ul');
    assert.equal(bulleted, '\u2022 Heat oil\n\u2022 Add onions');
    assert.equal(applyListFormat(bulleted, 'ul'), 'Heat oil\nAdd onions');
  });

  it('numbers the non-empty lines and replaces existing bullets', () => {
    assert.equal(applyListFormat('- Heat oil\n\nAdd onions', 'ol'), '1. Heat oil\n\n2. Add onions');
  });
});
