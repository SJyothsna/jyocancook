/**
 * Staging package tests. These run the real packager (bin/package-hostinger.mjs) against a small fake
 * Astro build, so they are quick and never touch the live site, deploy/ or dist/. A final suite checks
 * the real deploy/staging/*.zip files when they have been built (npm run package:staging).
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
let account: string; // simulated HOSTINGER_ACCOUNT_ROOT
let stagingRoot: string;
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
function listAll(dir: string): string[] {
  const res: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${prefix}${e.name}/`);
      else res.push(prefix + e.name);
    }
  };
  walk(dir, '');
  return res.sort();
}

function runPackager(extra: string[] = []) {
  return spawnSync(process.execPath, [packager, '--target', 'staging', '--skip-build', '--dist', dist, '--out', out, ...extra], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('staging package (fake Astro build, real packager)', () => {
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jyo-pkg-'));
    dist = path.join(tmp, 'dist');
    out = path.join(tmp, 'deploy/staging');
    account = path.join(tmp, 'ACCOUNT_ROOT');

    write('index.html', '<h1>home</h1>');
    write('admin/index.html', '<h1>admin</h1>');
    write('recipes/index.html', '<h1>recipes</h1>');
    write('recipes/chicken-curry/index.html', '<h1>curry</h1>');
    write('_astro/app.abc123.css', 'body{}');
    write('_astro/app.abc123.js', 'console.log(1)');
    write('images/recipes/chicken-curry.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    write('images/logo.png', Buffer.from([0x89, 0x50]));
    // Things that must NOT reach the server:
    write('api/admin/publish', '{"localDev":true}'); // Astro's development-only API stubs
    write('.htaccess', '# astro build htaccess');
    write('robots.txt', 'Allow: /');

    result = runPackager();
    publicZip = path.join(out, 'public_html.zip');
    backendZip = path.join(out, 'backend.zip');
    stagingRoot = path.join(account, 'public_html/staging');
    backendRoot = path.join(account, 'backend-staging');
    if (result.status === 0) {
      // Simulate "extract here" into the exact destinations, next to a live production site.
      fs.mkdirSync(path.join(account, 'public_html'), { recursive: true });
      fs.writeFileSync(path.join(account, 'public_html/index.html'), 'PRODUCTION');
      extractZip(publicZip, stagingRoot);
      extractZip(backendZip, backendRoot);
    }
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('the packager succeeds and prints both extraction destinations', () => {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(String(result.stdout), /public_html\/staging\//);
    assert.match(String(result.stdout), /backend-staging\//);
  });

  it('produces exactly public_html.zip, backend.zip and a checksum file (no work folder left behind)', () => {
    assert.deepEqual(fs.readdirSync(out).sort(), ['MANIFEST.sha256', 'backend.zip', 'public_html.zip']);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.sha256'), 'utf8').trim().split('\n');
    assert.equal(manifest.length, 2);
    for (const line of manifest) {
      const [hash, name] = line.split(/\s+/);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex'), hash, name);
    }
  });

  it('public_html.zip holds the site at its root: no extra folder level, no "./" entries', () => {
    const all = names(publicZip);
    assert.ok(all.includes('index.html'), 'index.html at the archive root');
    assert.ok(all.includes('api/index.php'), 'api/index.php under api/');
    assert.ok(all.includes('admin/index.html'));
    for (const n of all) {
      assert.ok(!n.startsWith('./') && !n.startsWith('/') && !n.includes('\\'), `unsafe name ${n}`);
      assert.ok(!/^(public_html|staging|backend|backend-staging|dist)\//.test(n), `wrapper folder in ${n}`);
    }
  });

  it('backend.zip holds the private backend at its root with no wrapper folder', () => {
    const all = names(backendZip);
    for (const required of ['auth/Auth.php', 'config/config.php', 'config/config.local.sample.php', 'db/schema.sql', 'db/create-admin.php', 'db/migrate.php', 'db/import-content.php', 'generator/SiteGenerator.php', 'services/PathGuard.php', 'tmp/.htaccess']) {
      assert.ok(all.includes(required), `${required} missing`);
    }
    for (const n of all) assert.ok(!/^(backend|backend-staging|public_html)\//.test(n), `wrapper folder in ${n}`);
    for (const dir of ['auth/', 'config/', 'db/', 'generator/', 'services/']) assert.ok(all.includes(dir) || all.some((n: string) => n.startsWith(dir)), dir);
  });

  it('seeds the backend with the recipes, categories, tags and menu committed on the current branch (HEAD, not the working tree, not main)', () => {
    const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout;
    const branchRecipes = git('ls-tree', '--name-only', 'HEAD', 'src/content/recipes/')
      .split('\n')
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.basename(f))
      .sort();
    assert.ok(branchRecipes.length > 0, 'the branch has recipes');
    assert.deepEqual(fs.readdirSync(path.join(backendRoot, 'seed/recipes')).sort(), branchRecipes);
    for (const f of branchRecipes) {
      assert.equal(text(backendRoot, `seed/recipes/${f}`), git('show', `HEAD:src/content/recipes/${f}`), `${f} differs from HEAD`);
    }
    for (const f of ['categories', 'tags', 'menu']) {
      assert.equal(text(backendRoot, `seed/config/${f}.json`), git('show', `HEAD:config/${f}.json`), `${f}.json differs from HEAD`);
    }
  });

  it('fails when the seed ref does not exist, writing nothing', () => {
    const o = path.join(tmp, 'badref');
    const r = spawnSync(process.execPath, [packager, '--target', 'staging', '--skip-build', '--dist', dist, '--out', o, '--seed-ref', 'no-such-ref-xyz'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(String(r.stderr), /seed ref/i);
    assert.ok(!fs.existsSync(path.join(o, 'backend.zip')));
  });

  it('extracting lands index.html directly in /public_html/staging and api/index.php in /public_html/staging/api', () => {
    assert.ok(fs.existsSync(path.join(stagingRoot, 'index.html')));
    assert.ok(fs.existsSync(path.join(stagingRoot, 'api/index.php')));
    assert.ok(fs.existsSync(path.join(stagingRoot, '_astro/app.abc123.css')));
    assert.ok(!fs.existsSync(path.join(stagingRoot, 'public_html')), 'no nested public_html');
    assert.ok(!fs.existsSync(path.join(stagingRoot, 'staging')), 'no nested staging');
  });

  it('extracting leaves private PHP only in /backend-staging and never inside public_html', () => {
    const inBackend = listAll(backendRoot).filter((f) => f.endsWith('.php'));
    assert.ok(inBackend.length > 10);
    assert.ok(inBackend.includes('auth/Auth.php'));
    const inPublic = listAll(path.join(account, 'public_html')).filter((f) => f.endsWith('.php'));
    assert.deepEqual(inPublic, ['staging/api/index.php'], 'the gateway is the only PHP file in public_html');
    assert.ok(!fs.existsSync(path.join(account, 'public_html/backend')));
    assert.ok(!fs.existsSync(path.join(stagingRoot, 'backend')));
  });

  it('never touches production files in /public_html when extracted', () => {
    assert.equal(fs.readFileSync(path.join(account, 'public_html/index.html'), 'utf8'), 'PRODUCTION');
    const topLevel = fs.readdirSync(path.join(account, 'public_html')).sort();
    assert.deepEqual(topLevel, ['index.html', 'staging']);
  });

  it('includes the existing images, CSS and JavaScript', () => {
    const f = files(publicZip);
    assert.ok(f.includes('images/recipes/chicken-curry.jpg'));
    assert.ok(f.includes('images/logo.png'));
    assert.ok(f.includes('_astro/app.abc123.css'));
    assert.ok(f.includes('_astro/app.abc123.js'));
    assert.ok(f.includes('styles/global.css'), 'stylesheet used by PHP-generated pages');
    assert.ok(f.includes('recipes/chicken-curry/index.html'));
  });

  it('drops Astro development API stubs and the build\'s own .htaccess / robots.txt', () => {
    const f = files(publicZip);
    assert.deepEqual(f.filter((n: string) => n.startsWith('api/')).sort(), ['api/.htaccess', 'api/index.php']);
    assert.ok(!text(stagingRoot, '.htaccess').includes('astro build htaccess'));
    assert.equal(text(stagingRoot, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  });

  it('contains no credentials, tokens, local config or other secrets', () => {
    const forbiddenName = [/config\.local\.php$/, /(^|\/)\.env/, /wrangler/i, /(^|\/)\.git(\/|$)/, /node_modules/, /\.pem$/, /\.key$/, /\.sqlite$/, /\.log$/];
    const forbiddenText = [/JyoCanCook@2026/, /jyo-secret-salt/, /ADMIN_DEFAULT_PASSWORD/, /\bghp_[A-Za-z0-9]{20,}/, /github_pat_/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /localDev/, /local-dev-sha/];
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
    assert.ok(!fs.existsSync(path.join(stagingRoot, 'api/config.local.php')));
    assert.ok(!fs.existsSync(path.join(backendRoot, 'tmp/logs')), 'no logs shipped');
  });

  it('ships staging-only config samples with placeholders and safe defaults', () => {
    const sample = text(backendRoot, 'config/config.local.sample.php');
    for (const placeholder of ['REPLACE_DB_NAME', 'REPLACE_DB_USER', 'REPLACE_DB_PASSWORD', 'REPLACE_WITH_64_HEX_CHARS']) assert.ok(sample.includes(placeholder), placeholder);
    assert.match(sample, /'environment' => 'staging'/);
    assert.match(sample, /'allowed_hosts' => \['staging\.jyocancook\.com'\]/);
    assert.match(sample, /'url' => 'https:\/\/staging\.jyocancook\.com'/);
    assert.match(sample, /'public_path' => \$accountRoot \. '\/public_html\/staging'/);
    assert.match(sample, /'upload_path' => \$accountRoot \. '\/public_html\/staging\/images\/recipes'/);
    assert.match(sample, /\$accountRoot = dirname\(__DIR__, 2\)/, 'account root is derived, not hardcoded');
    assert.match(sample, /'trusted_proxies' => \[\]/, 'no proxy is trusted by default');
    assert.match(sample, /'session_lifetime' => 28800/);
    assert.ok(!/\/home\/u\d+/.test(sample), 'no Hostinger account id');
    assert.ok(!/0\.0\.0\.0\/0|::\/0/.test(sample.replace(/\/\/.*$/gm, '')), 'no catch-all proxy range outside comments');

    const sidecar = text(backendRoot, 'config/api.config.local.sample.php');
    assert.match(sidecar, /'backend_path' => '\/ABSOLUTE\/PATH\/TO\/HOSTINGER_ACCOUNT_ROOT\/backend-staging'/);
    assert.match(sidecar, /'environment' => 'staging'/);
    assert.ok(!/public_html\/backend/.test(sidecar.replace(/\/\/.*$/gm, '')));
  });

  it('puts the staging host guard in every .htaccess that uses rewriting, before any other rule', () => {
    const guard = 'RewriteCond %{HTTP_HOST} !^staging\\.jyocancook\\.com(:[0-9]+)?$ [NC]';
    for (const ht of ['.htaccess', 'api/.htaccess', 'images/recipes/.htaccess', '_astro/.htaccess']) {
      const body = text(stagingRoot, ht);
      assert.ok(body.includes(guard), `${ht}: host guard missing`);
      assert.ok(body.trimStart().startsWith('# STAGING ISOLATION'), `${ht}: guard must come first`);
      assert.match(body, /RewriteRule \^ - \[F,L\]/);
    }
    assert.match(text(stagingRoot, '.htaccess'), /X-Robots-Tag "noindex, nofollow, noarchive"/);
    assert.match(text(stagingRoot, '.htaccess'), /RewriteCond %\{HTTPS\} off/, 'HTTPS is still forced');
  });

  it('keeps the upload folder script-proof and the backend closed to the web', () => {
    const uploads = text(stagingRoot, 'images/recipes/.htaccess');
    assert.match(uploads, /php\|phtml/);
    assert.match(uploads, /Options -ExecCGI -Indexes/);
    assert.equal(text(backendRoot, '.htaccess'), 'Require all denied\n');
    assert.equal(text(backendRoot, 'tmp/.htaccess'), 'Require all denied\n');
    assert.match(text(stagingRoot, 'api/.htaccess'), /config\\\.local\\\.php/, 'the gateway sidecar config cannot be downloaded');
  });

  it('packages the hardened gateway and backend code', () => {
    const api = text(stagingRoot, 'api/index.php');
    assert.match(api, /JYOCANCOOK_BACKEND_PATH/);
    assert.ok(!/dirname\(__DIR__(,\s*\d)?\)\s*\.\s*'\/backend'/.test(api), 'no guessed backend folder');
    assert.ok(!/svg\+xml/.test(text(backendRoot, 'services/ImageService.php')), 'no SVG uploads');
    assert.ok(fs.existsSync(path.join(backendRoot, 'services/PathGuard.php')));
  });

  it('is reproducible: packaging twice gives byte-identical archives', () => {
    const second = path.join(tmp, 'deploy2');
    const r = spawnSync(process.execPath, [packager, '--target', 'staging', '--skip-build', '--dist', dist, '--out', second], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const z of ['public_html.zip', 'backend.zip']) {
      assert.ok(fs.readFileSync(path.join(out, z)).equals(fs.readFileSync(path.join(second, z))), `${z} differs`);
    }
  });

  it('refuses insecure or malformed options and keeps the old package on failure paths', () => {
    const http = spawnSync(process.execPath, [packager, '--target', 'staging', '--skip-build', '--dist', dist, '--out', path.join(tmp, 'x1'), '--site-url', 'http://staging.jyocancook.com'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(http.status, 0);
    assert.match(http.stderr, /https/);
    const missing = spawnSync(process.execPath, [packager, '--target', 'staging', '--skip-build', '--dist', path.join(tmp, 'nope'), '--out', path.join(tmp, 'x2')], { cwd: root, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.ok(!fs.existsSync(path.join(tmp, 'x2')), 'nothing written for a missing build');
    const unknown = spawnSync(process.execPath, [packager, '--target', 'prod', '--skip-build', '--dist', dist, '--out', path.join(tmp, 'x3')], { cwd: root, encoding: 'utf8' });
    assert.notEqual(unknown.status, 0);
  });

  it('fails verification when a secret sneaks into the build', () => {
    write('leak.js', 'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";');
    const leakOut = path.join(tmp, 'leak');
    const r = spawnSync(process.execPath, [packager, '--target', 'staging', '--skip-build', '--dist', dist, '--out', leakOut], { cwd: root, encoding: 'utf8' });
    fs.rmSync(path.join(dist, 'leak.js'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /GitHub token/);
    assert.ok(!fs.existsSync(leakOut), 'a failed package leaves no archives behind');
  });
});

describe('deploy/staging archives built by "npm run package:staging"', () => {
  const dir = path.join(root, 'deploy/staging');
  const pz = path.join(dir, 'public_html.zip');
  const bz = path.join(dir, 'backend.zip');
  const built = fs.existsSync(pz) && fs.existsSync(bz);

  it('exist, contain nothing but the two archives and a checksum file', { skip: !built && 'run npm run package:staging first' }, () => {
    assert.deepEqual(fs.readdirSync(dir).sort(), ['MANIFEST.sha256', 'backend.zip', 'public_html.zip']);
  });

  it('place index.html and api/index.php where Hostinger needs them', { skip: !built && 'run npm run package:staging first' }, () => {
    const pub = files(pz);
    assert.ok(pub.includes('index.html'));
    assert.ok(pub.includes('api/index.php'));
    assert.ok(pub.some((n: string) => n.startsWith('_astro/') && n.endsWith('.css')), 'bundled CSS');
    assert.ok(pub.some((n: string) => n.startsWith('_astro/') && n.endsWith('.js')), 'bundled JavaScript');
    assert.ok(pub.some((n: string) => /^images\/.*\.(jpe?g|png|webp)$/i.test(n)), 'images');
    assert.deepEqual(pub.filter((n: string) => n.endsWith('.php')), ['api/index.php']);
    assert.ok(!pub.some((n: string) => /^(public_html|staging)\//.test(n)));
    const back = files(bz);
    assert.ok(back.includes('auth/Auth.php'));
    assert.ok(back.includes('config/config.local.sample.php'));
    assert.ok(!back.some((n: string) => /config\.local\.php$/.test(n)));
    assert.ok(!back.some((n: string) => /^(backend|backend-staging)\//.test(n)));
  });
});
