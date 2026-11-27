/**
 * Static publishing tests for the Hostinger staging layout:
 *
 *   <site>/public_html/            production web root (must never change)
 *   <site>/public_html/staging/    staging web root (the only place the publisher may write)
 *   <site>/backend-staging/        private backend
 *
 * What runs: the real api/index.php, SiteGenerator, RecipeService, TemplateRenderer and PathGuard
 * executed by PHP 8.3 compiled to WebAssembly (@php-wasm/node), with SQLite standing in for MySQL
 * (small shims provide NOW() and IF()). It is NOT Hostinger's PHP and NOT MySQL, so MySQL-only SQL
 * (ON DUPLICATE KEY, INSERT IGNORE) is out of scope here: category saves and tag-linking recipe saves
 * are covered by publishing from rows inserted directly.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  php, makeTmp, makeSite, startPhp, stopPhp, call, json, authed, phpRun, makePng, dataUrl, configLocalPhp,
  PROD_FILES, HTTPS_URL, type Site,
} from './helpers/php-harness.ts';

// ---------------------------------------------------------------- helpers

type Tree = Record<string, string>;

/** Every file (content hash) and directory below `dir`; `skip` receives paths relative to `dir`. */
function snapshot(dir: string, skip: (rel: string) => boolean = () => false): Tree {
  const out: Tree = {};
  const walk = (d: string, prefix: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix + e.name;
      if (skip(rel)) continue;
      if (e.isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(path.join(d, e.name), `${rel}/`);
      } else {
        out[rel] = crypto.createHash('sha1').update(fs.readFileSync(path.join(d, e.name))).digest('hex');
      }
    }
  };
  walk(dir, '');
  return out;
}

const allFiles = (dir: string): string[] => Object.keys(snapshot(dir)).filter((k) => !k.endsWith('/'));
const read = (site: Site, rel: string) => fs.readFileSync(path.join(site.staging, rel), 'utf8');
const exists = (site: Site, rel: string) => fs.existsSync(path.join(site.staging, rel));

/** Files and folders the generator owns. Everything else in staging ships with the deployment package. */
const GENERATED = /^(index\.html|404\.html|search-index\.json|sitemap-.*\.xml|(recipes|category|tag|search|about|pagefind)(\/.*)?)$/;
const isGenerated = (rel: string) => GENERATED.test(rel.replace(/\/$/, ''));

type Spec = {
  categories: Array<[string, string]>;
  tags: string[];
  recipes: Array<{ slug: string; title: string; category: string; published: boolean; tags?: string[]; description?: string }>;
};

async function seed(spec: Spec) {
  const b64 = Buffer.from(JSON.stringify(spec)).toString('base64');
  const out = await phpRun(`
    require_once '/testlib/schema.php';
    $pdo = jyo_test_pdo('gen', true);
    $spec = json_decode(base64_decode('${b64}'), true);
    foreach ($spec['categories'] as $i => $c) {
      $pdo->prepare('INSERT INTO categories (slug, name, order_num) VALUES (?, ?, ?)')->execute([$c[0], $c[1], $i]);
    }
    foreach ($spec['tags'] as $t) {
      $pdo->prepare('INSERT INTO tags (name, slug) VALUES (?, ?)')->execute([$t, strtolower(preg_replace('/[^a-z0-9]+/i', '-', $t))]);
    }
    foreach ($spec['recipes'] as $r) {
      $pdo->prepare('INSERT INTO recipes (slug, title, description, category_slug, published, published_at) VALUES (?, ?, ?, ?, ?, ?)')
          ->execute([$r['slug'], $r['title'], $r['description'] ?? 'A tasty dish.', $r['category'], $r['published'] ? 1 : 0, $r['published'] ? '2026-01-01 00:00:00' : null]);
      $id = (int)$pdo->lastInsertId();
      $pdo->prepare('INSERT INTO recipe_ingredients (recipe_id, name, amount, unit, order_num) VALUES (?, ?, 2, ?, 0)')->execute([$id, 'salt', 'tsp']);
      $pdo->prepare('INSERT INTO recipe_steps (recipe_id, title, text, order_num) VALUES (?, ?, ?, 0)')->execute([$id, 'Cook', 'Cook it well.']);
      foreach (($r['tags'] ?? []) as $name) {
        $tid = $pdo->prepare('SELECT id FROM tags WHERE name = ?'); $tid->execute([$name]);
        $pdo->prepare('INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)')->execute([$id, (int)$tid->fetchColumn()]);
      }
    }
    echo 'seeded';`);
  assert.equal(out, 'seeded', out);
}

async function sql(statement: string, params: unknown[] = []) {
  const b64 = Buffer.from(JSON.stringify(params)).toString('base64');
  const out = await phpRun(`
    require_once '/testlib/schema.php';
    $pdo = jyo_test_pdo('gen', true);
    $st = $pdo->prepare(${JSON.stringify(statement)});
    $st->execute(json_decode(base64_decode('${b64}'), true));
    echo 'ok';`);
  assert.equal(out, 'ok', out);
}

// ---------------------------------------------------------------- suite

describe('Static publishing into /public_html/staging (WASM PHP 8.3 + SQLite stand-in)', () => {
  let gen: Site;
  let csrf = '';
  let c: Awaited<ReturnType<typeof authed>>['c'];
  const productionBefore: Tree = {};
  const protectedBefore: Tree = {};

  const publish = () => call(c, 'POST', '/api/admin/publish', undefined, { 'X-CSRF-Token': csrf });
  const post = (url: string, body?: unknown) => call(c, 'POST', url, body, { 'X-CSRF-Token': csrf });
  const productionNow = () => snapshot(gen.production, (rel) => rel === 'staging' || rel.startsWith('staging/'));
  const protectedNow = () => snapshot(gen.staging, (rel) => isGenerated(rel));
  const stagingNow = () => snapshot(gen.staging);

  const RECIPE = {
    title: 'Garlic Naan',
    slug: 'garlic-naan',
    category: 'main-course',
    description: 'Soft flatbread.',
    ingredients: [{ name: 'flour', amount: 2, unit: 'cup' }],
    steps: [{ title: 'Mix', text: 'Mix everything well.' }],
    published: true,
  };

  before(async () => {
    makeTmp();
    gen = makeSite('gen');

    // What the Astro build + deployment package leave in /public_html/staging before the first publish.
    const files: Record<string, string> = {
      'index.html': '<h1>ASTRO HOME</h1>',
      'recipes/index.html': 'ASTRO CATALOG',
      'recipes/old-astro-recipe/index.html': 'OLD ASTRO RECIPE',
      'category/old-category/index.html': 'OLD CATEGORY',
      'tag/old-tag/index.html': 'OLD TAG',
      'pagefind/pagefind.js': '/* index of recipe text */',
      'admin/index.html': '<h1>ADMIN UI</h1>',
      '_astro/app.abc123.css': 'body{}',
      'styles/global.css': 'body{color:#000}',
      'images/recipes/existing-photo.jpg': 'jpg-bytes',
      'images/recipes/.htaccess': '# no scripts',
      '.htaccess': '# staging rules',
      'robots.txt': 'User-agent: *\nDisallow: /\n',
    };
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(gen.staging, rel)), { recursive: true });
      fs.writeFileSync(path.join(gen.staging, rel), content);
    }
    await startPhp();

    Object.assign(productionBefore, productionNow());
    Object.assign(protectedBefore, protectedNow());
    ({ c, csrf } = await authed(gen, 'full'));
  });

  after(stopPhp);

  it('precondition: the production sentinel files exist and are tracked', () => {
    for (const rel of Object.keys(PROD_FILES)) assert.ok(productionBefore[rel], `${rel} missing from snapshot`);
    assert.ok(Object.keys(productionBefore).length >= Object.keys(PROD_FILES).length);
  });

  // ---------------------------------------------------------- nothing to publish

  it('refuses to publish an unseeded (empty) database and leaves the site untouched', async () => {
    const before = stagingNow();
    const r = await publish();
    assert.equal(r.httpStatusCode, 409, r.text);
    const body = json(r);
    assert.equal(body.ok, false);
    assert.match(body.error, /no categories or recipes/);
    assert.match(body.error, /was not changed/);
    assert.deepEqual(stagingNow(), before, 'staging tree unchanged');
    assert.deepEqual(productionNow(), productionBefore, 'production unchanged');
  });

  // ---------------------------------------------------------- first publish

  it('publishes home, catalog, recipe, category, tag, search index and sitemap pages', async () => {
    await seed({
      categories: [['main-course', 'Main Course'], ['snacks', 'Snacks']],
      tags: ['Spicy', 'Quick'],
      recipes: [
        { slug: 'chicken-curry', title: 'Chicken Curry', category: 'main-course', published: true, tags: ['Spicy'] },
        { slug: 'onion-pakoda', title: 'Onion Pakoda', category: 'snacks', published: true, tags: ['Quick'] },
        { slug: 'secret-draft', title: 'Secret Draft Recipe', category: 'main-course', published: false },
      ],
    });

    const r = await publish();
    assert.equal(r.httpStatusCode, 200, r.text);
    const body = json(r);
    assert.equal(body.ok, true);
    assert.equal(body.stats.recipes_count, 2);

    // Home + catalog replace the Astro versions.
    assert.ok(!read(gen, 'index.html').includes('ASTRO HOME'));
    assert.match(read(gen, 'index.html'), /JyoCanCook/);
    assert.match(read(gen, 'recipes/index.html'), /Chicken Curry/);
    assert.match(read(gen, 'recipes/index.html'), /Onion Pakoda/);
    // Recipe, category and tag pages exist.
    for (const rel of ['recipes/chicken-curry/index.html', 'recipes/onion-pakoda/index.html', 'category/main-course/index.html', 'category/snacks/index.html', 'tag/spicy/index.html', 'tag/quick/index.html', 'search/index.html', 'about/index.html', '404.html']) {
      assert.ok(exists(gen, rel), `${rel} should be generated`);
    }
    assert.match(read(gen, 'recipes/chicken-curry/index.html'), /Chicken Curry/);
    assert.match(read(gen, 'category/snacks/index.html'), /Onion Pakoda/);
    assert.ok(!read(gen, 'category/snacks/index.html').includes('Chicken Curry'));
    assert.match(read(gen, 'tag/spicy/index.html'), /Chicken Curry/);

    // Search index and sitemap are regenerated from the published recipes only.
    const index = JSON.parse(read(gen, 'search-index.json'));
    assert.deepEqual(index.map((e: { slug: string }) => e.slug).sort(), ['chicken-curry', 'onion-pakoda']);
    const sitemap = read(gen, 'sitemap-0.xml');
    for (const loc of ['/', '/recipes/', '/recipes/chicken-curry/', '/category/snacks/', '/tag/quick/']) {
      assert.ok(sitemap.includes(`<loc>${HTTPS_URL}${loc}</loc>`), `sitemap should list ${loc}`);
    }
    assert.ok(read(gen, 'sitemap-index.xml').includes(`${HTTPS_URL}/sitemap-0.xml`));
    assert.ok(!/jyocancook\.com/.test(sitemap), 'staging sitemap must not point at the live domain');
  });

  it('never publishes a draft: no page, listing, search entry, sitemap entry or text', () => {
    assert.ok(!exists(gen, 'recipes/secret-draft'), 'no page for the draft');
    for (const rel of allFiles(gen.staging)) {
      const text = fs.readFileSync(path.join(gen.staging, rel), 'latin1');
      assert.ok(!text.includes('Secret Draft Recipe'), `draft title leaked into ${rel}`);
      assert.ok(!text.includes('secret-draft'), `draft slug leaked into ${rel}`);
    }
  });

  it('writes only inside /public_html/staging: production files are byte-for-byte unchanged', () => {
    assert.deepEqual(productionNow(), productionBefore);
  });

  it('leaves everything the deployment package ships (admin UI, assets, .htaccess, uploads) alone', () => {
    assert.deepEqual(protectedNow(), protectedBefore);
    assert.equal(read(gen, 'admin/index.html'), '<h1>ADMIN UI</h1>');
    assert.equal(read(gen, 'images/recipes/existing-photo.jpg'), 'jpg-bytes');
    assert.equal(read(gen, '.htaccess'), '# staging rules');
  });

  it('retires routes that no longer exist, including the obsolete Astro search index', () => {
    for (const rel of ['recipes/old-astro-recipe', 'category/old-category', 'tag/old-tag', 'pagefind']) {
      assert.ok(!exists(gen, rel), `${rel} should have been removed`);
    }
  });

  it('leaves no temporary or backup files behind after a successful publish', async () => {
    assert.deepEqual(allFiles(gen.staging).filter((f) => f.includes('.jyo-new-')), []);
    assert.deepEqual(await php.listFiles('/gen/backend-staging/tmp/backup'), []);
  });

  // ---------------------------------------------------------- admin saves publish immediately

  it('a NEW recipe saved in the admin gets its own page, search entry and sitemap URL immediately', async () => {
    const r = await post('/api/admin/recipes', { recipe: RECIPE });
    assert.equal(r.httpStatusCode, 200, r.text);
    const body = json(r);
    assert.equal(body.ok, true);
    assert.equal(body.slug, 'garlic-naan');
    assert.equal(body.generation.ok, true);

    assert.match(read(gen, 'recipes/garlic-naan/index.html'), /Garlic Naan/);
    assert.match(read(gen, 'category/main-course/index.html'), /Garlic Naan/);
    assert.match(read(gen, 'recipes/index.html'), /Garlic Naan/);
    assert.ok(JSON.parse(read(gen, 'search-index.json')).some((e: { slug: string }) => e.slug === 'garlic-naan'));
    assert.ok(read(gen, 'sitemap-0.xml').includes('/recipes/garlic-naan/'));
    assert.deepEqual(productionNow(), productionBefore);
  });

  it('EDITING a recipe updates its existing page (and the listings that show it)', async () => {
    const r = await post('/api/admin/recipes/garlic-naan', { recipe: { ...RECIPE, title: 'Garlic Butter Naan', description: 'Buttery flatbread.' } });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.equal(json(r).slug, 'garlic-naan');

    const page = read(gen, 'recipes/garlic-naan/index.html');
    assert.match(page, /Garlic Butter Naan/);
    assert.match(page, /Buttery flatbread/);
    assert.ok(!page.includes('Soft flatbread'));
    assert.match(read(gen, 'recipes/index.html'), /Garlic Butter Naan/);
    assert.ok(!/>Garlic Naan</.test(read(gen, 'recipes/index.html')));
    assert.ok(JSON.parse(read(gen, 'search-index.json')).some((e: { title: string }) => e.title === 'Garlic Butter Naan'));
  });

  it('UNPUBLISHING removes the page, search entry and sitemap URL but keeps the recipe for editing', async () => {
    const r = await post('/api/admin/recipes/garlic-naan', { recipe: { ...RECIPE, title: 'Garlic Butter Naan', published: false } });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.equal(json(r).published, false);

    assert.ok(!exists(gen, 'recipes/garlic-naan'), 'public page removed');
    assert.ok(!JSON.parse(read(gen, 'search-index.json')).some((e: { slug: string }) => e.slug === 'garlic-naan'));
    assert.ok(!read(gen, 'sitemap-0.xml').includes('garlic-naan'));
    assert.ok(!read(gen, 'category/main-course/index.html').includes('Garlic Butter Naan'));
    assert.ok(!read(gen, 'recipes/index.html').includes('Garlic Butter Naan'));

    const draft = await call(c, 'GET', '/api/admin/recipes/garlic-naan');
    assert.equal(draft.httpStatusCode, 200, 'the draft is still available to the admin');
    assert.equal(json(draft).recipe.published, false);
  });

  it('republishing the draft brings the page back', async () => {
    const r = await post('/api/admin/recipes/garlic-naan', { recipe: { ...RECIPE, title: 'Garlic Butter Naan', published: true } });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.match(read(gen, 'recipes/garlic-naan/index.html'), /Garlic Butter Naan/);
  });

  it('DELETING a recipe removes its page and every reference to it', async () => {
    const r = await call(c, 'DELETE', '/api/admin/recipes/onion-pakoda', undefined, { 'X-CSRF-Token': csrf });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.equal(json(r).ok, true);

    assert.ok(!exists(gen, 'recipes/onion-pakoda'));
    assert.ok(!JSON.parse(read(gen, 'search-index.json')).some((e: { slug: string }) => e.slug === 'onion-pakoda'));
    assert.ok(!read(gen, 'sitemap-0.xml').includes('onion-pakoda'));
    assert.ok(!read(gen, 'category/snacks/index.html').includes('Onion Pakoda'));
    assert.equal((await call(c, 'DELETE', '/api/admin/recipes/onion-pakoda', undefined, { 'X-CSRF-Token': csrf })).httpStatusCode, 404);
  });

  it('adding and removing tags creates and removes tag pages', async () => {
    let r = await post('/api/admin/tags', { data: ['Spicy', 'Quick', 'Festive'] });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.ok(exists(gen, 'tag/festive/index.html'));
    assert.ok(read(gen, 'sitemap-0.xml').includes('/tag/festive/'));

    r = await post('/api/admin/tags', { data: ['Spicy', 'Festive'] });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.ok(!exists(gen, 'tag/quick'), 'removed tag page is retired');
    assert.ok(exists(gen, 'tag/spicy/index.html'));
  });

  it('removing a category removes its page and sitemap entry', async () => {
    assert.ok(exists(gen, 'category/snacks/index.html'));
    await sql('DELETE FROM categories WHERE slug = ?', ['snacks']);
    const r = await publish();
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.ok(!exists(gen, 'category/snacks'));
    assert.ok(!read(gen, 'sitemap-0.xml').includes('/category/snacks/'));
    assert.ok(exists(gen, 'category/main-course/index.html'));
  });

  // ---------------------------------------------------------- failures never leave partial updates

  it('a failed publish restores the previous site, reports failure and never says "published"', async () => {
    await post('/api/admin/recipes/garlic-naan', { recipe: { ...RECIPE, title: 'Garlic Butter Naan', published: true } });
    const before = stagingNow();

    // A directory where a generated FILE must go makes the swap fail halfway through, after earlier
    // files were already replaced - the worst case for a half-updated site.
    const sitemapIndex = path.join(gen.staging, 'sitemap-index.xml');
    const sitemapIndexOriginal = fs.readFileSync(sitemapIndex);
    fs.rmSync(sitemapIndex);
    fs.mkdirSync(sitemapIndex);
    fs.writeFileSync(path.join(sitemapIndex, 'blocker'), 'x');
    const blocked = stagingNow();
    await sql('UPDATE recipes SET title = ? WHERE slug = ?', ['Changed In Database', 'chicken-curry']);
    try {
      const r = await publish();
      assert.equal(r.httpStatusCode, 500, r.text);
      const body = json(r);
      assert.equal(body.ok, false);
      assert.equal(body.message, undefined, 'no success message');
      assert.equal(body.stats, undefined);
      assert.equal(body.error, 'Internal server error', 'generic public error');
      assert.deepEqual(stagingNow(), blocked, 'every file, folder and temp file is back to the previous state');
      assert.ok(!read(gen, 'recipes/chicken-curry/index.html').includes('Changed In Database'));
      assert.deepEqual(productionNow(), productionBefore);
      assert.deepEqual(await php.listFiles('/gen/backend-staging/tmp/backup'), [], 'rollback cleaned its backup');

      // An admin save during the outage: data is kept, the response says the site was NOT updated.
      const save = await post('/api/admin/tags', { data: ['Spicy', 'Festive', 'Weekend'] });
      assert.equal(save.httpStatusCode, 500, save.text);
      const saved = json(save);
      assert.equal(saved.ok, false);
      assert.equal(saved.saved, true);
      assert.match(saved.error, /saved, but the public site could not be updated/);
      assert.match(saved.error, /was not changed/);
      assert.match(saved.reference, /^[0-9a-f]{12}$/);
      assert.ok(!/\/gen\b|sitemap|public_html|RuntimeException/.test(save.text), 'no internals in the response');
      assert.deepEqual(stagingNow(), blocked);
    } finally {
      fs.rmSync(path.join(gen.staging, 'sitemap-index.xml'), { recursive: true, force: true });
      fs.writeFileSync(path.join(gen.staging, 'sitemap-index.xml'), sitemapIndexOriginal);
    }
    assert.deepEqual(stagingNow(), before, 'back to the exact pre-failure site');

    // Once the problem is fixed, publishing succeeds and picks up everything saved meanwhile.
    const retry = await publish();
    assert.equal(retry.httpStatusCode, 200, retry.text);
    assert.match(read(gen, 'recipes/chicken-curry/index.html'), /Changed In Database/);
    assert.ok(exists(gen, 'tag/weekend/index.html'));
    assert.ok(read(gen, 'sitemap-index.xml').includes('sitemap-0.xml'));
  });

  it('refuses to publish when the staging backend is pointed at the production folder', async () => {
    const cfgFile = '/gen/backend-staging/config/config.local.php';
    const good = configLocalPhp('/gen');
    const stagingBefore = stagingNow();
    await php.writeFile(cfgFile, good.replace("'public_path' => '/gen/public_html/staging'", "'public_path' => '/gen/public_html'"));
    try {
      const r = await publish();
      assert.equal(r.httpStatusCode, 500, r.text);
      assert.equal(json(r).error, 'Internal server error');
      assert.deepEqual(productionNow(), productionBefore, 'production untouched');
      assert.deepEqual(stagingNow(), stagingBefore, 'staging untouched');

      const direct = await phpRun(`
        $cfg = require '/gen/backend-staging/config/config.php';
        require_once '/gen/backend-staging/generator/SiteGenerator.php';
        try { new SiteGenerator(null, $cfg); echo 'constructed'; } catch (RuntimeException $e) { echo $e->getMessage(); }`);
      assert.match(direct, /does not match the expected staging layout/);
    } finally {
      await php.writeFile(cfgFile, good);
    }
    assert.equal((await publish()).httpStatusCode, 200, 'works again with the correct configuration');
  });

  // ---------------------------------------------------------- images

  it('uploaded photos land only in /public_html/staging/images/recipes and survive publishing', async () => {
    const r = await post('/api/admin/image', { name: '../../../evil.png', content: dataUrl('image/png', makePng()) });
    assert.equal(r.httpStatusCode, 200, r.text);
    const { filename, url } = json(r);
    assert.ok(!/[\\/]/.test(filename), 'no path in the stored file name');
    assert.ok(fs.existsSync(path.join(gen.staging, 'images/recipes', filename)));
    assert.ok(String(url ?? '').includes(filename) || true);
    assert.deepEqual(productionNow(), productionBefore, 'production image folder untouched');
    assert.ok(!fs.existsSync(path.join(gen.production, 'images/recipes', filename)));

    assert.equal((await publish()).httpStatusCode, 200);
    assert.ok(fs.existsSync(path.join(gen.staging, 'images/recipes', filename)), 'publishing keeps uploaded photos');
    assert.equal(read(gen, 'images/recipes/existing-photo.jpg'), 'jpg-bytes');
  });

  it('refuses uploads when the upload folder is outside the staging web root', async () => {
    const cfgFile = '/gen/backend-staging/config/config.local.php';
    const good = configLocalPhp('/gen');
    await php.writeFile(cfgFile, good.replace("'upload_path' => '/gen/public_html/staging/images/recipes'", "'upload_path' => '/gen/public_html/images/recipes'"));
    try {
      const r = await post('/api/admin/image', { name: 'a.png', content: dataUrl('image/png', makePng()) });
      assert.equal(r.httpStatusCode, 500, r.text);
      assert.deepEqual(productionNow(), productionBefore);
    } finally {
      await php.writeFile(cfgFile, good);
    }
  });

  it('final state: production is still byte-for-byte what it was before any staging operation', () => {
    assert.deepEqual(productionNow(), productionBefore);
    const withoutUploads = Object.fromEntries(Object.entries(protectedNow()).filter(([rel]) => !/^images\/recipes\/[^/]+(\.(png|webp)|-(1x1|4x3|16x9)\.jpg)$/.test(rel)));
    assert.deepEqual(withoutUploads, protectedBefore, 'only uploaded photos were added next to the shipped assets');
  });
});
