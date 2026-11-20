/**
 * Production package tests. They run the real packager (bin/package-hostinger.mjs --target production)
 * against a small fake Astro build, so they are quick and never touch the live site, deploy/ or dist/.
 * A final suite checks the real deploy/production/*.zip files when they have been built
 * (npm run package:production).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractZip, readZip } from '../bin/zip-util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packager = path.join(root, 'bin/package-hostinger.mjs');

let tmp: string;
let dist: string;
let out: string;
let account: string; // simulated HOSTINGER_ACCOUNT_ROOT that already holds a working staging site
let publicRoot: string;
let backendRoot: string;
let publicZip: string;
let backendZip: string;
let result: ReturnType<typeof spawnSync>;

const names = (zip: string) => readZip(zip).map((e: { name: string }) => e.name);
const files = (zip: string) => names(zip).filter((n: string) => !n.endsWith('/'));
const text = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (rel: string, content: string | Buffer) => {
  const p = path.join(dist, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
function snapshot(dir: string): Record<string, string> {
  const res: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else res[path.relative(dir, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return res;
}
const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout;

function runPackager(extra: string[] = [], outDir = out) {
  return spawnSync(process.execPath, [packager, '--target', 'production', '--skip-build', '--dist', dist, '--out', outDir, ...extra], {
    cwd: root,
    encoding: 'utf8',
  });
}

/** What a simulated Hostinger account holds before the production deployment: a protected staging site. */
function seedStagingAccount() {
  const put = (rel: string, body: string) => {
    const p = path.join(account, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  put('public_html/staging/index.html', '<h1>staging</h1>');
  put('public_html/staging/.htaccess', '# hPanel password protection\nAuthType Basic\nAuthUserFile /home/u1/domains/jyocancook.com/public_html/staging/.htpasswd\nRequire valid-user\n');
  put('public_html/staging/.htpasswd', 'staging:$apr1$FAKEHASH\n');
  put('public_html/staging/api/index.php', '<?php // staging gateway');
  put('public_html/staging/api/config.local.php', "<?php return ['backend_path' => '/x/backend-staging', 'environment' => 'staging'];");
  put('public_html/staging/images/recipes/staging-only.jpg', 'JPG-STAGING');
  put('public_html/index.html', '<h1>old placeholder</h1>');
  put('backend-staging/config/config.local.php', "<?php return ['db' => ['pass' => 'STAGING-DB-PASSWORD']];");
  put('backend-staging/tmp/logs/api-boot.log', '{"code":"OLD"}\n');
  put('backend-staging/auth/Auth.php', '<?php // staging code');
}

describe('production package (fake Astro build, real packager)', () => {
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jyo-prodpkg-'));
    dist = path.join(tmp, 'dist');
    out = path.join(tmp, 'deploy/production');
    account = path.join(tmp, 'ACCOUNT_ROOT');

    write('index.html', '<h1>home</h1>');
    write('admin/index.html', '<h1>admin</h1>');
    write('recipes/index.html', '<h1>recipes</h1>');
    write('recipes/chicken-curry/index.html', '<h1>curry</h1>');
    write('sitemap-index.xml', '<sitemapindex><sitemap><loc>https://jyocancook.com/sitemap-0.xml</loc></sitemap></sitemapindex>');
    write('_astro/app.abc123.css', 'body{}');
    write('_astro/app.abc123.js', 'console.log(1)');
    write('images/recipes/chicken-curry.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    write('images/logo.png', Buffer.from([0x89, 0x50]));
    write('api/admin/publish', '{"localDev":true}'); // Astro's development-only API stubs must not ship
    write('.htaccess', '# astro build htaccess');
    write('robots.txt', 'User-agent: *\nDisallow: /\n'); // the build's own robots.txt is replaced

    result = runPackager();
    publicZip = path.join(out, 'public_html.zip');
    backendZip = path.join(out, 'backend.zip');
    publicRoot = path.join(account, 'public_html');
    backendRoot = path.join(account, 'backend-production');
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('the packager succeeds and prints both production extraction destinations', () => {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(String(result.stdout), /extract into HOSTINGER_ACCOUNT_ROOT\/public_html\/\n/);
    assert.match(String(result.stdout), /extract into HOSTINGER_ACCOUNT_ROOT\/backend-production\/\n/);
    assert.ok(!/backend-staging/.test(String(result.stdout)));
  });

  it('produces exactly public_html.zip, backend.zip and a matching checksum file', () => {
    assert.deepEqual(fs.readdirSync(out).sort(), ['MANIFEST.sha256', 'backend.zip', 'public_html.zip']);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.sha256'), 'utf8').trim().split('\n');
    assert.equal(manifest.length, 2);
    for (const line of manifest) {
      const [hash, name] = line.split(/\s+/);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex'), hash, name);
    }
  });

  it('public_html.zip has no staging/ entry and no wrapper folder (it can never replace the staging site)', () => {
    const all = names(publicZip);
    assert.ok(all.includes('index.html') && all.includes('api/index.php'));
    for (const n of all) {
      assert.ok(n !== 'staging' && !n.startsWith('staging/'), `staging entry ${n}`);
      assert.ok(!/^(public_html|backend|backend-production|backend-staging|dist)\//.test(n), `wrapper folder in ${n}`);
      assert.ok(!n.startsWith('./') && !n.startsWith('/') && !n.includes('\\') && !n.includes('..'), `unsafe name ${n}`);
    }
  });

  it('backend.zip holds the private backend at its root, with no wrapper folder', () => {
    const all = names(backendZip);
    for (const required of ['auth/Auth.php', 'config/config.php', 'config/config.local.sample.php', 'config/api.config.local.sample.php', 'db/schema.sql', 'db/create-admin.php', 'db/migrate.php', 'db/import-content.php', 'services/PathGuard.php', 'tmp/.htaccess', '.htaccess']) {
      assert.ok(all.includes(required), `${required} missing`);
    }
    for (const n of all) assert.ok(!/^(backend|backend-production|backend-staging|public_html)\//.test(n), `wrapper folder in ${n}`);
  });

  it('deploying onto an account that holds a staging site leaves every staging file byte-for-byte unchanged', () => {
    seedStagingAccount();
    const stagingBefore = snapshot(path.join(account, 'public_html/staging'));
    const backendStagingBefore = snapshot(path.join(account, 'backend-staging'));
    assert.ok(Object.keys(stagingBefore).length >= 6);

    extractZip(publicZip, publicRoot);
    extractZip(backendZip, backendRoot);

    assert.deepEqual(snapshot(path.join(account, 'public_html/staging')), stagingBefore, 'public_html/staging unchanged (incl. .htaccess and .htpasswd)');
    assert.deepEqual(snapshot(path.join(account, 'backend-staging')), backendStagingBefore, 'backend-staging unchanged');
    assert.equal(text(account, 'public_html/staging/.htpasswd'), 'staging:$apr1$FAKEHASH\n');
    assert.match(text(account, 'public_html/staging/.htaccess'), /AuthType Basic[\s\S]*Require valid-user/);
  });

  it('extracting puts the site directly in public_html and the private code only in backend-production', () => {
    assert.ok(fs.existsSync(path.join(publicRoot, 'api/index.php')));
    assert.ok(fs.existsSync(path.join(publicRoot, '_astro/app.abc123.css')));
    assert.notEqual(text(account, 'public_html/index.html'), '<h1>old placeholder</h1>', 'production index replaced');
    assert.ok(!fs.existsSync(path.join(publicRoot, 'public_html')), 'no nested public_html');
    assert.ok(!fs.existsSync(path.join(publicRoot, 'backend-production')), 'backend never inside public_html');
    assert.ok(fs.existsSync(path.join(backendRoot, 'auth/Auth.php')));
    const phpInPublic = Object.keys(snapshot(publicRoot)).filter((f) => f.endsWith('.php') && !f.startsWith('staging/'));
    assert.deepEqual(phpInPublic, ['api/index.php'], 'the gateway is the only production PHP file in public_html');
    assert.deepEqual(fs.readdirSync(account).sort(), ['backend-production', 'backend-staging', 'public_html']);
  });

  it('production .htaccess, robots.txt and gateway carry no staging guard, noindex header or staging path', () => {
    for (const ht of ['.htaccess', 'api/.htaccess', 'images/recipes/.htaccess', '_astro/.htaccess']) {
      const body = text(publicRoot, ht);
      assert.ok(!/STAGING/.test(body), `${ht}: staging marker`);
      assert.ok(!/X-Robots-Tag/.test(body), `${ht}: noindex header`);
      assert.ok(!/RewriteCond %\{HTTP_HOST\}\s+!\^/.test(body), `${ht}: host guard`);
    }
    assert.match(text(publicRoot, '.htaccess'), /RewriteCond %\{HTTPS\} off/, 'HTTPS is still forced');
    const robots = text(publicRoot, 'robots.txt');
    assert.ok(!/Disallow:\s*\/\s*$/m.test(robots), 'search engines are not locked out');
    assert.match(robots, /Sitemap: https:\/\/jyocancook\.com\/sitemap-index\.xml/);
    assert.ok(!/staging/.test(robots));
    const gatewayCode = text(publicRoot, 'api/index.php').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/staging\.jyocancook\.com|backend-staging/.test(gatewayCode), 'the gateway code names no staging host or folder (only its comments do)');
  });

  it('keeps the upload folder script-proof and the backend closed to the web', () => {
    assert.match(text(publicRoot, 'images/recipes/.htaccess'), /php\|phtml/);
    assert.match(text(publicRoot, 'images/recipes/.htaccess'), /Options -ExecCGI -Indexes/);
    assert.equal(text(backendRoot, '.htaccess'), 'Require all denied\n');
    assert.equal(text(backendRoot, 'tmp/.htaccess'), 'Require all denied\n');
    assert.match(text(publicRoot, 'api/.htaccess'), /config\\\.local\\\.php/, 'gateway sidecar config cannot be downloaded');
  });

  it('ships production-only config samples with placeholders and safe defaults', () => {
    const sample = text(backendRoot, 'config/config.local.sample.php');
    for (const placeholder of ['REPLACE_DB_NAME', 'REPLACE_DB_USER', 'REPLACE_DB_PASSWORD', 'REPLACE_WITH_64_HEX_CHARS']) assert.ok(sample.includes(placeholder), placeholder);
    assert.match(sample, /'environment' => 'production'/);
    assert.match(sample, /'allowed_hosts' => \['jyocancook\.com', 'www\.jyocancook\.com'\]/);
    assert.match(sample, /'url' => 'https:\/\/jyocancook\.com'/);
    assert.match(sample, /'public_path' => \$accountRoot \. '\/public_html',/);
    assert.match(sample, /'upload_path' => \$accountRoot \. '\/public_html\/images\/recipes',/);
    assert.match(sample, /\$accountRoot = dirname\(__DIR__, 2\)/);
    assert.match(sample, /'trusted_proxies' => \[\]/);
    assert.ok(!/staging/i.test(sample.replace(/\/\/.*$/gm, '')), 'no staging value outside comments');
    assert.ok(!/\/home\/u\d+/.test(sample), 'no Hostinger account id');

    const sidecar = text(backendRoot, 'config/api.config.local.sample.php');
    assert.match(sidecar, /'backend_path' => '\/ABSOLUTE\/PATH\/TO\/HOSTINGER_ACCOUNT_ROOT\/backend-production'/);
    assert.match(sidecar, /'environment' => 'production'/);
    assert.ok(!/backend-staging/.test(sidecar));
  });

  it('contains no credentials, tokens, local config, logs or test databases', () => {
    const forbiddenName = [/config\.local\.php$/, /(^|\/)\.env/, /wrangler/i, /(^|\/)\.git(\/|$)/, /node_modules/, /\.pem$/, /\.key$/, /\.sqlite3?$/, /\.db$/, /\.log$/, /\.htpasswd$/];
    const forbiddenText = [/JyoCanCook@2026/, /jyo-secret-salt/, /ADMIN_DEFAULT_PASSWORD/, /\bghp_[A-Za-z0-9]{20,}/, /github_pat_/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /localDev/, /local-dev-sha/, /STAGING-DB-PASSWORD/];
    for (const zip of [publicZip, backendZip]) {
      for (const e of readZip(zip) as Array<{ name: string; dir: boolean; data: Buffer }>) {
        for (const re of forbiddenName) assert.ok(!re.test(e.name), `${path.basename(zip)}: forbidden file ${e.name}`);
        if (e.dir || !/\.(php|html|js|css|json|xml|txt|sql|md)$|\.htaccess$/.test(e.name)) continue;
        const body = e.data.toString('utf8');
        for (const re of forbiddenText) assert.ok(!re.test(body), `${path.basename(zip)}: ${re} found in ${e.name}`);
        if (e.name.endsWith('.php')) {
          for (const m of body.matchAll(/['"](pass|password|session_secret|secret)['"]\s*=>\s*['"]([^'"]+)['"]/g)) {
            assert.match(m[2], /^REPLACE_/, `hardcoded ${m[1]} in ${e.name}`);
          }
        }
      }
    }
    assert.ok(!fs.existsSync(path.join(backendRoot, 'config/config.local.php')));
    assert.ok(!fs.existsSync(path.join(publicRoot, 'api/config.local.php')));
    assert.ok(!fs.existsSync(path.join(backendRoot, 'tmp/logs')), 'no logs shipped');
  });

  it('seeds the backend with exactly the content committed on the current branch (HEAD): 8 recipes, 8 categories, 14 tags, 11 menu items, 41 ingredients, 24 steps', () => {
    const branchRecipes = git('ls-tree', '--name-only', 'HEAD', 'src/content/recipes/')
      .split('\n')
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.basename(f))
      .sort();
    assert.deepEqual(fs.readdirSync(path.join(backendRoot, 'seed/recipes')).sort(), branchRecipes);
    let ingredients = 0;
    let steps = 0;
    // The importer creates a tag for every name in config/tags.json and for every tag a recipe uses.
    const tagNames = new Set<string>(JSON.parse(git('show', 'HEAD:config/tags.json')).map((t: string) => t.toLowerCase()));
    for (const f of branchRecipes) {
      const fromBranch = git('show', `HEAD:src/content/recipes/${f}`);
      assert.equal(text(backendRoot, `seed/recipes/${f}`), fromBranch, `${f} differs from HEAD`);
      const r = JSON.parse(fromBranch);
      for (const t of r.tags ?? []) tagNames.add(String(t).toLowerCase());
      ingredients += r.ingredients.length;
      steps += r.steps.length;
    }
    for (const f of ['categories', 'tags', 'menu']) {
      assert.equal(text(backendRoot, `seed/config/${f}.json`), git('show', `HEAD:config/${f}.json`), `${f}.json differs from HEAD`);
    }
    const count = (f: string) => JSON.parse(text(backendRoot, `seed/config/${f}.json`)).length;
    assert.deepEqual(
      { recipes: branchRecipes.length, categories: count('categories'), tags: tagNames.size, menu: count('menu'), ingredients, steps },
      { recipes: 8, categories: 8, tags: 14, menu: 11, ingredients: 41, steps: 24 },
    );
  });

  it('packaging never reads the main branch: the packager has no hard-coded main ref and seeds from HEAD by default', () => {
    const src = fs.readFileSync(packager, 'utf8');
    assert.ok(!/['"`]main['"`]/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'no hard-coded main ref in bin/package-hostinger.mjs');
    assert.match(src, /opt\('seed-ref', 'HEAD'\)/);
  });

  describe('--mode update: code-only package for every deployment after the first', () => {
    let upOut: string;
    let upPublic: string;
    let upBackend: string;
    let liveBefore: Record<string, string>;
    let liveAccount: string;
    let liveStatus: number | null;
    let liveStderr: string;

    before(() => {
      upOut = path.join(tmp, 'deploy/production-update');
      liveAccount = path.join(tmp, 'LIVE_ACCOUNT');
      // A live production site where the admin has published pages from MySQL and uploaded photos.
      const put = (rel: string, body: string) => {
        const p = path.join(liveAccount, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, body);
      };
      put('public_html/index.html', '<h1>published from MySQL</h1>');
      put('public_html/recipes/index.html', 'listing from MySQL');
      put('public_html/recipes/admin-added-recipe/index.html', 'recipe created in the admin');
      put('public_html/category/curries/index.html', 'category from MySQL');
      put('public_html/tag/spicy/index.html', 'tag from MySQL');
      put('public_html/search-index.json', '[{"title":"admin-added"}]');
      put('public_html/sitemap-0.xml', '<urlset>live</urlset>');
      put('public_html/sitemap-index.xml', '<sitemapindex>live</sitemapindex>');
      put('public_html/images/recipes/uploaded-by-admin.jpg', 'JPG-UPLOAD');
      put('public_html/images/recipes/chicken-curry.jpg', 'JPG-REPLACED-IN-ADMIN');
      put('public_html/images/recipes/.htaccess', '# live upload guard');
      put('public_html/api/config.local.php', "<?php return ['backend_path' => '/x/backend-production', 'environment' => 'production'];");
      put('public_html/staging/index.html', '<h1>staging</h1>');
      put('public_html/staging/.htpasswd', 'staging:$apr1$FAKEHASH\n');
      put('backend-production/config/config.local.php', "<?php return ['db' => ['pass' => 'LIVE-DB-PASSWORD']];");
      put('backend-production/tmp/logs/api-boot.log', '{"code":"OLD"}\n');
      put('backend-staging/config/config.local.php', "<?php return ['db' => ['pass' => 'STAGING-DB-PASSWORD']];");
      liveBefore = {
        ...Object.fromEntries(Object.entries(snapshot(path.join(liveAccount, 'public_html'))).filter(([k]) => !k.startsWith('api/') && !k.startsWith('_astro/')).map(([k, v]) => [`public_html/${k}`, v])),
        ...Object.fromEntries(Object.entries(snapshot(path.join(liveAccount, 'backend-production'))).map(([k, v]) => [`backend-production/${k}`, v])),
        ...Object.fromEntries(Object.entries(snapshot(path.join(liveAccount, 'backend-staging'))).map(([k, v]) => [`backend-staging/${k}`, v])),
      };
      const r = runPackager(['--mode', 'update'], upOut);
      liveStatus = r.status;
      liveStderr = String(r.stderr);
      upPublic = path.join(upOut, 'public_html.zip');
      upBackend = path.join(upOut, 'backend.zip');
    });

    it('builds, and defaults its output to deploy/production-update (never deploy/production)', () => {
      assert.equal(liveStatus, 0, liveStderr);
      assert.deepEqual(fs.readdirSync(upOut).sort(), ['MANIFEST.sha256', 'backend.zip', 'public_html.zip']);
      const src = fs.readFileSync(packager, 'utf8');
      assert.match(src, /`\$\{target\}-update`/);
    });

    it('public_html.zip holds code only: no pages, listings, search index, sitemap, images or staging', () => {
      const all = names(upPublic);
      for (const required of ['api/index.php', 'api/.htaccess', 'admin/index.html', '.htaccess', 'robots.txt', 'styles/global.css', '_astro/app.abc123.css', '_astro/app.abc123.js']) {
        assert.ok(all.includes(required), `${required} missing`);
      }
      for (const n of all) {
        assert.ok(!/^(index\.html|404\.html|search-index\.json|sitemap.*\.xml)$/.test(n), `content file ${n}`);
        assert.ok(!/^(recipes|category|tag|search|about|images|pagefind|staging)(\/|$)/.test(n), `content or staging folder ${n}`);
      }
    });

    it('backend.zip has the code but no database seed and no credentials', () => {
      const all = names(upBackend);
      for (const required of ['auth/Auth.php', 'config/config.php', 'db/schema.sql', 'generator/SiteGenerator.php']) assert.ok(all.includes(required), required);
      assert.ok(!all.some((n: string) => n.startsWith('seed')), 'no seed');
      assert.ok(!all.some((n: string) => /config\.local\.php$/.test(n)), 'no config.local.php');
    });

    it('extracting it over a live site changes no recipe page, upload, config.local.php, log or staging file', () => {
      extractZip(upPublic, path.join(liveAccount, 'public_html'));
      extractZip(upBackend, path.join(liveAccount, 'backend-production'));
      const after = {
        ...Object.fromEntries(Object.entries(snapshot(path.join(liveAccount, 'public_html'))).filter(([k]) => !k.startsWith('api/') && !k.startsWith('_astro/')).map(([k, v]) => [`public_html/${k}`, v])),
        ...Object.fromEntries(Object.entries(snapshot(path.join(liveAccount, 'backend-production'))).map(([k, v]) => [`backend-production/${k}`, v])),
        ...Object.fromEntries(Object.entries(snapshot(path.join(liveAccount, 'backend-staging'))).map(([k, v]) => [`backend-staging/${k}`, v])),
      };
      for (const [k, v] of Object.entries(liveBefore)) {
        if (k === 'backend-production/tmp/.htaccess') continue;
        assert.equal(after[k], v, `${k} was changed by the update`);
      }
      assert.equal(text(liveAccount, 'public_html/images/recipes/chicken-curry.jpg'), 'JPG-REPLACED-IN-ADMIN');
      assert.equal(text(liveAccount, 'public_html/index.html'), '<h1>published from MySQL</h1>');
      assert.equal(text(liveAccount, 'backend-production/config/config.local.php'), "<?php return ['db' => ['pass' => 'LIVE-DB-PASSWORD']];");
      assert.ok(fs.existsSync(path.join(liveAccount, 'public_html/api/config.local.php')), 'gateway config survives');
      assert.ok(!fs.existsSync(path.join(liveAccount, 'backend-production/seed')), 'seed is not re-created');
      // and it did update the code
      assert.ok(fs.existsSync(path.join(liveAccount, 'backend-production/auth/Auth.php')));
      assert.ok(fs.existsSync(path.join(liveAccount, 'public_html/api/index.php')));
    });

    it('refuses an unknown --mode', () => {
      const r = runPackager(['--mode', 'bogus'], path.join(tmp, 'badmode'));
      assert.notEqual(r.status, 0);
      assert.match(String(r.stderr), /Unknown --mode/);
    });
  });

  it('is reproducible: packaging twice gives byte-identical archives', () => {
    const second = path.join(tmp, 'deploy2');
    const r = runPackager([], second);
    assert.equal(r.status, 0, r.stderr);
    for (const z of ['public_html.zip', 'backend.zip']) {
      assert.ok(fs.readFileSync(path.join(out, z)).equals(fs.readFileSync(path.join(second, z))), `${z} differs`);
    }
  });

  it('fails, and writes nothing, when the build still points at staging (wrong SITE_URL)', () => {
    write('leak.html', '<link rel="canonical" href="https://staging.jyocancook.com/">');
    const o = path.join(tmp, 'stagingbuild');
    const r = runPackager([], o);
    fs.rmSync(path.join(dist, 'leak.html'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /staging host or path found in leak\.html/);
    assert.ok(!fs.existsSync(o), 'a failed package leaves no archives behind');
  });

  it('fails when the build carries a staging noindex header or a secret', () => {
    write('sub/.htaccess', 'Header set X-Robots-Tag "noindex"');
    let r = runPackager([], path.join(tmp, 'noindex'));
    fs.rmSync(path.join(dist, 'sub'), { recursive: true });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /noindex header found/);

    write('leak.js', 'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";');
    r = runPackager([], path.join(tmp, 'secret'));
    fs.rmSync(path.join(dist, 'leak.js'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /GitHub token/);
  });

  it('fails when the seed ref does not exist, writing nothing', () => {
    const o = path.join(tmp, 'badref');
    const r = runPackager(['--seed-ref', 'no-such-ref-xyz'], o);
    assert.notEqual(r.status, 0);
    assert.match(String(r.stderr), /seed ref/i);
    assert.ok(!fs.existsSync(o));
  });
});

describe('deploy/production archives built by "npm run package:production"', () => {
  const dir = path.join(root, 'deploy/production');
  const pz = path.join(dir, 'public_html.zip');
  const bz = path.join(dir, 'backend.zip');
  const built = fs.existsSync(pz) && fs.existsSync(bz);
  const skip = !built && 'run npm run package:production first';

  it('exist, contain nothing but the two archives and a matching checksum file', { skip }, () => {
    assert.deepEqual(fs.readdirSync(dir).sort(), ['MANIFEST.sha256', 'backend.zip', 'public_html.zip']);
    for (const line of fs.readFileSync(path.join(dir, 'MANIFEST.sha256'), 'utf8').trim().split('\n')) {
      const [hash, name] = line.split(/\s+/);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'), hash, name);
    }
  });

  it('place index.html, the production gateway and the production site URL where Hostinger needs them', { skip }, () => {
    const pub = files(pz);
    assert.ok(pub.includes('index.html') && pub.includes('api/index.php'));
    assert.ok(pub.some((n: string) => n.startsWith('_astro/') && n.endsWith('.css')));
    assert.ok(pub.some((n: string) => n.startsWith('_astro/') && n.endsWith('.js')));
    assert.ok(pub.some((n: string) => /^images\/.*\.(jpe?g|png|webp)$/i.test(n)), 'images');
    assert.deepEqual(pub.filter((n: string) => n.endsWith('.php')), ['api/index.php']);
    assert.ok(!pub.some((n: string) => n === 'staging' || n.startsWith('staging/') || n.startsWith('public_html/')), 'no staging or wrapper entries');
    const entries = readZip(pz) as Array<{ name: string; data: Buffer }>;
    const home = entries.find((e) => e.name === 'index.html')!.data.toString('utf8');
    assert.ok(!/staging\.jyocancook\.com/.test(home), 'home page was built for production');
    assert.match(entries.find((e) => e.name === 'robots.txt')!.data.toString('utf8'), /https:\/\/jyocancook\.com\/sitemap-index\.xml/);
    const back = files(bz);
    assert.ok(back.includes('auth/Auth.php') && back.includes('config/config.local.sample.php') && back.includes('seed/config/categories.json'));
    assert.ok(!back.some((n: string) => /config\.local\.php$/.test(n)));
    assert.ok(!back.some((n: string) => /^(backend|backend-production|backend-staging)\//.test(n)));
  });
});
