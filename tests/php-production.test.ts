/**
 * Production layout and isolation from staging, on the Hostinger account layout:
 *
 *   <account>/public_html/                 production web root  (api/ gateway, environment "production")
 *   <account>/public_html/staging/         staging web root     (must never be touched by production)
 *   <account>/backend-production/          private production backend (own database, own secret)
 *   <account>/backend-staging/             private staging backend (must never be touched by production)
 *
 * What runs: the real api/index.php, backend/ code and generator executed by PHP 8.3 compiled to
 * WebAssembly, with SQLite stand-ins for the two MySQL databases (separate files). Not Hostinger's PHP
 * and not MySQL.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PHPRequestHandler } from '@php-wasm/universal';
import {
  php, makeTmp, makeSite, startPhp, stopPhp, call, json, phpRun, login, client, copyToWasm, writeFile, rootDir,
  ADMIN_USER, ADMIN_PASS, STAGING_HOST, type Site,
} from './helpers/php-harness.ts';

const PROD_HOST = 'jyocancook.com';
const SECRET = crypto.randomBytes(32).toString('hex');
const DB_PASS = 'Db-Pass-That-Must-Never-Leak-9f3';

let site: Site;
let mount = '';
let backendProd = '';
const sidecarFile = () => path.join(site.production, 'api/config.local.php');
const backendConfigFile = () => `${mount}/backend-production/config/config.local.php`;

function prodConfig(over: { env?: string; secret?: string; hosts?: string[]; dbName?: string } = {}): string {
  const hosts = over.hosts ?? [PROD_HOST, `www.${PROD_HOST}`];
  return `<?php return [
  'db' => ['host' => 'localhost', 'port' => 3306, 'name' => '${over.dbName ?? 'u1_jyo_prod'}', 'user' => 'u1_prod_user', 'pass' => '${DB_PASS}', 'charset' => 'utf8mb4'],
  'site' => [
    'environment' => '${over.env ?? 'production'}',
    'url' => 'https://${PROD_HOST}',
    'allowed_hosts' => [${hosts.map((h) => `'${h}'`).join(', ')}],
    'public_path' => '${mount}/public_html',
    'upload_path' => '${mount}/public_html/images/recipes',
  ],
  'auth' => ['session_secret' => '${over.secret ?? SECRET}', 'session_lifetime' => 28800, 'trusted_proxies' => []],
];`;
}
const setBackendConfig = (body: string) => php.writeFile(backendConfigFile(), new TextEncoder().encode(body));
const bootLog = async (dir: string) => {
  try { return (await php.readFileAsText(`${dir}/tmp/logs/api-boot.log`)).trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; }
};

/** A client that talks to the production gateway (public_html/api) under the given host name. */
function prodClient(host = PROD_HOST) {
  return new PHPRequestHandler({
    php,
    documentRoot: `${mount}/public_html`,
    absoluteUrl: `https://${host}`,
    rewriteRules: [{ match: /^\/api(\/.*)?$/, replacement: '/_boot_prod.php' }],
  }) as unknown as Parameters<typeof call>[0];
}
const cookieOf = (r: any): string => {
  const raw = r.headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
};
const rawSetCookie = (r: any): string => [].concat(r.headers['set-cookie'] ?? []).join('\n');

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { out[`${prefix}${e.name}/`] = 'dir'; walk(path.join(d, e.name), `${prefix}${e.name}/`); }
      else out[prefix + e.name] = crypto.createHash('sha1').update(fs.readFileSync(path.join(d, e.name))).digest('hex');
    }
  };
  walk(dir, '');
  return out;
}

async function sql(db: string, statement: string, params: unknown[] = []): Promise<any[]> {
  const b64 = Buffer.from(JSON.stringify(params)).toString('base64');
  const out = await phpRun(`require_once '/testlib/schema.php'; $pdo = jyo_test_pdo('${db}', true);
    $st = $pdo->prepare(${JSON.stringify(statement)});
    $st->execute(json_decode(base64_decode('${b64}'), true));
    echo json_encode($st->columnCount() ? $st->fetchAll() : []);`);
  return JSON.parse(out);
}

describe('Production deployment layout and isolation from staging (WASM PHP 8.3 + SQLite stand-in)', () => {
  let c: ReturnType<typeof prodClient>;
  let csrf = '';
  let stagingTree: Record<string, string> = {};
  let stagingBackendBefore: string[] = [];

  before(async () => {
    makeTmp();
    site = makeSite('prd'); // account with the staging site, backend-staging and production sentinel files
    mount = site.mount;

    // Staging things that production must never disturb (password protection, config, uploads, logs).
    writeFile(path.join(site.staging, 'index.html'), '<h1>STAGING HOME</h1>');
    writeFile(path.join(site.staging, '.htaccess'), '# staging rules\nAuthType Basic\nAuthUserFile /x/.htpasswd\nRequire valid-user\n');
    writeFile(path.join(site.staging, '.htpasswd'), 'stager:$apr1$hash');
    writeFile(path.join(site.staging, 'recipes/staging-only/index.html'), 'STAGING RECIPE');
    writeFile(path.join(site.staging, 'images/recipes/staging-photo.jpg'), 'jpg');

    // Production: private backend, public gateway, sidecar and boot file.
    backendProd = path.join(site.dir, 'backend-production');
    fs.cpSync(path.join(rootDir, 'backend'), backendProd, { recursive: true, filter: (s) => path.basename(s) !== 'config.local.php' });
    writeFile(path.join(backendProd, 'config/config.local.php'), prodConfig());
    fs.mkdirSync(path.join(site.production, 'api'), { recursive: true });
    fs.copyFileSync(path.join(rootDir, 'api/index.php'), path.join(site.production, 'api/index.php'));
    writeFile(sidecarFile(), `<?php return ['backend_path' => '${mount}/backend-production', 'environment' => 'production'];\n`);
    writeFile(path.join(site.production, '_boot_prod.php'), `<?php
$account = dirname(__DIR__);
require_once '/testlib/schema.php';
require_once $account . '/backend-production/config/database.php';
$pdo = jyo_test_pdo('prd-prod', true);
$prop = new ReflectionProperty('Database', 'instance');
$prop->setAccessible(true);
$prop->setValue(null, $pdo);
require __DIR__ . '/api/index.php';
`);

    await startPhp();
    await copyToWasm(backendProd, `${mount}/backend-production`);
    stagingTree = snapshot(site.staging);
    stagingBackendBefore = (await php.listFiles(`${mount}/backend-staging`)).sort();

    // Production database content (a small seed through the real importer).
    const seed = '/prd/prodseed';
    await php.mkdir(seed); await php.mkdir(`${seed}/config`); await php.mkdir(`${seed}/recipes`);
    const put = (p: string, v: unknown) => php.writeFile(`${seed}/${p}`, new TextEncoder().encode(JSON.stringify(v)));
    await put('config/categories.json', [{ slug: 'curries', name: 'Curries', description: '', image: '/images/categories/curries.svg', order: 1 }]);
    await put('config/tags.json', ['Spicy']);
    await put('config/menu.json', [{ label: 'Home', href: '/', order: 1, visible: true }]);
    await put('recipes/garlic-naan.json', { title: 'Garlic Naan', category: 'curries', published: true, tags: ['Spicy'], ingredients: [{ name: 'flour', amount: 2, unit: 'cup' }], steps: [{ title: 'Mix', text: 'Mix it.' }] });
    const out = await phpRun(`require_once '/testlib/schema.php'; $pdo = jyo_test_pdo('prd-prod', true);
      require_once '/prd/backend-production/db/import-content.php';
      [$cfg, $rec] = importSeedPaths('${seed}');
      echo json_encode(importContent($pdo, $cfg, $rec)['errors']);`);
    assert.equal(out, '[]', out);
    c = prodClient();
  });

  after(stopPhp);

  it('the production gateway starts: anonymous status is "login required", not a configuration error', async () => {
    const r = await call(c, 'GET', '/api/admin/status');
    assert.equal(r.httpStatusCode, 401, r.text);
    assert.equal(json(r).auth_required, true);
  });

  it('serves the production host and www, and answers 404 for the staging host name', async () => {
    for (const host of [PROD_HOST, `www.${PROD_HOST}`]) {
      assert.equal((await call(prodClient(host), 'GET', '/api/admin/status')).httpStatusCode, 401, host);
    }
    const other = await call(prodClient(STAGING_HOST), 'GET', '/api/admin/status');
    assert.equal(other.httpStatusCode, 404, other.text);
  });

  it('admin login works and uses its own session cookie (HttpOnly, Secure), never the staging cookie name', async () => {
    const r = await call(c, 'POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    assert.equal(r.httpStatusCode, 200, r.text);
    csrf = json(r).csrf_token;
    assert.match(csrf, /^[0-9a-f]{64}$/);
    const cookie = rawSetCookie(r);
    assert.match(cookie, /jyo_prod_admin_session=/);
    assert.ok(!/jyo_php_admin_session/.test(cookie));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.ok(!cookie.includes(SECRET) && !cookie.includes(DB_PASS), 'no secret in the cookie');
  });

  it('keeps authentication and CSRF protection in force on production', async () => {
    assert.equal((await call(prodClient(), 'GET', '/api/admin/recipes')).httpStatusCode, 401, 'no session -> 401');
    const noCsrf = await call(c, 'POST', '/api/admin/publish');
    assert.equal(noCsrf.httpStatusCode, 403, noCsrf.text);
    const badCsrf = await call(c, 'POST', '/api/admin/publish', undefined, { 'X-CSRF-Token': 'f'.repeat(64) });
    assert.equal(badCsrf.httpStatusCode, 403, badCsrf.text);
    const http = await call(c, 'GET', '/api/admin/status', undefined, {});
    assert.equal(http.httpStatusCode, 200);
  });

  it('a staging session is not accepted by production, and a production session is not accepted by staging, even when the id is copied', async () => {
    const stagingLogin = await login(client(site, { boot: 'full' }));
    assert.equal(stagingLogin.httpStatusCode, 200, stagingLogin.text);
    const sid = rawSetCookie(stagingLogin).match(/jyo_php_admin_session=([^;]+)/)![1];
    const asProd = await call(prodClient(), 'GET', '/api/admin/status', undefined, { Cookie: `jyo_php_admin_session=${sid}; jyo_prod_admin_session=${sid}` });
    assert.equal(asProd.httpStatusCode, 401, 'staging session id must not log in to production');

    const prodLogin = await call(prodClient(), 'POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    const psid = rawSetCookie(prodLogin).match(/jyo_prod_admin_session=([^;]+)/)![1];
    const asStaging = await call(client(site, { boot: 'full' }), 'GET', '/api/admin/status', undefined, { Cookie: `jyo_php_admin_session=${psid}; jyo_prod_admin_session=${psid}` });
    assert.equal(asStaging.httpStatusCode, 401, 'production session id must not log in to staging');
    // The staging login above is a staging action (its own ImageService creates images/recipes/.htaccess),
    // so take a fresh baseline: the tests below prove production activity leaves staging as it is now.
    stagingTree = snapshot(site.staging);
  });

  it('publishes the production site into public_html and leaves public_html/staging byte-for-byte unchanged', async () => {
    const r = await call(c, 'POST', '/api/admin/publish', undefined, { 'X-CSRF-Token': csrf });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.equal(json(r).ok, true);
    const page = path.join(site.production, 'recipes/garlic-naan/index.html');
    assert.ok(fs.existsSync(page), 'recipe page generated in the production web root');
    assert.match(fs.readFileSync(page, 'utf8'), /Garlic Naan/);
    assert.ok(fs.existsSync(path.join(site.production, 'category/curries/index.html')));
    assert.ok(fs.existsSync(path.join(site.production, 'tag/spicy/index.html')));
    assert.ok(fs.readFileSync(path.join(site.production, 'sitemap-0.xml'), 'utf8').includes(`https://${PROD_HOST}/recipes/garlic-naan/`));
    assert.ok(!/staging/.test(fs.readFileSync(path.join(site.production, 'sitemap-0.xml'), 'utf8')), 'production sitemap does not mention staging');
    assert.deepEqual(snapshot(site.staging), stagingTree, 'public_html/staging unchanged (files, .htaccess, .htpasswd, uploads)');
    assert.ok(!fs.existsSync(path.join(site.production, 'recipes/staging-only')), 'staging recipe never leaks into production');
  });

  it('production uses its own database: staging tables are untouched', async () => {
    assert.equal((await sql('prd-prod', 'SELECT COUNT(*) AS n FROM recipes'))[0].n, 1);
    assert.equal((await sql('prd', 'SELECT COUNT(*) AS n FROM recipes'))[0].n, 0, 'staging database has no production recipe');
    assert.equal((await sql('prd', 'SELECT COUNT(*) AS n FROM publish_logs'))[0].n, 0, 'staging database has no production publish log');
    assert.deepEqual((await php.listFiles(`${mount}/backend-staging`)).sort(), stagingBackendBefore, 'backend-staging has no new files');
  });

  it('saves a recipe on production and publishes it to public_html only', async () => {
    const open = json(await call(c, 'GET', '/api/admin/recipes/garlic-naan')).recipe;
    open.title = 'Garlic Naan (edited)';
    const r = await call(c, 'POST', '/api/admin/recipes/garlic-naan', { recipe: open }, { 'X-CSRF-Token': csrf });
    assert.equal(r.httpStatusCode, 200, r.text);
    assert.equal(json(r).slug, 'garlic-naan');
    assert.match(fs.readFileSync(path.join(site.production, 'recipes/garlic-naan/index.html'), 'utf8'), /edited/);
    assert.deepEqual(snapshot(site.staging), stagingTree);
    assert.equal((await sql('prd', 'SELECT COUNT(*) AS n FROM recipes'))[0].n, 0);
  });

  it('refuses uploads outside public_html or inside the staging site', async () => {
    const out = JSON.parse(await phpRun(`require_once '${mount}/backend-production/services/PathGuard.php';
      $site = ['environment' => 'production', 'public_path' => '${mount}/public_html'];
      $b = '${mount}/backend-production';
      $t = function (callable $f) { try { $f(); return 'ok'; } catch (Throwable $e) { return $e->getMessage(); } };
      echo json_encode([
        'production' => $t(fn() => PathGuard::assertUploadDir($site, '${mount}/public_html/images/recipes', $b)),
        'staging'    => $t(fn() => PathGuard::assertUploadDir($site, '${mount}/public_html/staging/images/recipes', $b)),
        'backend'    => $t(fn() => PathGuard::assertUploadDir($site, '${mount}/backend-production/tmp', $b)),
        'sibling'    => $t(fn() => PathGuard::assertUploadDir($site, '${mount}/backend-staging/tmp', $b)),
        'staging_pub'=> $t(fn() => PathGuard::assertPublishTarget(['environment' => 'production', 'public_path' => '${mount}/public_html/staging'], $b)),
      ]);`));
    assert.equal(out.production, 'ok');
    assert.match(out.staging, /must not be inside the staging site/);
    assert.match(out.backend, /upload_path must be inside/);
    assert.match(out.sibling, /upload_path must be inside/);
    assert.match(out.staging_pub, /expected production layout/);
  });

  it('refuses to start with the staging backend, a weak or placeholder secret, or no allowed hosts (generic error, private log)', async () => {
    const original = fs.readFileSync(sidecarFile(), 'utf8');
    const logDir = `${mount}/backend-production`;
    try {
      // 1. production gateway pointed at the staging backend
      fs.writeFileSync(sidecarFile(), `<?php return ['backend_path' => '${mount}/backend-staging', 'environment' => 'production'];\n`);
      let r = await call(prodClient(), 'GET', '/api/admin/status');
      assert.equal(r.httpStatusCode, 500);
      assert.deepEqual(json(r), { ok: false, error: 'Server configuration error' });
      assert.equal((await bootLog(`${mount}/backend-staging`)).pop()?.code, 'BACKEND_ENVIRONMENT_MISMATCH');
      fs.writeFileSync(sidecarFile(), original);

      // 2-4. unsafe production configuration
      for (const [name, body, code] of [
        ['placeholder', prodConfig({ secret: 'REPLACE_WITH_64_HEX_CHARS_REPLACE_WITH_64_HEX' }), 'BACKEND_SESSION_SECRET_INVALID'],
        ['short', prodConfig({ secret: 'short-secret' }), 'BACKEND_SESSION_SECRET_INVALID'],
        ['no hosts', prodConfig({ hosts: [] }), 'BACKEND_ALLOWED_HOSTS_EMPTY'],
        ['staging env', prodConfig({ env: 'staging' }), 'BACKEND_ENVIRONMENT_MISMATCH'],
      ] as const) {
        await setBackendConfig(body);
        r = await call(prodClient(), 'GET', '/api/admin/status');
        assert.equal(r.httpStatusCode, 500, name);
        assert.deepEqual(json(r), { ok: false, error: 'Server configuration error' }, name);
        assert.equal((await bootLog(logDir)).pop()?.code, code, name);
      }
      const all = await php.readFileAsText(`${logDir}/tmp/logs/api-boot.log`);
      assert.ok(!all.includes(SECRET) && !all.includes(DB_PASS) && !all.includes('short-secret'), 'boot log holds no secret or password');
    } finally {
      fs.writeFileSync(sidecarFile(), original);
      await setBackendConfig(prodConfig());
    }
    assert.equal((await call(prodClient(), 'GET', '/api/admin/status')).httpStatusCode, 401, 'restored');
  });

  it('refuses to open a staging-named database in production, and still accepts a production database name', async () => {
    const connect = async (dbName: string) => {
      await setBackendConfig(prodConfig({ dbName }));
      return phpRun(`require_once '${mount}/backend-production/config/database.php';
        try { Database::getConnection(); echo 'connected'; } catch (Throwable $e) { echo $e->getMessage(); }`);
    };
    try {
      assert.match(await connect('u616903313_jyo_staging'), /Refusing to start: the production environment is configured with a staging database name/);
      assert.match(await connect('U616903313_JYO_STAGING'), /Refusing to start/);
      assert.ok(!/Refusing to start/.test(await connect('u616903313_jyo_prod')), 'a production name passes the guard (the connection itself is not available in the test runtime)');
    } finally {
      await setBackendConfig(prodConfig());
    }
  });

  it('keeps the production session secret, DB password and config file out of every public file and response', async () => {
    const secretHits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(html|xml|json|txt|js|css|php|htaccess)$/.test(e.name) || e.name.startsWith('.')) {
          const t = fs.readFileSync(p, 'utf8');
          if (t.includes(SECRET) || t.includes(DB_PASS)) secretHits.push(path.relative(site.dir, p));
        }
      }
    };
    walk(path.join(site.dir, 'public_html'));
    assert.deepEqual(secretHits, []);
    assert.ok(!fs.existsSync(path.join(site.production, 'config.local.php')));
    assert.ok(!fs.existsSync(path.join(site.production, 'backend-production')));
  });
});
