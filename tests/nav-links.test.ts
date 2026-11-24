import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { navLinks } from '../src/lib/nav-links.ts';

describe('Admin page header navigation (built in the browser from the saved Navigation Menu)', () => {
  const rows = [
    { label: 'Curries', href: '/category/curries/', order: 3, visible: true },
    { label: 'Home', href: '/', order: 1, visible: true },
    { label: 'Secret', href: '/category/secret/', order: 2, visible: false },
    { label: 'Recipes', href: '/recipes/', order: 2, visible: true },
  ];

  it('uses the saved labels and orders the items by their order', () => {
    assert.deepEqual(navLinks(rows), [
      { label: 'Home', href: '/' },
      { label: 'Recipes', href: '/recipes/' },
      { label: 'Curries', href: '/category/curries/' },
    ]);
  });

  it('drops hidden items', () => {
    assert.ok(!navLinks(rows).some((l) => l.label === 'Secret'));
  });

  it('shows a changed label and a changed order on the next call, with no rebuild step in between', () => {
    const changed = rows.map((r) => (r.label === 'Curries' ? { ...r, label: 'Curry Dishes', order: 0 } : r));
    assert.deepEqual(navLinks(changed).map((l) => l.label), ['Curry Dishes', 'Home', 'Recipes']);
  });

  it('keeps only site paths and https links, and copes with no menu', () => {
    const odd = [
      { label: 'x', href: 'javascript:alert(1)', order: 1, visible: true },
      { label: 'y', href: '//evil.example/', order: 2, visible: true },
      { label: 'z', href: 'https://example.com/', order: 3, visible: true },
    ];
    assert.deepEqual(navLinks(odd), [{ label: 'z', href: 'https://example.com/' }]);
    assert.deepEqual(navLinks(undefined), []);
  });

  it('does not change the list it was given', () => {
    const copy = JSON.stringify(rows);
    navLinks(rows);
    assert.equal(JSON.stringify(rows), copy);
  });
});
