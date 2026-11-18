#!/usr/bin/env node
/**
 * JyoCanCook Hostinger packager (Node.js only, no PHP required).
 * Both targets are built from the same code; the target only changes URLs, paths and guards.
 *
 * Usage:
 *   node bin/package-hostinger.mjs [--target staging|production] [--site-url URL]
 *                                  [--mode initial|update]
 *                                  [--skip-build] [--dist DIR] [--out DIR]
 *                                  [--seed-ref HEAD|<git ref>|worktree]
 *
 * Everything is built from the checked-out branch: the site from the working tree and the database
 * seed from HEAD of that branch (default). No other branch (such as `main`) is read.
 *
 * --mode initial (default): the full first deployment, including the database seed and the pages
 *   and images built from the repository.
 * --mode update: a code-only package for every deployment after the first one. It contains NO
 *   recipe pages, listing/category/tag pages, search index, sitemap, images or database seed, so
 *   extracting it can never overwrite admin-managed recipes or uploaded photos. MySQL stays the
 *   source of truth; after an update, "Rebuild All Static Pages" regenerates pages from MySQL.
 *
 * Produces <out> (default deploy/<target>/ or deploy/<target>-update/) containing exactly two archives:
 *
 *   target      public_html.zip extracts INTO                  backend.zip extracts INTO
 *   staging     HOSTINGER_ACCOUNT_ROOT/public_html/staging/    HOSTINGER_ACCOUNT_ROOT/backend-staging/
 *   production  HOSTINGER_ACCOUNT_ROOT/public_html/            HOSTINGER_ACCOUNT_ROOT/backend-production/
 *
 * Both archives hold their files at the archive root (no wrapper folder), so extracting "here" into
 * the destination folder gives the right layout. They never contain credentials: a
 * config.local.sample.php with REPLACE_* placeholders is included and the real config.local.php is
 * created on the server. The packages are verified by reading the finished archives back.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entriesFromDir, readZip, writeZip } from './zip-util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------- CLI ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const target = opt('target', 'staging');
if (!['staging', 'production'].includes(target)) fail(`Unknown --target "${target}" (use staging or production)`);
const mode = opt('mode', 'initial');
if (!['initial', 'update'].includes(mode)) fail(`Unknown --mode "${mode}" (use initial or update)`);
const isUpdate = mode === 'update';
const isStaging = target === 'staging';
const siteUrl = opt('site-url', isStaging ? 'https://staging.jyocancook.com' : 'https://jyocancook.com').replace(/\/+$/, '');
let siteHost;
try {
  siteHost = new URL(siteUrl).hostname.toLowerCase();
} catch {
  fail(`Invalid --site-url "${siteUrl}"`);
}
if (isStaging && !siteUrl.startsWith('https://')) fail('--site-url must be https:// for staging');

const distDir = path.resolve(root, opt('dist', 'dist'));
const outDir = path.resolve(root, opt('out', path.join('deploy', isUpdate ? `${target}-update` : target)));
if (outDir === root || root.startsWith(outDir + path.sep) || outDir === path.parse(outDir).root) fail(`Refusing to use "${outDir}" as output directory`);
const workDir = path.join(outDir, '_work');
const publicDir = path.join(workDir, 'public_html');
const backendDir = path.join(workDir, 'backend');

// Where each archive is extracted on the server (relative to HOSTINGER_ACCOUNT_ROOT).
const publicDest = isStaging ? 'public_html/staging' : 'public_html';
const backendDest = isStaging ? 'backend-staging' : 'backend-production';

// ---------- fs helpers ----------
function copyDir(src, dst, skip = () => false) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (skip(s, entry)) continue;
    if (entry.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

// ---------- 1. Build ----------
if (!flag('skip-build')) {
  console.log(`Building Astro site for ${siteUrl} ...`);
  const r = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, SITE_URL: siteUrl } });
  if (r.status !== 0) fail('npm run build failed');
}
if (!fs.existsSync(path.join(distDir, 'index.html'))) fail(`${path.join(distDir, 'index.html')} not found. Run "npm run build" first.`);

// ---------- 2. Clean output ----------
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(backendDir, { recursive: true });

// ---------- 3. public_html contents ----------
console.log('Assembling public_html.zip contents ...');
// Astro's static /api/* output contains development-only stubs; only the PHP gateway may serve /api.
copyDir(distDir, publicDir, (src) => {
  const rel = path.relative(distDir, src).split(path.sep).join('/');
  return rel === 'api' || rel === '.htaccess' || rel === 'robots.txt';
});

fs.mkdirSync(path.join(publicDir, 'api'), { recursive: true });
fs.copyFileSync(path.join(root, 'api/index.php'), path.join(publicDir, 'api/index.php'));

// Staging must answer only for its own host name. A directory that has its own mod_rewrite rules does
// NOT inherit the parent's rules, so the guard is written into every .htaccess that uses rewriting.
// It is what blocks https://jyocancook.com/staging/ (the main domain serving this folder as a path).
const hostGuard = isStaging
  ? `# STAGING ISOLATION: answer only for ${siteHost}. Requests for any other host name
# (for example https://jyocancook.com/staging/...) are refused with 403.
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{HTTP_HOST} !^${siteHost.replace(/\./g, '\\.')}(:[0-9]+)?$ [NC]
    RewriteRule ^ - [F,L]
</IfModule>

`
  : '';

fs.writeFileSync(path.join(publicDir, 'api/.htaccess'), hostGuard + fs.readFileSync(path.join(root, 'api/.htaccess'), 'utf8'));

// PHP-generated pages link /styles/global.css (Astro bundles CSS under /_astro/ instead).
fs.mkdirSync(path.join(publicDir, 'styles'), { recursive: true });
fs.copyFileSync(path.join(root, 'src/styles/global.css'), path.join(publicDir, 'styles/global.css'));

// Upload target for admin photo uploads: scripts can never execute from here, even before the
// first upload (ImageService only creates this file if it is missing).
fs.mkdirSync(path.join(publicDir, 'images/recipes'), { recursive: true });
fs.writeFileSync(
  path.join(publicDir, 'images/recipes/.htaccess'),
  `${hostGuard}# Block script execution in upload directory
<FilesMatch "\\.(php|phtml|php3|php4|php5|php7|php8|phps|phar|cgi|pl|py|sh|shtml|htaccess)$">
    Order Deny,Allow
    Deny from all
</FilesMatch>
Options -ExecCGI -Indexes
`
);

// Only content-hashed Astro bundles get long-lived immutable caching.
fs.mkdirSync(path.join(publicDir, '_astro'), { recursive: true });
fs.writeFileSync(
  path.join(publicDir, '_astro/.htaccess'),
  `${hostGuard}<IfModule mod_headers.c>
    Header set Cache-Control "public, max-age=31536000, immutable"
</IfModule>
`
);

let htaccess = hostGuard + fs.readFileSync(path.join(root, 'public/.htaccess'), 'utf8');
let robots;
if (isStaging) {
  htaccess += `
# STAGING ONLY: keep search engines out
<IfModule mod_headers.c>
    Header set X-Robots-Tag "noindex, nofollow, noarchive"
</IfModule>
`;
  robots = 'User-agent: *\nDisallow: /\n';
} else {
  robots = fs
    .readFileSync(path.join(root, 'public/robots.txt'), 'utf8')
    .replace(/https:\/\/[^\s/]+\/sitemap-index\.xml/, `${siteUrl}/sitemap-index.xml`);
}
fs.writeFileSync(path.join(publicDir, '.htaccess'), htaccess);
fs.writeFileSync(path.join(publicDir, 'robots.txt'), robots);

// Update packages carry code only. Everything below is created from MySQL by the admin's publisher
// or uploaded through the admin, so it must never be part of a package that is extracted over a live site.
const CONTENT_PATHS = ['index.html', '404.html', 'recipes', 'category', 'tag', 'search', 'about', 'images', 'pagefind', 'search-index.json', 'sitemap-0.xml', 'sitemap-index.xml'];
if (isUpdate) {
  for (const p of CONTENT_PATHS) fs.rmSync(path.join(publicDir, p), { recursive: true, force: true });
}

// ---------- 4. backend contents (private) ----------
console.log('Assembling backend.zip contents ...');
copyDir(path.join(root, 'backend'), backendDir, (src) => {
  const name = path.basename(src);
  return name === 'config.local.php' || name === 'tmp' || name.startsWith('.env');
});
fs.mkdirSync(path.join(backendDir, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(backendDir, 'tmp/.htaccess'), 'Require all denied\n');
// Defence in depth: deny web access to the whole backend if it is ever mapped under a web root.
fs.writeFileSync(path.join(backendDir, '.htaccess'), 'Require all denied\n');

// Seed data for backend/db/import-content.php and migrate.php (the server has no src/ or config/ directories).
// Default: HEAD of the checked-out (Hostinger) branch, read from git, so the seed is exactly what is committed.
// --seed-ref worktree: use the files in the working tree; --seed-ref <ref>: any other git ref.
const seedRef = opt('seed-ref', 'HEAD');
const seedFail = (msg) => {
  fs.rmSync(outDir, { recursive: true, force: true }); // a failed package leaves no archives behind
  fail(msg);
};
if (isUpdate) {
  // The seed is only for the first import. An update package never carries it, so a later deployment
  // cannot bring back recipes that were deleted in the admin.
  console.log('Update package: no database seed, pages or images are included.');
} else if (seedRef === 'worktree') {
  copyDir(path.join(root, 'config'), path.join(backendDir, 'seed/config'));
  copyDir(path.join(root, 'src/content/recipes'), path.join(backendDir, 'seed/recipes'), (src, entry) => entry.isFile() && !src.endsWith('.json'));
} else {
  const git = (...gitArgs) => {
    const r = spawnSync('git', gitArgs, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) seedFail(`git ${gitArgs.join(' ')} failed for seed ref "${seedRef}": ${(r.error?.message || r.stderr || '').toString().trim()}`);
    return r.stdout;
  };
  const listed = git('ls-tree', '-r', '--name-only', seedRef, '--', 'config', 'src/content/recipes').toString('utf8').split('\n').filter(Boolean);
  const wanted = listed.filter((f) => /^config\/(categories|tags|menu)\.json$/.test(f) || /^src\/content\/recipes\/[^/]+\.json$/.test(f));
  if (!wanted.some((f) => f.startsWith('src/content/recipes/'))) seedFail(`Seed ref "${seedRef}" has no recipes in src/content/recipes`);
  if (!wanted.includes('config/categories.json')) seedFail(`Seed ref "${seedRef}" has no config/categories.json`);
  for (const file of wanted) {
    const dest = path.join(backendDir, 'seed', file.replace(/^src\/content\/recipes\//, 'recipes/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, git('show', `${seedRef}:${file}`));
  }
  console.log(`Seed content taken from git ref "${seedRef}" (${wanted.filter((f) => f.startsWith('src/')).length} recipes)`);
  // Static pages in the build come from the working tree; they are replaced from MySQL on the first publish.
  const drift = spawnSync('git', ['diff', '--stat', seedRef, '--', 'config', 'src/content/recipes'], { cwd: root, encoding: 'utf8' });
  if (drift.status === 0 && drift.stdout.trim()) {
    console.warn(`WARNING: content in the working tree differs from "${seedRef}" (the database seed uses "${seedRef}"):\n${drift.stdout.trimEnd()}`);
  }
}
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (dirty.status === 0 && dirty.stdout.trim()) console.warn('WARNING: the working tree has uncommitted changes; this package was built from them.');

const allowedHosts = isStaging ? [siteHost] : [siteHost, `www.${siteHost}`];
const phpList = (items) => `[${items.map((h) => `'${h}'`).join(', ')}]`;

fs.writeFileSync(
  path.join(backendDir, 'config/config.local.sample.php'),
  `<?php
// Copy to config.local.php IN THIS FOLDER ON THE SERVER and replace every REPLACE_* value.
// This folder is outside public_html. Never upload config.local.php to GitHub or put it in a ZIP.
//
// Account root = the Hostinger folder that contains both public_html/ and ${backendDest}/.
// It is derived from this file's location (${backendDest}/config/ -> two levels up). If your layout
// differs, replace the next line with the real absolute path, e.g. '/home/<account>/domains/...'.
$accountRoot = dirname(__DIR__, 2);

return [
    'db' => [
        'host' => 'localhost',               // REPLACE if hPanel shows a different MySQL host
        'port' => 3306,
        'name' => 'REPLACE_DB_NAME',         // the ${isStaging ? 'STAGING' : 'production'} database only
        'user' => 'REPLACE_DB_USER',
        'pass' => 'REPLACE_DB_PASSWORD',
        'charset' => 'utf8mb4',
    ],
    'site' => [
        'environment' => '${target}',        // must match api/config.local.php on the server
        'url' => '${siteUrl}',
        // Host names this backend may serve; anything else gets 404 from the API.
        'allowed_hosts' => ${phpList(allowedHosts)},
        // The ONLY directory the publisher writes to.
        'public_path' => $accountRoot . '/${publicDest}',
        'upload_path' => $accountRoot . '/${publicDest}/images/recipes',
    ],
    'auth' => [
        // 64 hex chars, e.g. from: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
        'session_secret' => 'REPLACE_WITH_64_HEX_CHARS',
        'session_lifetime' => 28800,         // seconds an admin session stays valid (8 hours)
        // Reverse proxies/CDNs whose X-Forwarded-For / CF-Connecting-IP may be trusted for login
        // rate limiting. KEEP EMPTY unless the site sits behind a proxy with known CIDR ranges.
        // Never list 0.0.0.0/0, ::/0 or other very wide ranges (they are ignored anyway).
        'trusted_proxies' => [],
    ],
];
`
);

fs.writeFileSync(
  path.join(backendDir, 'config/api.config.local.sample.php'),
  `<?php
// Copy to api/config.local.php ON THE SERVER, i.e. ${publicDest}/api/config.local.php, and edit.
// It only tells the public API gateway where its private backend lives. No passwords go in here.
// The API refuses to start if the path is relative, missing, incomplete, or inside public_html.
return [
    'backend_path' => '/ABSOLUTE/PATH/TO/HOSTINGER_ACCOUNT_ROOT/${backendDest}',
    'environment' => '${target}',
];
`
);

// ---------- 5. Archives ----------
console.log('Creating archives ...');
const publicZip = path.join(outDir, 'public_html.zip');
const backendZip = path.join(outDir, 'backend.zip');
writeZip(publicZip, entriesFromDir(publicDir));
writeZip(backendZip, entriesFromDir(backendDir));
fs.rmSync(workDir, { recursive: true, force: true });

// ---------- 6. Verify the archives by reading them back ----------
console.log('Verifying archives ...');
const problems = [];
const readArchive = (zipPath) => {
  const entries = readZip(zipPath);
  const names = entries.map((e) => e.name);
  for (const n of names) {
    if (n.startsWith('./') || n.startsWith('/') || n.includes('\\') || n.includes('..')) problems.push(`${path.basename(zipPath)}: unsafe entry name "${n}"`);
  }
  if (new Set(names).size !== names.length) problems.push(`${path.basename(zipPath)}: duplicate entries`);
  return new Map(entries.filter((e) => !e.dir).map((e) => [e.name, e.data]));
};
const pub = readArchive(publicZip);
const back = readArchive(backendZip);
const text = (map, name) => (map.get(name) ?? Buffer.alloc(0)).toString('utf8');

const forbiddenNames = [/(^|\/)config\.local\.php$/, /(^|\/)\.env/, /wrangler/i, /(^|\/)\.git(\/|$)/, /node_modules/, /\.pem$/, /\.key$/];
const forbiddenContent = [
  [/JyoCanCook@2026/, 'old default admin password'],
  [/jyo-secret-salt/, 'old default session secret'],
  [/ADMIN_DEFAULT_PASSWORD/, 'default admin password env hook'],
  [/local-dev-sha/, 'development API stub marker'],
  [/localDev/, 'development API stub marker'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key'],
];
const textExt = /\.(php|html|js|mjs|css|json|xml|txt|sql|md|svg)$|(^|\/)\.htaccess$/;
const credentialAssign = /['"](pass|password|session_secret|secret)['"]\s*=>\s*['"]([^'"]+)['"]/g;

for (const [label, map] of [['public_html.zip', pub], ['backend.zip', back]]) {
  for (const [rel, data] of map) {
    if (forbiddenNames.some((re) => re.test(rel))) problems.push(`${label}: forbidden file ${rel}`);
    if (!textExt.test(rel)) continue;
    const content = data.toString('utf8');
    for (const [re, what] of forbiddenContent) if (re.test(content)) problems.push(`${label}: ${what} found in ${rel}`);
    if (rel.endsWith('.php')) {
      for (const m of content.matchAll(credentialAssign)) {
        if (!m[2].startsWith('REPLACE_')) problems.push(`${label}: hardcoded credential value for "${m[1]}" in ${rel}`);
      }
    }
  }
}

// Layout: archive roots are the destination folders themselves (no wrapper folder).
for (const wrapper of ['public_html/', 'staging/', 'backend/', 'backend-staging/']) {
  if ([...pub.keys()].some((n) => n.startsWith(wrapper))) problems.push(`public_html.zip must not contain a "${wrapper}" folder level`);
  if ([...back.keys()].some((n) => n.startsWith(wrapper))) problems.push(`backend.zip must not contain a "${wrapper}" folder level`);
}
const phpInPublic = [...pub.keys()].filter((f) => f.endsWith('.php'));
if (phpInPublic.join() !== 'api/index.php') problems.push(`unexpected PHP in public_html.zip: ${phpInPublic.join(', ')}`);
const apiFiles = [...pub.keys()].filter((f) => f.startsWith('api/')).sort();
if (apiFiles.join() !== ['api/.htaccess', 'api/index.php'].join()) {
  problems.push(`api/ must contain only index.php and .htaccess, found: ${apiFiles.join(', ')}`);
}

const rootHt = text(pub, '.htaccess');
const httpsAt = rootHt.indexOf('RewriteCond %{HTTPS} off');
if (httpsAt < 0 || httpsAt > rootHt.indexOf('/api/index.php')) problems.push('.htaccess: force-HTTPS must come before the /api rewrite');
if (/Cache-Control[^\n]*immutable/.test(rootHt)) problems.push('.htaccess must not use immutable caching for unhashed files');
if (!/immutable/.test(text(pub, '_astro/.htaccess'))) problems.push('_astro/.htaccess missing immutable caching');

const apiSrc = text(pub, 'api/index.php');
if (/dirname\(__DIR__(,\s*\d)?\)\s*\.\s*'\/backend'/.test(apiSrc)) problems.push('api/index.php still falls back to a guessed backend folder');
if (!apiSrc.includes('JYOCANCOOK_BACKEND_PATH')) problems.push('api/index.php does not use the configured backend path');
if (/svg\+xml/.test(text(back, 'services/ImageService.php'))) problems.push('ImageService still allows SVG uploads');

if (!isStaging) {
  // Production must carry nothing of staging, and must not be able to replace or disturb it.
  const publicNames = [...pub.keys()];
  if (publicNames.some((n) => n === 'staging' || n.startsWith('staging/'))) problems.push('public_html.zip must not contain a staging/ folder (it would overwrite the staging site)');
  if (backendDest !== 'backend-production') problems.push('production backend must extract into backend-production');
  for (const [label, map] of [['public_html.zip', pub], ['backend.zip', back]]) {
    for (const [rel, data] of map) {
      if (!/\.(php|html|xml|txt|json|js|css)$|(^|\/)\.htaccess$/.test(rel) || rel === 'api/index.php' || rel.startsWith('db/') || rel.startsWith('seed/')) continue;
      const body = data.toString('utf8');
      // A build made with the staging SITE_URL (or a copied staging file) would point at staging.
      if (/staging\.jyocancook\.com|backend-staging/.test(body)) problems.push(`${label}: staging host or path found in ${rel}`);
      if (/(^|\/)\.htaccess$/.test(rel) && /X-Robots-Tag/.test(body)) problems.push(`${label}: staging noindex header found in ${rel}`);
    }
  }
  if (/Disallow:\s*\/\s*$/m.test(text(pub, 'robots.txt'))) problems.push('robots.txt must not block the production site');
  if (/RewriteCond %\{HTTP_HOST\}\s+!\^/.test(rootHt)) problems.push('.htaccess: staging host guard must not be present in production');
  if (!text(pub, 'robots.txt').includes(`${siteUrl}/sitemap-index.xml`)) problems.push(`robots.txt must point to ${siteUrl}/sitemap-index.xml`);

  const sample = text(back, 'config/config.local.sample.php');
  if (!sample.includes("'environment' => 'production'")) problems.push('config.local.sample.php: environment must be production');
  if (!sample.includes(`'allowed_hosts' => ['${siteHost}', 'www.${siteHost}']`)) problems.push('config.local.sample.php: allowed_hosts must be the production host names');
  if (!sample.includes("'public_path' => $accountRoot . '/public_html',")) problems.push('config.local.sample.php: public_path must be public_html');
  if (!sample.includes("'upload_path' => $accountRoot . '/public_html/images/recipes',")) problems.push('config.local.sample.php: upload_path must be public_html/images/recipes');
  if (!sample.includes(`'url' => '${siteUrl}'`)) problems.push('config.local.sample.php: url mismatch');
  if (!/'trusted_proxies'\s*=>\s*\[\]/.test(sample)) problems.push('config.local.sample.php: trusted_proxies must default to []');
  const gw = text(back, 'config/api.config.local.sample.php');
  if (!gw.includes("'environment' => 'production'") || !gw.includes('/backend-production')) problems.push('api.config.local.sample.php must name backend-production and production');
  if (/backend-staging/.test(sample + gw)) problems.push('production config samples must not mention backend-staging');
}

if (isStaging) {
  const guard = `RewriteCond %{HTTP_HOST} !^${siteHost.replace(/\./g, '\\.')}(:[0-9]+)?$ [NC]`;
  for (const ht of ['.htaccess', 'api/.htaccess', 'images/recipes/.htaccess', '_astro/.htaccess']) {
    const body = text(pub, ht);
    if (!body.includes(guard)) problems.push(`${ht}: staging host guard missing`);
    else if (body.indexOf(guard) > body.indexOf('RewriteBase') && body.includes('RewriteBase')) problems.push(`${ht}: host guard must come first`);
  }
  if (!/noindex/.test(rootHt)) problems.push('.htaccess: staging X-Robots-Tag noindex missing');
  if (!/Disallow: \//.test(text(pub, 'robots.txt'))) problems.push('robots.txt must disallow everything on staging');

  const sample = text(back, 'config/config.local.sample.php');
  if (!/'trusted_proxies'\s*=>\s*\[\]/.test(sample)) problems.push('config.local.sample.php: trusted_proxies must default to []');
  if (!sample.includes("'environment' => 'staging'")) problems.push('config.local.sample.php: environment must be staging');
  if (!sample.includes(`'allowed_hosts' => ['${siteHost}']`)) problems.push('config.local.sample.php: allowed_hosts must be only the staging host');
  if (!sample.includes("$accountRoot . '/public_html/staging'")) problems.push('config.local.sample.php: public_path must be public_html/staging');
  if (!sample.includes("$accountRoot . '/public_html/staging/images/recipes'")) problems.push('config.local.sample.php: upload_path must be inside public_html/staging');
}

for (const [label, map, name] of [
  ['public_html.zip', pub, 'admin/index.html'],
  ['public_html.zip', pub, 'api/index.php'],
  ['public_html.zip', pub, 'api/.htaccess'],
  ['public_html.zip', pub, '_astro/.htaccess'],
  ['public_html.zip', pub, 'styles/global.css'],
  ['public_html.zip', pub, '.htaccess'],
  ['backend.zip', back, 'db/create-admin.php'],
  ['backend.zip', back, 'db/migrate.php'],
  ['backend.zip', back, 'db/import-content.php'],
  ['backend.zip', back, 'db/schema.sql'],
  ['backend.zip', back, 'generator/generate.php'],
  ['backend.zip', back, 'generator/SiteGenerator.php'],
  ['backend.zip', back, 'services/PathGuard.php'],
  ['backend.zip', back, 'auth/Auth.php'],
  ['backend.zip', back, 'config/config.php'],
  ['backend.zip', back, 'config/config.local.sample.php'],
  ['backend.zip', back, 'config/api.config.local.sample.php'],
  ['backend.zip', back, 'tmp/.htaccess'],
]) {
  if (!map.has(name)) problems.push(`${label}: missing required file ${name}`);
}
if (isUpdate) {
  // An update package must not be able to replace anything the admin manages in MySQL or uploads.
  const contentLike = (n) => CONTENT_PATHS.some((p) => n === p || n.startsWith(`${p}/`)) || /^sitemap.*\.xml$/.test(n);
  for (const n of pub.keys()) if (contentLike(n)) problems.push(`update public_html.zip must not contain content or uploads: ${n}`);
  for (const n of back.keys()) if (n.startsWith('seed/')) problems.push(`update backend.zip must not contain the database seed: ${n}`);
} else {
  for (const [label, map, name] of [
    ['public_html.zip', pub, 'index.html'],
    ['public_html.zip', pub, 'images/recipes/.htaccess'],
    ['public_html.zip', pub, 'recipes/index.html'],
    ['backend.zip', back, 'seed/config/categories.json'],
  ]) {
    if (!map.has(name)) problems.push(`${label}: missing required file ${name}`);
  }
}
if (!isUpdate && ![...pub.keys()].some((f) => f.startsWith('images/') && /\.(jpe?g|png|webp)$/i.test(f))) problems.push('public_html.zip: no recipe images included');
if (![...pub.keys()].some((f) => f.startsWith('_astro/') && f.endsWith('.css'))) problems.push('public_html.zip: no bundled CSS included');
if (![...pub.keys()].some((f) => f.startsWith('_astro/') && f.endsWith('.js'))) problems.push('public_html.zip: no bundled JavaScript included');

if (problems.length) {
  console.error('\nPackage verification FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

// ---------- 7. Checksums of the two archives ----------
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.writeFileSync(path.join(outDir, 'MANIFEST.sha256'), `${sha(publicZip)}  public_html.zip\n${sha(backendZip)}  backend.zip\n`);

console.log(`\n${isUpdate ? 'Code-only UPDATE package' : 'Package'} for ${target} (${siteUrl}) verified: ${pub.size} public files, ${back.size} backend files`);
console.log(`  ${publicZip}\n    -> extract into HOSTINGER_ACCOUNT_ROOT/${publicDest}/`);
console.log(`  ${backendZip}\n    -> extract into HOSTINGER_ACCOUNT_ROOT/${backendDest}/`);
