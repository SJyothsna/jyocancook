/**
 * Shared harness for the PHP runtime tests.
 *
 * IMPORTANT - what this actually runs: PHP 8.3 compiled to WebAssembly (@php-wasm/node) driven
 * from Node, with a SQLite stand-in injected for the database. It is NOT Hostinger's PHP build and
 * NOT MySQL. It exercises the real api/index.php, backend/ and generator code, but MySQL-only SQL
 * is not covered (SQLite gets small shims for NOW() and IF()).
 *
 * Every test site reproduces the Hostinger staging layout:
 *
 *   <site>/public_html/                 production web root (sentinel files that must never change)
 *   <site>/public_html/staging/         staging web root: index.html, api/, recipes/, ...
 *   <site>/backend-staging/             private backend (copied into the WASM memory FS)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PHP, PHPRequestHandler } from '@php-wasm/universal';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STAGING_HOST = 'staging.example.test';
export const HTTPS_URL = `https://${STAGING_HOST}`;
export const HTTP_URL = `http://${STAGING_HOST}`;
export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'Test-Passw0rd!';

export let php: PHP;
export let tmpBase = '';
const mounts: Record<string, string> = {};

// ---------------------------------------------------------------- helpers

export function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A real, valid RGB PNG of the given size. */
export function makePng(w = 8, h = 8): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x7f)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const dataUrl = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`;

// SQLite versions of backend/db/schema.sql (only the columns the app reads/writes) plus the SQL
// functions MySQL provides and the app uses. Lives in the WASM memory FS, not in any web root.
const SCHEMA_PHP = `<?php
function jyo_test_schema(PDO $pdo): void {
  $pdo->sqliteCreateFunction('NOW', fn() => gmdate('Y-m-d H:i:s'), 0);
  $pdo->sqliteCreateFunction('IF', fn($c, $a, $b) => $c ? $a : $b, 3);
  $pdo->exec('CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password_hash TEXT)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip_address TEXT, attempted_at TEXT)');
  if ((int)$pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn() === 0) {
    $pdo->prepare('INSERT INTO admins (username, email, password_hash) VALUES (?, ?, ?)')
        ->execute(['${ADMIN_USER}', 'admin@example.test', password_hash('${ADMIN_PASS}', PASSWORD_DEFAULT)]);
  }
}
function jyo_test_content_schema(PDO $pdo): void {
  $pdo->exec("CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', order_num INTEGER NOT NULL DEFAULT 0)");
  $pdo->exec("CREATE TABLE IF NOT EXISTS category_subcategories (category_slug TEXT NOT NULL, subcategory_slug TEXT NOT NULL, PRIMARY KEY (category_slug, subcategory_slug))");

  $pdo->exec("CREATE TABLE IF NOT EXISTS subcategories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, order_num INTEGER NOT NULL DEFAULT 0)");
  $pdo->exec("CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, slug TEXT UNIQUE NOT NULL)");
  $pdo->exec("CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, href TEXT NOT NULL, order_num INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1)");
  $pdo->exec("CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category_slug TEXT NOT NULL, subcategory_slug TEXT, diet TEXT NOT NULL DEFAULT 'Vegetarian', prep_time INTEGER NOT NULL DEFAULT 15, cook_time INTEGER NOT NULL DEFAULT 30, servings INTEGER NOT NULL DEFAULT 4, difficulty TEXT NOT NULL DEFAULT 'Easy', image TEXT NOT NULL DEFAULT '/images/recipes/recipe-placeholder.svg', published INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0, story TEXT, youtube_url TEXT, calories INTEGER, carbs REAL, protein REAL, fat REAL, fiber REAL, tips_json TEXT, serve_with_json TEXT, created_at TEXT, updated_at TEXT, published_at TEXT)");
  $pdo->exec("CREATE TABLE IF NOT EXISTS recipe_ingredients (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id INTEGER NOT NULL, section TEXT, name TEXT NOT NULL, amount REAL, unit TEXT NOT NULL DEFAULT '', order_num INTEGER NOT NULL DEFAULT 0)");
  $pdo->exec("CREATE TABLE IF NOT EXISTS recipe_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT 'Step', text TEXT NOT NULL, image TEXT, order_num INTEGER NOT NULL DEFAULT 0)");
  $pdo->exec("CREATE TABLE IF NOT EXISTS recipe_tags (recipe_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (recipe_id, tag_id))");
  $pdo->exec("CREATE TABLE IF NOT EXISTS publish_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL DEFAULT 'pending', triggered_by TEXT NOT NULL DEFAULT 'admin', message TEXT NOT NULL DEFAULT '', details_json TEXT, started_at TEXT, completed_at TEXT)");
}
// MySQL spells it INSERT IGNORE, SQLite INSERT OR IGNORE. Nothing else is rewritten.
class JyoTestPdo extends PDO {
  #[\\ReturnTypeWillChange]
  public function prepare(string $query, array $options = []) {
    // MySQL (native prepares, as used on Hostinger) rejects a named parameter used twice; SQLite
    // silently accepts it. Fail here too so such a query cannot pass the tests and break on MySQL.
    $bare = preg_replace('/\\'[^\\']*\\'/', "''", $query);
    if (preg_match_all('/(?<![:\\w]):([A-Za-z_]\\w*)/', (string)$bare, $m) && count($m[1]) !== count(array_unique($m[1]))) {
      throw new PDOException('SQLSTATE[HY093]: Invalid parameter number (named parameter used twice): ' . $query);
    }
    return parent::prepare(preg_replace('/^(\\s*)INSERT\\s+IGNORE\\s+INTO/i', '$1INSERT OR IGNORE INTO', $query), $options);
  }
}

function jyo_test_pdo(string $name, bool $content): PDO {
  $file = '/tmp/jyo-' . $name . ($content ? '-full' : '') . '.sqlite';
  $pdo = new JyoTestPdo('sqlite:' . $file, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  jyo_test_schema($pdo);
  if ($content) jyo_test_content_schema($pdo);
  return $pdo;
}
`;

export type Site = { dir: string; mount: string; staging: string; production: string };
export type SiteOptions = {
  /** Copy the private backend to <site>/backend-staging (default true). */
  backend?: boolean;
  /** Write api/config.local.php pointing at <mount>/backend-staging (default true). */
  sidecar?: boolean;
  /** Plant complete decoy backends inside the web roots (public_html/backend and staging/backend). */
  decoys?: boolean;
};

export const PROD_FILES: Record<string, string> = {
  'index.html': '<h1>PRODUCTION HOME</h1>',
  '.htaccess': '# production rules',
  'recipes/prod-recipe/index.html': '<h1>PRODUCTION RECIPE</h1>',
  'category/prod-category/index.html': '<h1>PRODUCTION CATEGORY</h1>',
  'search-index.json': '[{"title":"production"}]',
  'sitemap-0.xml': '<urlset/>',
  'images/recipes/prod.png': 'png-bytes',
  'api/index.php': '<?php // production gateway',
};

export function sidecarPhp(mount: string, environment = 'staging', backendPath = `${mount}/backend-staging`): string {
  return `<?php return ['backend_path' => ${JSON.stringify(backendPath)}, 'environment' => '${environment}'];\n`;
}

export function configLocalPhp(mount: string, extra = ''): string {
  return `<?php return [
  'site' => [
    'environment' => 'staging',
    'allowed_hosts' => ['${STAGING_HOST}'],
    'url' => '${HTTPS_URL}',
    'public_path' => '${mount}/public_html/staging',
    'upload_path' => '${mount}/public_html/staging/images/recipes',
  ],
  'auth' => ['session_secret' => 'test-only-secret', 'trusted_proxies' => ['10.0.0.0/8', '2001:db8::/32']${extra}],
];`;
}

export function makeSite(name: string, opts: SiteOptions = {}): Site {
  const { backend = true, sidecar = true, decoys = false } = opts;
  const dir = path.join(tmpBase, name);
  const mount = `/${name}`;
  const production = path.join(dir, 'public_html');
  const staging = path.join(production, 'staging');

  fs.mkdirSync(path.join(staging, 'api'), { recursive: true });
  fs.copyFileSync(path.join(rootDir, 'api/index.php'), path.join(staging, 'api/index.php'));
  for (const [rel, content] of Object.entries(PROD_FILES)) writeFile(path.join(production, rel), content);

  if (backend) {
    const target = path.join(dir, 'backend-staging');
    fs.cpSync(path.join(rootDir, 'backend'), target, { recursive: true, filter: (s) => path.basename(s) !== 'config.local.php' });
    writeFile(path.join(target, 'config/config.local.php'), configLocalPhp(mount));
  }
  if (sidecar) writeFile(path.join(staging, 'api/config.local.php'), sidecarPhp(mount));
  if (decoys) {
    for (const where of [path.join(production, 'backend'), path.join(staging, 'backend')]) {
      fs.cpSync(path.join(rootDir, 'backend'), where, { recursive: true, filter: (s) => path.basename(s) !== 'config.local.php' });
      writeFile(path.join(where, 'config/config.local.php'), configLocalPhp(mount));
    }
  }

  // Boot files live in the staging web root; each requires the real api/index.php.
  const bootHead = (content: boolean) => `<?php
$account = dirname(__DIR__, 2);
$backend = $account . '/backend-staging';
require_once '/testlib/schema.php';
require_once $backend . '/config/database.php';
$pdo = jyo_test_pdo(basename($account), ${content ? 'true' : 'false'});
$prop = new ReflectionProperty('Database', 'instance');
$prop->setAccessible(true);
$prop->setValue(null, $pdo);
`;
  // "sqlite": only admin/login tables, so publishing fails (used by the error-handling tests).
  writeFile(path.join(staging, '_boot_sqlite.php'), `${bootHead(false)}require __DIR__ . '/api/index.php';\n`);
  // "full": the complete content schema, so the generator can publish.
  writeFile(path.join(staging, '_boot_full.php'), `${bootHead(true)}require __DIR__ . '/api/index.php';\n`);
  // "env": backend location comes from server settings (env vars) instead of api/config.local.php.
  writeFile(
    path.join(staging, '_boot_env.php'),
    `${bootHead(false)}
// Never let one request's settings leak into the next one served by the same PHP process.
register_shutdown_function(function () { putenv('JYOCANCOOK_BACKEND_PATH'); putenv('JYOCANCOOK_ENVIRONMENT'); });
if (!empty($_SERVER['HTTP_X_TEST_BACKEND'])) putenv('JYOCANCOOK_BACKEND_PATH=' . $_SERVER['HTTP_X_TEST_BACKEND']);
if (!empty($_SERVER['HTTP_X_TEST_ENV'])) putenv('JYOCANCOOK_ENVIRONMENT=' . $_SERVER['HTTP_X_TEST_ENV']);
require __DIR__ . '/api/index.php';
`,
  );
  // "plain": the real (MySQL) Database class with no stand-in, so the DB connection fails.
  writeFile(path.join(staging, '_boot_plain.php'), `<?php require __DIR__ . '/api/index.php';\n`);

  mounts[mount] = dir;
  return { dir, mount, staging, production };
}

export type Client = {
  request: (opts: { url: string; method?: string; headers?: Record<string, string>; body?: Uint8Array }) => Promise<any>;
};

export type Boot = 'sqlite' | 'full' | 'env' | 'plain';

export function client(site: Site, opts: { https?: boolean; boot?: Boot; host?: string } = {}): Client {
  const host = opts.host ?? STAGING_HOST;
  const handler = new PHPRequestHandler({
    php,
    documentRoot: `${site.mount}/public_html/staging`,
    absoluteUrl: `${opts.https === false ? 'http' : 'https'}://${host}`,
    rewriteRules: [{ match: /^\/api(\/.*)?$/, replacement: `/_boot_${opts.boot ?? 'sqlite'}.php` }],
  });
  return handler as unknown as Client;
}

export const json = (r: any) => JSON.parse(r.text);

export async function call(c: Client, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  let payload: Uint8Array | undefined;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = new TextEncoder().encode(JSON.stringify(body));
  }
  return c.request({ url, method, headers: h, body: payload });
}

export async function login(c: Client, headers: Record<string, string> = {}, password = ADMIN_PASS) {
  return call(c, 'POST', '/api/auth/login', { username: ADMIN_USER, password }, headers);
}

/** A fresh client that is logged in; returns the client and its CSRF token. */
export async function authed(site: Site, boot: Boot = 'sqlite') {
  const c = client(site, { boot });
  const r = await login(c);
  assert.equal(r.httpStatusCode, 200, `login should succeed: ${r.text}`);
  const csrf: string = json(r).csrf_token;
  assert.match(csrf, /^[0-9a-f]{64}$/);
  return { c, csrf };
}

// SQLite lives in the WASM in-memory /tmp (file locking on the mounted host FS stalls).
export async function resetDb(site: Site) {
  const name = site.mount.slice(1);
  await php.run({ code: `<?php @unlink('/tmp/jyo-${name}.sqlite'); @unlink('/tmp/jyo-${name}-full.sqlite');` });
}

export async function phpRun(code: string): Promise<string> {
  const r = await php.run({ code: `<?php\n${code}` });
  return r.text;
}

export async function copyToWasm(hostDir: string, wasmDir: string) {
  await php.mkdir(wasmDir);
  for (const e of fs.readdirSync(hostDir, { withFileTypes: true })) {
    const h = path.join(hostDir, e.name);
    const w = `${wasmDir}/${e.name}`;
    if (e.isDirectory()) await copyToWasm(h, w);
    else {
      try { await php.writeFile(w, new Uint8Array(fs.readFileSync(h))); } catch (err) { throw new Error('writeFile failed: ' + w + ' ' + err); }
    }
  }
}

// ---------------------------------------------------------------- lifecycle

/** Call from before(), AFTER all makeSite() calls. */
export async function startPhp() {
  php = new PHP(await loadNodeRuntime('8.3', { emscriptenOptions: { processId: 1 } }));
  await php.mkdir('/testlib');
  await php.writeFile('/testlib/schema.php', SCHEMA_PHP);
  // Only public_html is mounted from the host (it holds both the production and the staging web
  // roots). The private backend is loaded into the WASM in-memory FS (the host mount cannot honour
  // flock(), which the lock/log code uses).
  for (const [mount, dir] of Object.entries(mounts)) {
    await php.mkdir(mount);
    await php.mount(`${mount}/public_html`, createNodeFsMountHandler(path.join(dir, 'public_html')));
    const hostBackend = path.join(dir, 'backend-staging');
    if (fs.existsSync(hostBackend)) await copyToWasm(hostBackend, `${mount}/backend-staging`);
  }
}

export function makeTmp() {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'jyo-php-'));
}

export async function stopPhp() {
  try {
    await php.exit();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmpBase, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300).unref?.();
}
