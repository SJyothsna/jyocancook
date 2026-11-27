import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webpSrcset } from '../src/lib/responsive-image.ts';

describe('webpSrcset', () => {
  let root = '';
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jyo-img-'));
    fs.mkdirSync(path.join(root, 'images/recipes'), { recursive: true });
    for (const f of ['dosa-480.webp', 'dosa-800.webp', 'dosa-1200.webp', 'small-480.webp']) {
      fs.writeFileSync(path.join(root, 'images/recipes', f), 'x');
    }
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('lists the WebP copies that exist, smallest first', () => {
    assert.equal(
      webpSrcset('/images/recipes/dosa.png', root),
      '/images/recipes/dosa-480.webp 480w, /images/recipes/dosa-800.webp 800w, /images/recipes/dosa-1200.webp 1200w',
    );
    assert.equal(webpSrcset('/images/recipes/small.jpg', root), '/images/recipes/small-480.webp 480w');
  });

  it('works for a photo that is itself a .webp upload', () => {
    assert.equal(webpSrcset('/images/recipes/small.webp', root), '/images/recipes/small-480.webp 480w');
  });

  it('returns null when there are no copies or the file is not a local raster image', () => {
    assert.equal(webpSrcset('/images/recipes/missing.png', root), null);
    assert.equal(webpSrcset('/images/categories/icon.svg', root), null);
    assert.equal(webpSrcset('https://example.com/images/recipes/dosa.png', root), null);
    assert.equal(webpSrcset('/images/../secret/dosa.png', root), null);
  });
});
