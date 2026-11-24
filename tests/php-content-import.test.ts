/**
 * Import of the existing content (recipes, categories, tags, menu committed on the Hostinger branch) into the
 * staging MySQL database through backend/db/import-content.php, and the admin working on that data.
 *
 * What runs: the real import script, RecipeService, ConfigService, Auth, SiteGenerator and api/index.php
 * executed by PHP 8.3 compiled to WebAssembly, with SQLite standing in for MySQL (the stand-in rejects
 * a named parameter used twice, as MySQL does). It is NOT Hostinger's PHP or MySQL.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  php, makeTmp, makeSite, startPhp, stopPhp, call, json, login, client, authed, phpRun, writeFile, rootDir,
  ADMIN_USER, ADMIN_PASS, type Site,
} from './helpers/php-harness.ts';

// ---------------------------------------------------------------- the content committed on the Hostinger branch (HEAD)

const git = (...args: string[]): string => {
  const r = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const branchFiles = (dir: string) => git('ls-tree', '-r', '--name-only', 'HEAD', '--', dir).split('\n').filter(Boolean);

type Recipe = {
  slug?: string; title: string; category: string; tags?: string[]; published?: boolean; featured?: boolean; image?: string;
  ingredients?: unknown[]; steps?: Array<{ image?: string }>; [k: string]: unknown;
};
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const recipeFiles = branchFiles('src/content/recipes').filter((f) => f.endsWith('.json'));
const recipes: Recipe[] = recipeFiles.map((f) => {
  const r = JSON.parse(git('show', `HEAD:${f}`));
  r.slug ??= path.basename(f, '.json');
  return r;
});
const categories: Array<{ slug: string; name: string }> = JSON.parse(git('show', 'HEAD:config/categories.json'));
const tagList: string[] = JSON.parse(git('show', 'HEAD:config/tags.json'));
const menu: Array<{ label: string; visible?: boolean }> = JSON.parse(git('show', 'HEAD:config/menu.json'));
const uniqueTags = new Map<string, string>();
for (const name of [...tagList, ...recipes.flatMap((r) => r.tags ?? [])]) if (!uniqueTags.has(slugify(name))) uniqueTags.set(slugify(name), name);

// ---------------------------------------------------------------- helpers

let site: Site;
let c: Awaited<ReturnType<typeof authed>>['c'];
let csrf = '';

const SEED = '/imp/backend-staging/seed';
const PDO = `require_once '/testlib/schema.php'; $pdo = jyo_test_pdo('imp', true);`;

/** Run the importer exactly as the CLI does, against the shipped seed folder. */
async function runImport(options = '[]', seed = SEED): Promise<any> {
  const out = await phpRun(`${PDO}
    require_once '/imp/backend-staging/db/import-content.php';
    [$cfg, $rec] = importSeedPaths('${seed}');
    echo json_encode(importContent($pdo, $cfg, $rec, ${options}));`);
  return JSON.parse(out);
}

/** Run a SELECT / statement and return the rows. */
async function sql(statement: string, params: unknown[] = []): Promise<any[]> {
  const b64 = Buffer.from(JSON.stringify(params)).toString('base64');
  const out = await phpRun(`${PDO}
    $st = $pdo->prepare(${JSON.stringify(statement)});
    $st->execute(json_decode(base64_decode('${b64}'), true));
    echo json_encode($st->columnCount() ? $st->fetchAll() : []);`);
  return JSON.parse(out);
}
const count = async (table: string) => Number((await sql(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);
const post = (url: string, body?: unknown) => call(c, 'POST', url, body, { 'X-CSRF-Token': csrf });
const stagingFile = (rel: string) => path.join(site.staging, rel);

// ---------------------------------------------------------------- suite

describe('Importing the Hostinger-branch content into the staging database (WASM PHP 8.3 + SQLite stand-in)', () => {
  before(async () => {
    makeTmp();
    site = makeSite('imp');
    // The seed exactly as the packager ships it: files read from the committed Hostinger branch.
    const seedDir = path.join(site.dir, 'backend-staging/seed');
    for (const f of [...recipeFiles, ...['categories', 'tags', 'menu'].map((n) => `config/${n}.json`)]) {
      writeFile(path.join(seedDir, f.replace(/^src\/content\/recipes\//, 'recipes/')), git('show', `HEAD:${f}`));
    }
    fs.writeFileSync(stagingFile('index.html'), '<h1>ASTRO HOME</h1>');
    await startPhp();
    ({ c, csrf } = await authed(site, 'full'));
  });

  after(stopPhp);

  it('the branch holds the content the import is expected to carry over', () => {
    assert.equal(recipes.length, 8, 'recipes in branch');
    assert.equal(categories.length, 8, 'categories in branch');
    assert.equal(uniqueTags.size, 14, 'unique tags in branch (tags.json plus every tag a recipe uses)');
    assert.equal(menu.length, 11, 'menu items in branch');
  });

  it('every image referenced by the branch content exists in the branch (nothing is missing)', () => {
    const inBranch = new Set(branchFiles('public/images'));
    const missing: string[] = [];
    for (const r of recipes) {
      for (const img of [r.image, ...(r.steps ?? []).map((s) => s.image)]) if (img && !inBranch.has(`public${img}`)) missing.push(`${r.slug}: ${img}`);
    }
    assert.deepEqual(missing, []);
  });

  it('a dry run reports what would be added and writes nothing', async () => {
    const r = await runImport("['dry_run' => true]");
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.created, { categories: 8, tags: 14, recipes: 8, menu_items: 11 });
    for (const t of ['recipes', 'categories', 'tags', 'menu_items', 'recipe_tags']) assert.equal(await count(t), 0, t);
  });

  it('imports every recipe, category, tag and menu item without errors or unmapped fields', async () => {
    const r = await runImport();
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, [], 'no unmapped field, unknown category or other warning');
    assert.deepEqual(r.source, { categories: 8, tags: 14, recipes: 8, menu_items: 11 });
    assert.deepEqual(r.created, { categories: 8, tags: 14, recipes: 8, menu_items: 11 });
    assert.equal(await count('recipes'), 8);
    assert.equal(await count('categories'), 8);
    assert.equal(await count('tags'), 14);
    assert.equal(await count('menu_items'), 11);
  });

  it('stores each recipe with its category, tags, ingredients, steps, flags and exact slug', async () => {
    for (const r of recipes) {
      const [row] = await sql('SELECT * FROM recipes WHERE slug = ?', [r.slug]);
      assert.ok(row, `${r.slug} missing`);
      assert.equal(row.title, r.title);
      assert.equal(row.category_slug, r.category);
      assert.equal(Number(row.published), r.published ? 1 : 0, `${r.slug} published`);
      assert.equal(Number(row.featured), r.featured ? 1 : 0, `${r.slug} featured`);
      assert.equal(row.image, r.image);
      const tags = (await sql('SELECT t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = ? ORDER BY t.name', [row.id])).map((t) => t.name);
      assert.deepEqual(tags, [...(r.tags ?? [])].sort(), `${r.slug} tags`);
      assert.equal((await sql('SELECT COUNT(*) AS n FROM recipe_ingredients WHERE recipe_id = ?', [row.id]))[0].n, (r.ingredients ?? []).length, `${r.slug} ingredients`);
      assert.equal((await sql('SELECT COUNT(*) AS n FROM recipe_steps WHERE recipe_id = ?', [row.id]))[0].n, (r.steps ?? []).length, `${r.slug} steps`);

    }
    const cats = await sql('SELECT slug, name FROM categories ORDER BY order_num');
    assert.deepEqual(cats.map((x) => x.slug), categories.map((x) => x.slug));
    assert.deepEqual(cats.map((x) => x.name), categories.map((x) => x.name));
  });

  it('a second run changes nothing: no duplicates, same ids, nothing created', async () => {
    const before = await sql('SELECT id, slug FROM recipes ORDER BY id');
    const r = await runImport();
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.created, { categories: 0, tags: 0, recipes: 0, menu_items: 0 });
    assert.deepEqual(r.skipped, { categories: 8, tags: 14, recipes: 8, menu_items: 11 });
    assert.deepEqual(await sql('SELECT id, slug FROM recipes ORDER BY id'), before);
    for (const [table, n] of [['recipes', 8], ['categories', 8], ['tags', 14], ['menu_items', 11]] as const) assert.equal(await count(table), n, table);
    assert.equal((await sql('SELECT COUNT(*) AS n FROM (SELECT slug FROM recipes GROUP BY slug HAVING COUNT(*) > 1)'))[0].n, 0);
    assert.equal(await count('recipe_ingredients'), (await sql('SELECT COUNT(*) AS n FROM recipe_ingredients'))[0].n);
  });

  it('preserves everything edited in the admin when the import is run again', async () => {
    const slug = 'masala-dosa';
    const [{ id }] = await sql('SELECT id FROM recipes WHERE slug = ?', [slug]);
    const ingredientsBefore = Number((await sql('SELECT COUNT(*) AS n FROM recipe_ingredients'))[0].n);
    // Edits an administrator could have made on staging.
    await sql('UPDATE recipes SET title = ?, published = 0, featured = 1 WHERE slug = ?', ['Edited Dosa', slug]);
    await sql('UPDATE categories SET name = ? WHERE slug = ?', ['Edited Breakfast', 'breakfast']);
    await sql('DELETE FROM recipe_tags WHERE recipe_id = ?', [id]);
    await sql('DELETE FROM recipe_steps WHERE recipe_id = ? AND order_num = 0', [id]);
    await sql('INSERT INTO tags (name, slug) VALUES (?, ?)', ['Staging Only', 'staging-only']);
    await sql('DELETE FROM menu_items WHERE label = ?', [menu[0].label]);

    const r = await runImport();
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.created, { categories: 0, tags: 0, recipes: 0, menu_items: 0 });

    const [row] = await sql('SELECT title, published, featured FROM recipes WHERE slug = ?', [slug]);
    assert.deepEqual({ ...row }, { title: 'Edited Dosa', published: 0, featured: 1 });
    assert.equal((await sql('SELECT name FROM categories WHERE slug = ?', ['breakfast']))[0].name, 'Edited Breakfast');
    assert.equal((await sql('SELECT COUNT(*) AS n FROM recipe_tags WHERE recipe_id = ?', [id]))[0].n, 0, 'removed tag links stay removed');
    assert.ok(Number((await sql('SELECT COUNT(*) AS n FROM recipe_ingredients'))[0].n) === ingredientsBefore);
    assert.equal(await count('menu_items'), 10, 'a menu edited in the admin is not restored');
    assert.equal((await sql('SELECT COUNT(*) AS n FROM tags WHERE slug = ?', ['staging-only']))[0].n, 1);
    assert.equal(await count('tags'), 15);
    assert.equal(await count('recipes'), 8);

    // Put the data back for the remaining tests.
    await sql('UPDATE recipes SET title = ?, published = 1, featured = 0 WHERE slug = ?', [recipes.find((x) => x.slug === slug)!.title, slug]);
    await sql('DELETE FROM tags WHERE slug = ?', ['staging-only']);
    for (const t of recipes.find((x) => x.slug === slug)!.tags ?? []) {
      await sql('INSERT INTO recipe_tags (recipe_id, tag_id) SELECT ?, id FROM tags WHERE name = ?', [id, t]);
    }
    await sql('INSERT INTO menu_items (label, href, order_num, visible) VALUES (?, ?, 0, 1)', [menu[0].label, '/']);
    await sql('UPDATE categories SET name = ? WHERE slug = ?', [categories.find((x) => x.slug === 'breakfast')!.name, 'breakfast']);
  });

  it('refuses to import a recipe whose slug the admin would rewrite (the public URL must not change)', async () => {
    const dir = '/imp/oddseed';
    await php.mkdir(dir);
    await php.mkdir(`${dir}/recipes`);
    await php.mkdir(`${dir}/config`);
    await php.writeFile(`${dir}/recipes/Odd Slug.json`, new TextEncoder().encode(JSON.stringify({ title: 'Odd', category: 'curries', published: true })));
    const r = await runImport('[]', dir);
    assert.equal(r.created.recipes, 0);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /public URL/);
    assert.equal(await count('recipes'), 8);
  });

  it('reports missing images and unknown fields instead of hiding them', async () => {
    const dir = '/imp/warnseed';
    await php.mkdir(dir);
    await php.mkdir(`${dir}/recipes`);
    await php.mkdir(`${dir}/config`);
    await php.writeFile(`${dir}/recipes/warn-me.json`, new TextEncoder().encode(JSON.stringify({
      title: 'Warn Me', category: 'curries', published: true, image: '/images/recipes/nope.png', videoUrl: 'x',
      ingredients: [{ name: 'salt', amount: 1, unit: 'tsp', note: 'fine' }],
    })));
    const r = await runImport(`['dry_run' => true, 'public_path' => '/imp/public_html/staging']`, dir);
    const text = r.warnings.join('\n');
    assert.match(text, /videoUrl/);
    assert.match(text, /ingredient field 'note'/);
    assert.match(text, /image file not found.*nope\.png/);
  });

  // ------------------------------------------------------------ the admin on the imported data

  it('the admin lists every imported recipe with its category', async () => {
    const r = await call(c, 'GET', '/api/admin/recipes');
    assert.equal(r.httpStatusCode, 200, r.text);
    const list = json(r).data as Array<{ slug: string; category: string; title: string }>;
    assert.deepEqual(list.map((x) => x.slug).sort(), recipes.map((x) => x.slug!).sort());
    for (const rec of recipes) assert.equal(list.find((x) => x.slug === rec.slug)!.category, rec.category);
  });

  it('the category and tag selectors list all imported categories and tags', async () => {
    const cats = json(await call(c, 'GET', '/api/admin/categories')).data;
    assert.deepEqual(cats.map((x: { slug: string }) => x.slug), categories.map((x) => x.slug));
    const tags: string[] = json(await call(c, 'GET', '/api/admin/tags')).data;
    assert.deepEqual([...tags].sort(), [...uniqueTags.values()].sort());
  });

  it('the menu reports visibility as a real boolean (the admin UI tests !== false)', async () => {
    const data = json(await call(c, 'GET', '/api/admin/menu')).data as Array<{ visible: unknown; order: unknown }>;
    assert.equal(data.length, 11);
    for (const item of data) {
      assert.equal(typeof item.visible, 'boolean');
      assert.equal(typeof item.order, 'number');
    }
  });

  it('sub categories are a plain list, mapped to categories, and filter the category pages', async () => {
    const dup = await post('/api/admin/subcategories', { data: [{ name: 'Veg' }, { name: 'Veg' }] });
    assert.equal(dup.httpStatusCode, 400, dup.text);

    const ok = await post('/api/admin/subcategories', {
      data: [{ name: 'Non-Vegetarian', order: 1 }, { name: 'Vegetarian', order: 2 }],
    });
    assert.equal(ok.httpStatusCode, 200, ok.text);
    const list = json(await call(c, 'GET', '/api/admin/subcategories')).data as Array<{ slug: string }>;
    assert.deepEqual(list.map((x) => x.slug), ['non-vegetarian', 'vegetarian']);

    // Map both sub categories to curries only (the Categories tab).
    const cats = json(await call(c, 'GET', '/api/admin/categories')).data as Array<{ slug: string; subcategories?: string[] }>;
    assert.deepEqual(cats.find((x) => x.slug === 'curries')?.subcategories, []);
    const mapped = await post('/api/admin/categories', {
      data: cats.map((x) => ({ ...x, subcategories: x.slug === 'curries' ? ['non-vegetarian', 'vegetarian'] : [] })),
    });
    assert.equal(mapped.httpStatusCode, 200, mapped.text);
    const after = json(await call(c, 'GET', '/api/admin/categories')).data as Array<{ slug: string; subcategories: string[] }>;
    assert.deepEqual(after.find((x) => x.slug === 'curries')?.subcategories, ['non-vegetarian', 'vegetarian']);

    // Make every curry non-vegetarian and tick an unmapped sub category on a breakfast recipe.
    for (const currySlug of recipes.filter((x) => x.category === 'curries').map((x) => x.slug)) {
      const curry = json(await call(c, 'GET', `/api/admin/recipes/${currySlug}`)).recipe;
      curry.subcategories = ['non-vegetarian'];
      const tick = await post(`/api/admin/recipes/${currySlug}`, { recipe: curry });
      assert.equal(tick.httpStatusCode, 200, tick.text);
    }
    const dosa = json(await call(c, 'GET', '/api/admin/recipes/masala-dosa')).recipe;
    dosa.subcategories = ['vegetarian'];
    const tickDosa = await post('/api/admin/recipes/masala-dosa', { recipe: dosa });
    assert.equal(tickDosa.httpStatusCode, 200, tickDosa.text);

    // Only sub categories that the page's recipes use are offered, and only on mapped categories.
    const curries = fs.readFileSync(stagingFile('category/curries/index.html'), 'utf8');
    assert.match(curries, /data-subcategory="non-vegetarian" aria-pressed="false">Non-Vegetarian</);
    assert.ok(!curries.includes('>Vegetarian</button>'), 'an unused sub category is not offered');
    assert.ok(!fs.readFileSync(stagingFile('category/breakfast/index.html'), 'utf8').includes('subcategory-chips'),
      'a sub category the category does not offer is ignored');
  });

  it('the Vegetarian and Non-Vegetarian pages filter by category, not by sub category', async () => {
    const page = fs.readFileSync(stagingFile('category/non-vegetarian/index.html'), 'utf8');
    assert.match(page, /aria-label="Filter by category"/);
    assert.match(page, /data-subcategory="curries" aria-pressed="false">Curries</);
    assert.match(page, /<div data-subcategory="curries">/);
    assert.ok(!page.includes('Filter by subcategory'));
  });

  it('publishing creates the same public URLs as the existing site: /recipes/<slug>/, /category/<slug>/, /tag/<slug>/', async () => {
    const r = await post('/api/admin/publish');
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.equal(json(r).stats.recipes_count, recipes.filter((x) => x.published).length);
    for (const rec of recipes.filter((x) => x.published)) {
      const page = stagingFile(`recipes/${rec.slug}/index.html`);
      assert.ok(fs.existsSync(page), `/recipes/${rec.slug}/ missing`);
      assert.ok(fs.readFileSync(page, 'utf8').includes(rec.title.replace(/&/g, '&amp;')), `${rec.slug} page has its title`);
    }
    for (const cat of categories) assert.ok(fs.existsSync(stagingFile(`category/${cat.slug}/index.html`)), `/category/${cat.slug}/ missing`);
    for (const slug of uniqueTags.keys()) assert.ok(fs.existsSync(stagingFile(`tag/${slug}/index.html`)), `/tag/${slug}/ missing`);
    assert.ok(!fs.readFileSync(stagingFile('index.html'), 'utf8').includes('ASTRO HOME'));
  });

  it('an imported recipe can be opened, edited and published; category, tags and steps are kept', async () => {
    const slug = 'andhra-chicken-curry';
    const original = recipes.find((x) => x.slug === slug)!;
    const open = await call(c, 'GET', `/api/admin/recipes/${slug}`);
    assert.equal(open.httpStatusCode, 200, open.text);
    const recipe = json(open).recipe;
    assert.equal(recipe.category, original.category);
    assert.deepEqual([...recipe.tags].sort(), [...(original.tags ?? [])].sort());

    recipe.title = 'Andhra Chicken Curry (edited on staging)';
    const saved = await post(`/api/admin/recipes/${slug}`, { recipe });
    assert.equal(saved.httpStatusCode, 200, saved.text);
    const body = json(saved);
    assert.equal(body.ok, true);
    assert.equal(body.slug, slug, 'slug and URL unchanged');
    assert.equal(body.generation.ok, true, 'saving publishes the page');

    const after = json(await call(c, 'GET', `/api/admin/recipes/${slug}`)).recipe;
    assert.equal(after.title, 'Andhra Chicken Curry (edited on staging)');
    assert.equal(after.category, original.category);
    assert.deepEqual([...after.tags].sort(), [...(original.tags ?? [])].sort());
    assert.equal(after.ingredients.length, (original.ingredients ?? []).length);
    assert.equal(after.steps.length, (original.steps ?? []).length);
    assert.equal(after.published, true);
    assert.match(fs.readFileSync(stagingFile(`recipes/${slug}/index.html`), 'utf8'), /edited on staging/);
    assert.equal(await count('recipes'), 8, 'no duplicate created');
  });

  it('the recipe page shows Tbsp with a capital and renders bulleted and numbered instructions as lists', async () => {
    const slug = 'andhra-chicken-curry';
    const recipe = json(await call(c, 'GET', `/api/admin/recipes/${slug}`)).recipe;
    recipe.ingredients[0].unit = 'tbsp';
    recipe.steps[0].text = '\u2022 Heat the oil\n\u2022 Add the onions';
    recipe.steps[1].text = '1. Add the spices\n2. Stir well';
    const saved = await post(`/api/admin/recipes/${slug}`, { recipe });
    assert.equal(saved.httpStatusCode, 200, saved.text);

    const page = fs.readFileSync(stagingFile(`recipes/${slug}/index.html`), 'utf8');
    assert.match(page, /<\/span> Tbsp /);
    assert.ok(!/<\/span> tbsp /.test(page), 'the unit is shown as Tbsp');
    assert.match(page, /<ul><li>Heat the oil<\/li><li>Add the onions<\/li><\/ul>/);
    assert.match(page, /<ol><li>Add the spices<\/li><li>Stir well<\/li><\/ol>/);
  });


  it('the Diets tab: diets are listed, added, used by recipes, renamed and protected while in use', async () => {
    const diets = json(await call(c, 'GET', '/api/admin/diets')).data;
    assert.deepEqual(diets.map((d: { name: string }) => d.name), ['Vegetarian', 'Non-Vegetarian']);

    // Add Vegan, then give a recipe that diet; its page is published at /category/vegan/.
    const added = await post('/api/admin/diets', { data: [...diets, { name: 'Vegan', order: 3 }] });
    assert.equal(added.httpStatusCode, 200, added.text);
    assert.deepEqual(json(added).data.map((d: { slug: string }) => d.slug), ['vegetarian', 'non-vegetarian', 'vegan']);

    const dosa = json(await call(c, 'GET', '/api/admin/recipes/masala-dosa')).recipe;
    dosa.diet = 'Vegan';
    assert.equal((await post('/api/admin/recipes/masala-dosa', { recipe: dosa })).httpStatusCode, 200);
    const vegan = fs.readFileSync(stagingFile('category/vegan/index.html'), 'utf8');
    assert.match(vegan, /Masala Dosa/);
    assert.match(vegan, /aria-label="Filter by category"/);
    assert.ok(!fs.readFileSync(stagingFile('category/vegetarian/index.html'), 'utf8').includes('Masala Dosa'), 'a Vegan recipe is not on the Vegetarian page');

    // A diet that is not in the list is refused; a diet that recipes use cannot be removed.
    dosa.diet = 'Pescatarian';
    const unknown = await post('/api/admin/recipes/masala-dosa', { recipe: dosa });
    assert.equal(unknown.httpStatusCode, 400, unknown.text);
    const removed = await post('/api/admin/diets', { data: diets });
    assert.equal(removed.httpStatusCode, 400, removed.text);
    assert.match(removed.text, /Vegan.*used by 1 recipe/);

    // Renaming keeps the slug and renames the diet on its recipes.
    const renamed = await post('/api/admin/diets', {
      data: [...diets, { name: 'Plant-based', slug: 'vegan', order: 3 }],
    });
    assert.equal(renamed.httpStatusCode, 200, renamed.text);
    assert.equal(json(await call(c, 'GET', '/api/admin/recipes/masala-dosa')).recipe.diet, 'Plant-based');

    // Put the recipe back and remove the extra diet again.
    dosa.diet = 'Vegetarian';
    assert.equal((await post('/api/admin/recipes/masala-dosa', { recipe: dosa })).httpStatusCode, 200);
    assert.equal((await post('/api/admin/diets', { data: diets })).httpStatusCode, 200);
    assert.ok(!fs.existsSync(stagingFile('category/vegan/index.html')), 'the page of a removed diet is removed');
  });

  it('saving the Tags tab keeps every recipe-tag link', async () => {
    const linksBefore = await count('recipe_tags');
    assert.ok(linksBefore > 0);
    const all: string[] = json(await call(c, 'GET', '/api/admin/tags')).data;
    const r = await post('/api/admin/tags', { data: [...all, 'Brand New Tag'] });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.equal(await count('recipe_tags'), linksBefore, 'links survive a Tags save');
    assert.equal(await count('tags'), 15);
    const back = await post('/api/admin/tags', { data: all });
    assert.equal(back.httpStatusCode, 200, back.text);
    assert.equal(await count('recipe_tags'), linksBefore);
    assert.equal(await count('tags'), 14);
  });

  it('a re-run after admin edits keeps the edited recipe and its links', async () => {
    const r = await runImport();
    assert.deepEqual(r.created, { categories: 0, tags: 0, recipes: 0, menu_items: 0 });
    assert.equal((await sql('SELECT title FROM recipes WHERE slug = ?', ['andhra-chicken-curry']))[0].title, 'Andhra Chicken Curry (edited on staging)');
  });

  // ------------------------------------------------------------ authentication and scripts

  it('admin login still works with the username and with the e-mail address (separate :username / :email parameters)', async () => {
    const byName = await login(client(site, { boot: 'full' }));
    assert.equal(byName.httpStatusCode, 200, byName.text);
    const byEmail = await call(client(site, { boot: 'full' }), 'POST', '/api/auth/login', { username: 'admin@example.test', password: ADMIN_PASS });
    assert.equal(byEmail.httpStatusCode, 200, byEmail.text);
    const wrong = await call(client(site, { boot: 'full' }), 'POST', '/api/auth/login', { username: ADMIN_USER, password: 'wrong-password' });
    assert.equal(wrong.httpStatusCode, 401);
    const anon = await call(client(site, { boot: 'full' }), 'GET', '/api/admin/recipes');
    assert.equal(anon.httpStatusCode, 401, 'admin API still needs a session');
    const noCsrf = await call(c, 'POST', '/api/admin/publish');
    assert.ok([400, 401, 403].includes(noCsrf.httpStatusCode), `publish without a CSRF token must be refused (${noCsrf.httpStatusCode})`);
  });

  it('create-admin.php opens the database only after the prompts (Hostinger closes idle connections after 20 s)', () => {
    const code = fs.readFileSync(path.join(rootDir, 'backend/db/create-admin.php'), 'utf8');
    const connect = code.indexOf('Database::getConnection()');
    assert.ok(connect > 0, 'connects to the database');
    for (const marker of ['password_hash(', 'stty -echo']) {
      assert.ok(code.indexOf(marker) < connect, `${marker} must come before the connection is opened`);
    }
    assert.equal(code.split('Database::getConnection()').length - 1, 1, 'a single, late connection');
  });

  it('migrate.php is non-destructive: it delegates to the importer and never overwrites or deletes content', () => {
    const code = fs.readFileSync(path.join(rootDir, 'backend/db/migrate.php'), 'utf8');
    assert.match(code, /importContent\(/);
    assert.ok(!/DELETE\s+FROM/i.test(code), 'no DELETE');
    assert.ok(!/ON DUPLICATE KEY/i.test(code), 'no upsert over existing rows');
    const importer = fs.readFileSync(path.join(rootDir, 'backend/db/import-content.php'), 'utf8');
    assert.ok(!/DELETE\s+FROM|UPDATE\s+`|ON DUPLICATE KEY|TRUNCATE/i.test(importer), 'the importer only inserts');
    assert.ok(!/password|secret|getenv|print_r\(\$pdo|DB_PASS|'pass'/i.test(importer), 'no credentials handled or printed');
  });
});
