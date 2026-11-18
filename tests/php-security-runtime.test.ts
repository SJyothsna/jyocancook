/**
 * Runtime security tests for the PHP API gateway (api/index.php + backend/) in the Hostinger
 * staging layout (see tests/helpers/php-harness.ts).
 *
 * IMPORTANT - what this actually runs: PHP 8.3 compiled to WebAssembly (@php-wasm/node)
 * driven from Node, with a SQLite stand-in injected for the database. It is NOT Hostinger's
 * PHP build and NOT MySQL. It proves the HTTP gateway logic (HTTPS gate, CSRF, uploads, error
 * handling, rate limiting, backend resolution). MySQL-specific SQL is out of scope here.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  php, makeTmp, makeSite, startPhp, stopPhp, client, call, login, authed, json, resetDb, phpRun,
  chunk, makePng, dataUrl, sidecarPhp, configLocalPhp, STAGING_HOST, ADMIN_USER, rootDir,
  type Site, type Client, type Boot,
} from './helpers/php-harness.ts';

// ---------------------------------------------------------------- suite

describe('PHP API gateway runtime security (WASM PHP 8.3 + SQLite stand-in)', () => {
  let main: Site; // complete staging layout
  let bare: Site; // no private backend anywhere; decoy backends inside the web roots
  let cfg: Site; // complete staging layout whose config files the tests rewrite

  before(async () => {
    makeTmp();
    main = makeSite('main');
    bare = makeSite('bare', { backend: false, sidecar: false, decoys: true });
    cfg = makeSite('cfg');
    await startPhp();
  });

  after(stopPhp);

  // ------------------------------------------------------------ HTTPS

  describe('HTTPS gate', () => {
    it('refuses status and login over plain HTTP', async () => {
      const c = client(main, { https: false });
      const s = await call(c, 'GET', '/api/admin/status');
      assert.equal(s.httpStatusCode, 403);
      assert.match(json(s).error, /HTTPS/);
      const l = await login(c);
      assert.equal(l.httpStatusCode, 403);
      assert.equal(json(l).csrf_token, undefined);
    });

    it('serves login over HTTPS', async () => {
      await resetDb(main);
      const l = await login(client(main));
      assert.equal(l.httpStatusCode, 200);
    });
  });

  // ------------------------------------------------------------ CSRF

  describe('CSRF protection on authenticated state-changing calls', () => {
    const png = () => dataUrl('image/png', makePng());
    const mutating: Array<[string, string, string, () => unknown]> = [
      ['POST', '/api/admin/image', 'image upload', () => ({ name: 'a.png', content: png() })],
      ['POST', '/api/admin/recipes', 'recipe create', () => ({ recipe: { title: 'x' } })],
      ['POST', '/api/admin/recipes/some-slug', 'recipe update', () => ({ recipe: { title: 'x' } })],
      ['DELETE', '/api/admin/recipes/some-slug', 'recipe delete', () => undefined],
      ['POST', '/api/admin/categories', 'categories save', () => ({ data: [] })],
      ['POST', '/api/admin/tags', 'tags save', () => ({ data: [] })],
      ['POST', '/api/admin/menu', 'menu save', () => ({ data: [] })],
      ['POST', '/api/admin/publish', 'publish', () => undefined],
    ];

    for (const [method, url, label, body] of mutating) {
      it(`${label}: missing token -> 403`, async () => {
        await resetDb(main);
        const { c } = await authed(main);
        const r = await call(c, method, url, body());
        assert.equal(r.httpStatusCode, 403, r.text);
        assert.equal(json(r).error, 'Invalid or missing CSRF token');
      });

      it(`${label}: invalid / empty / truncated token -> 403`, async () => {
        await resetDb(main);
        const { c, csrf } = await authed(main);
        for (const bad of ['x'.repeat(64), '', 'null', csrf.slice(0, 32), csrf + 'a', csrf.toUpperCase()]) {
          const r = await call(c, method, url, body(), { 'X-CSRF-Token': bad });
          assert.equal(r.httpStatusCode, 403, `token "${bad.slice(0, 10)}": ${r.text}`);
        }
      });

      it(`${label}: valid token is accepted past the CSRF gate`, async () => {
        await resetDb(main);
        const { c, csrf } = await authed(main);
        const r = await call(c, method, url, body(), { 'X-CSRF-Token': csrf });
        assert.notEqual(r.httpStatusCode, 403, r.text);
        assert.notEqual(r.httpStatusCode, 401, r.text);
      });

      it(`${label}: unauthenticated -> 401`, async () => {
        await resetDb(main);
        const r = await call(client(main), method, url, body(), { 'X-CSRF-Token': 'a'.repeat(64) });
        assert.equal(r.httpStatusCode, 401, r.text);
      });
    }

    it('accepts the token from the JSON body as well as the header', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const r = await call(c, 'POST', '/api/admin/image', { name: 'b.png', content: dataUrl('image/png', makePng()), csrf_token: csrf });
      assert.equal(r.httpStatusCode, 200, r.text);
    });

    it('does not require a token for safe GET requests', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const status = await call(c, 'GET', '/api/admin/status');
      assert.equal(status.httpStatusCode, 200);
      assert.equal(json(status).csrf_token, csrf);
    });

    it('rejects a token from a different session', async () => {
      await resetDb(main);
      const a = await authed(main);
      const b = await authed(main);
      assert.notEqual(a.csrf, b.csrf);
      const r = await call(a.c, 'POST', '/api/admin/publish', undefined, { 'X-CSRF-Token': b.csrf });
      assert.equal(r.httpStatusCode, 403);
    });
  });

  // ------------------------------------------------------------ Logout

  describe('Logout', () => {
    it('GET is not allowed (cannot be triggered cross-site via a link or image)', async () => {
      await resetDb(main);
      const { c } = await authed(main);
      const r = await call(c, 'GET', '/api/auth/logout');
      assert.equal(r.httpStatusCode, 405);
      assert.equal((await call(c, 'GET', '/api/admin/status')).httpStatusCode, 200, 'session must survive');
    });

    it('POST without a token is rejected while logged in', async () => {
      await resetDb(main);
      const { c } = await authed(main);
      const r = await call(c, 'POST', '/api/auth/logout');
      assert.equal(r.httpStatusCode, 403);
    });

    it('POST with a valid token ends the session', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const r = await call(c, 'POST', '/api/auth/logout', undefined, { 'X-CSRF-Token': csrf });
      assert.equal(r.httpStatusCode, 200, r.text);
      assert.equal((await call(c, 'GET', '/api/admin/status')).httpStatusCode, 401);
    });
  });

  // ------------------------------------------------------------ Uploads

  describe('Image upload validation', () => {
    const upload = async (c: Client, csrf: string, name: string, content: string) =>
      call(c, 'POST', '/api/admin/image', { name, content }, { 'X-CSRF-Token': csrf });
    const uploadsDir = () => path.join(main.staging, 'images/recipes');

    it('rejects SVG, including SVG disguised as PNG/JPEG', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      for (const [name, mime] of [['x.svg', 'image/svg+xml'], ['x.png', 'image/png'], ['x.jpg', 'image/jpeg']]) {
        const r = await upload(c, csrf, name, dataUrl(mime, svg));
        assert.equal(r.httpStatusCode, 400, `${name}: ${r.text}`);
      }
      const leftovers = fs.existsSync(uploadsDir()) ? fs.readdirSync(uploadsDir()).filter((f) => /svg/i.test(f)) : [];
      assert.deepEqual(leftovers, []);
    });

    it('rejects PHP, HTML and script payloads regardless of declared name/type', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const payloads = [
        '<?php system($_GET["c"]); ?>',
        '<html><script>alert(1)</script></html>',
        '#!/bin/sh\nid\n',
        'GIF89a<?php echo 1; ?>',
      ];
      for (const p of payloads) {
        for (const name of ['shell.php', 'a.png', 'a.jpg', 'a.phtml', 'a.html']) {
          const r = await upload(c, csrf, name, dataUrl('image/png', Buffer.from(p)));
          assert.equal(r.httpStatusCode, 400, `${name}: ${r.text}`);
        }
      }
    });

    it('chooses the extension from the content, not the client file name', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const r = await upload(c, csrf, 'evil.php', dataUrl('image/png', makePng()));
      assert.equal(r.httpStatusCode, 200, r.text);
      const out = json(r);
      assert.match(out.filename, /\.png$/);
      assert.equal(out.mime, 'image/png');
      assert.ok(!/\.php/i.test(out.filename));
      assert.ok(fs.existsSync(path.join(uploadsDir(), out.filename)));
    });

    it('re-encodes images so an appended PHP payload is not stored', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const polyglot = Buffer.concat([makePng(), Buffer.from('\n<?php system($_GET["c"]); ?>\n')]);
      const r = await upload(c, csrf, 'poly.png', dataUrl('image/png', polyglot));
      if (r.httpStatusCode === 200) {
        const stored = fs.readFileSync(path.join(uploadsDir(), json(r).filename)).toString('latin1');
        assert.ok(!stored.includes('<?php'), 'stored file must not contain the payload');
      } else {
        assert.equal(r.httpStatusCode, 400, r.text);
      }
    });

    it('accepts JPEG and WebP generated by GD (skipped if GD codecs are missing)', async (t) => {
      await resetDb(main);
      const gen = await phpRun(`
        if (!function_exists('imagecreatetruecolor')) { echo json_encode([]); return; }
        $o = [];
        $im = imagecreatetruecolor(8, 8);
        ob_start(); imagejpeg($im); $o['jpeg'] = base64_encode(ob_get_clean());
        if (function_exists('imagewebp')) { ob_start(); imagewebp($im); $o['webp'] = base64_encode(ob_get_clean()); }
        echo json_encode($o);`);
      const imgs = JSON.parse(gen || '{}') as Record<string, string>;
      if (!imgs.jpeg) return t.skip('GD not available');
      const { c, csrf } = await authed(main);
      const j = await upload(c, csrf, 'photo.JPEG', `data:image/jpeg;base64,${imgs.jpeg}`);
      assert.equal(j.httpStatusCode, 200, j.text);
      assert.match(json(j).filename, /\.jpg$/);
      if (imgs.webp) {
        const w = await upload(c, csrf, 'photo.webp', `data:image/webp;base64,${imgs.webp}`);
        assert.equal(w.httpStatusCode, 200, w.text);
        assert.match(json(w).filename, /\.webp$/);
      }
    });

    it('rejects oversized, corrupt and non-base64 payloads', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const big = Buffer.concat([makePng(), Buffer.alloc(5 * 1024 * 1024)]);
      assert.equal((await upload(c, csrf, 'big.png', dataUrl('image/png', big))).httpStatusCode, 400);
      const corrupt = Buffer.concat([makePng().subarray(0, 40), Buffer.from('garbage-garbage-garbage')]);
      assert.equal((await upload(c, csrf, 'bad.png', dataUrl('image/png', corrupt))).httpStatusCode, 400);
      assert.equal((await upload(c, csrf, 'x.png', 'data:image/png;base64,!!!notbase64!!!')).httpStatusCode, 400);
      assert.equal((await upload(c, csrf, 'x.png', 'not a data url')).httpStatusCode, 400);
    });

    it('rejects absurd image dimensions (decompression-bomb guard)', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(30000, 0);
      ihdr.writeUInt32BE(30000, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const huge = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(Buffer.alloc(16))),
        chunk('IEND', Buffer.alloc(0)),
      ]);
      const r = await upload(c, csrf, 'huge.png', dataUrl('image/png', huge));
      assert.equal(r.httpStatusCode, 400, r.text);
    });
  });

  // ------------------------------------------------------------ Errors

  describe('Error handling does not leak internals', () => {
    const forbidden = [/SQLSTATE/i, /publish_logs/i, /sqlite/i, /mysql/i, /\.php/i, /\/main\b/, /\/backend/, /public_html/, /Stack trace/i, /PDOException/i, /#0 /];

    it('returns a generic 500 with only a reference id, and logs details privately', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      const r = await call(c, 'POST', '/api/admin/publish', undefined, { 'X-CSRF-Token': csrf });
      assert.equal(r.httpStatusCode, 500, r.text);
      const body = json(r);
      assert.deepEqual(Object.keys(body).sort(), ['error', 'ok', 'reference']);
      assert.equal(body.error, 'Internal server error');
      assert.match(body.reference, /^[0-9a-f]{12}$/);
      for (const re of forbidden) assert.ok(!re.test(r.text), `response leaked ${re}: ${r.text}`);

      const logPath = '/main/backend-staging/tmp/logs/api-errors.log';
      assert.ok(await php.fileExists(logPath), 'private log must exist');
      const logText = await php.readFileAsText(logPath);
      assert.ok(logText.includes(`ref=${body.reference}`), logText);
      assert.ok(!logPath.startsWith('/main/public_html'), 'log lives outside both web roots');
      assert.ok(!fs.existsSync(path.join(main.dir, 'public_html/staging/api-errors.log')), 'no log in the web root');
      assert.ok(!/password|pass=|session_secret/i.test(logText.replace(/password_hash/gi, '')), 'log has no credentials');
    });

    it('does not leak when the database is unreachable (real MySQL driver path)', async () => {
      const c = client(main, { boot: 'plain' });
      const r = await login(c);
      assert.equal(r.httpStatusCode, 500, r.text);
      for (const re of forbidden) assert.ok(!re.test(r.text), `response leaked ${re}: ${r.text}`);
      assert.ok(!/127\.0\.0\.1|root|jyocancook_db/i.test(r.text));
    });

    it('does not echo the requested path on 404', async () => {
      await resetDb(main);
      const { c } = await authed(main);
      const r = await call(c, 'GET', '/api/admin/nope-<script>alert(1)</script>');
      assert.equal(r.httpStatusCode, 404);
      assert.ok(!r.text.includes('nope'));
      assert.ok(!r.text.includes('<script>'));
    });

    it('never displays PHP errors/warnings in the response', async () => {
      await resetDb(main);
      const r = await call(client(main), 'GET', '/api/admin/status');
      assert.equal(r.httpStatusCode, 401);
      assert.doesNotThrow(() => JSON.parse(r.text), 'body must be pure JSON');
    });
  });

  // ------------------------------------------------------------ Rate limiting

  describe('Login rate limiting', () => {
    it('cannot be bypassed by spoofing X-Forwarded-For / CF-Connecting-IP', async () => {
      await resetDb(main);
      const c = client(main);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await login(c, { 'X-Forwarded-For': `198.51.100.${i + 1}`, 'CF-Connecting-IP': `203.0.113.${i + 1}`, 'X-Real-IP': `192.0.2.${i + 1}` }, 'wrong-password');
        statuses.push(r.httpStatusCode);
      }
      assert.deepEqual(statuses, [401, 401, 401, 401, 401]);
      const blocked = await login(c, { 'X-Forwarded-For': '198.51.100.99', 'CF-Connecting-IP': '203.0.113.99' }, 'wrong-password');
      assert.equal(blocked.httpStatusCode, 429);
      const correct = await login(c, { 'X-Forwarded-For': '198.51.100.200' });
      assert.equal(correct.httpStatusCode, 429, 'even the correct password is refused while locked out');
    });
  });

  describe('Auth::getClientIp / account lockout (PHP unit run)', () => {
    const prelude = `
      require_once '/main/backend-staging/auth/Auth.php';
      function mkAuth(array $cfg, ?PDO $pdo = null): Auth {
        $a = (new ReflectionClass('Auth'))->newInstanceWithoutConstructor();
        $p = new ReflectionProperty('Auth', 'config'); $p->setAccessible(true); $p->setValue($a, $cfg);
        if ($pdo) { $q = new ReflectionProperty('Auth', 'pdo'); $q->setAccessible(true); $q->setValue($a, $pdo); }
        return $a;
      }
      function ipFor(Auth $a, array $server): string {
        foreach (['REMOTE_ADDR', 'HTTP_X_FORWARDED_FOR', 'HTTP_CF_CONNECTING_IP'] as $k) unset($_SERVER[$k]);
        foreach ($server as $k => $v) $_SERVER[$k] = $v;
        return $a->getClientIp();
      }
    `;

    it('trusts forwarded headers only from configured proxy ranges', async () => {
      const out = await phpRun(`${prelude}
        $none = mkAuth(['trusted_proxies' => []]);
        $trusted = mkAuth(['trusted_proxies' => ['10.0.0.0/8', '2001:db8::/32', '192.0.2.5']]);
        $r = [];
        $r['untrusted_peer_spoof']   = ipFor($none, ['REMOTE_ADDR' => '203.0.113.9', 'HTTP_X_FORWARDED_FOR' => '1.2.3.4', 'HTTP_CF_CONNECTING_IP' => '5.6.7.8']);
        $r['empty_trust_list_proxy'] = ipFor($none, ['REMOTE_ADDR' => '10.1.1.1', 'HTTP_X_FORWARDED_FOR' => '1.2.3.4']);
        $r['untrusted_peer_with_trust_list'] = ipFor($trusted, ['REMOTE_ADDR' => '203.0.113.9', 'HTTP_X_FORWARDED_FOR' => '1.2.3.4']);
        $r['trusted_cf']            = ipFor($trusted, ['REMOTE_ADDR' => '10.1.1.1', 'HTTP_CF_CONNECTING_IP' => '198.51.100.7']);
        $r['trusted_xff_single']    = ipFor($trusted, ['REMOTE_ADDR' => '10.1.1.1', 'HTTP_X_FORWARDED_FOR' => '198.51.100.8']);
        $r['xff_spoof_prefix']      = ipFor($trusted, ['REMOTE_ADDR' => '10.1.1.1', 'HTTP_X_FORWARDED_FOR' => '9.9.9.9, 198.51.100.8']);
        $r['xff_skips_trusted_hops']= ipFor($trusted, ['REMOTE_ADDR' => '10.1.1.1', 'HTTP_X_FORWARDED_FOR' => '198.51.100.8, 10.2.2.2']);
        $r['xff_garbage']           = ipFor($trusted, ['REMOTE_ADDR' => '10.1.1.1', 'HTTP_X_FORWARDED_FOR' => 'not-an-ip']);
        $r['cf_garbage']            = ipFor($trusted, ['REMOTE_ADDR' => '10.1.1.1', 'HTTP_CF_CONNECTING_IP' => 'zzz']);
        $r['ipv6_trusted']          = ipFor($trusted, ['REMOTE_ADDR' => '2001:db8::1', 'HTTP_X_FORWARDED_FOR' => '2001:4860::1']);
        $r['ipv6_outside']          = ipFor($trusted, ['REMOTE_ADDR' => '2001:db9::1', 'HTTP_X_FORWARDED_FOR' => '2001:4860::1']);
        $r['single_host_trusted']   = ipFor($trusted, ['REMOTE_ADDR' => '192.0.2.5', 'HTTP_X_FORWARDED_FOR' => '198.51.100.9']);
        $r['single_host_neighbour'] = ipFor($trusted, ['REMOTE_ADDR' => '192.0.2.6', 'HTTP_X_FORWARDED_FOR' => '198.51.100.9']);
        $r['invalid_remote']        = ipFor($trusted, ['REMOTE_ADDR' => 'garbage', 'HTTP_X_FORWARDED_FOR' => '198.51.100.9']);
        $r['missing_remote']        = ipFor($trusted, ['HTTP_X_FORWARDED_FOR' => '198.51.100.9']);
        echo json_encode($r);`);
      assert.deepEqual(JSON.parse(out), {
        untrusted_peer_spoof: '203.0.113.9',
        empty_trust_list_proxy: '10.1.1.1',
        untrusted_peer_with_trust_list: '203.0.113.9',
        trusted_cf: '198.51.100.7',
        trusted_xff_single: '198.51.100.8',
        xff_spoof_prefix: '198.51.100.8',
        xff_skips_trusted_hops: '198.51.100.8',
        xff_garbage: '10.1.1.1',
        cf_garbage: '10.1.1.1',
        ipv6_trusted: '2001:4860::1',
        ipv6_outside: '2001:db9::1',
        single_host_trusted: '198.51.100.9',
        single_host_neighbour: '192.0.2.6',
        invalid_remote: '0.0.0.0',
        missing_remote: '0.0.0.0',
      });
    });

    it('locks an account after 20 failures even when the attacker rotates IPs', async () => {
      const out = await phpRun(`${prelude}
        $file = '/tmp/jyo-unit.sqlite'; @unlink($file);
        $pdo = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $pdo->exec('CREATE TABLE admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password_hash TEXT)');
        $pdo->exec('CREATE TABLE login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip_address TEXT, attempted_at TEXT)');
        $pdo->prepare('INSERT INTO admins (username, email, password_hash) VALUES (?,?,?)')->execute(['admin', 'a@example.test', password_hash('right-password', PASSWORD_DEFAULT)]);
        $a = mkAuth(['trusted_proxies' => [], 'rate_limit_max_attempts' => 5, 'rate_limit_account_max_attempts' => 20, 'rate_limit_lockout_seconds' => 900], $pdo);
        $st = [];
        for ($i = 1; $i <= 24; $i++) {
          $_SERVER['REMOTE_ADDR'] = '203.0.113.' . $i;
          $name = $i % 2 ? 'admin' : 'a@example.test'; // username and email share one counter
          $st[] = $a->login($name, 'wrong')['status'];
        }
        $_SERVER['REMOTE_ADDR'] = '203.0.113.200';
        $st[] = $a->login('admin', 'right-password')['status'] ?? 200;
        echo json_encode($st);
        @unlink($file);`);
      let st: number[];
      try { st = JSON.parse(out); } catch { assert.fail(out); }
      assert.deepEqual(st.slice(0, 20), Array(20).fill(401));
      assert.deepEqual(st.slice(20, 24), [429, 429, 429, 429]);
      assert.equal(st[24], 429, 'correct password is refused from a fresh IP while the account is locked');
    });
  });

  // ------------------------------------------------------------ Backend resolution

  describe('Private backend resolution (explicit, validated path; no fallback)', () => {
    const configError = { ok: false, error: 'Server configuration error' };
    const sidecarFile = (site: Site) => path.join(site.staging, 'api/config.local.php');
    const writeSidecar = (site: Site, backendPath: string, environment = 'staging') =>
      fs.writeFileSync(sidecarFile(site), sidecarPhp(site.mount, environment, backendPath));
    const statusOf = (site: Site, boot: Boot = 'plain', headers: Record<string, string> = {}) =>
      call(client(site, { boot }), 'GET', '/api/admin/status', undefined, headers);

    it('fails with a generic configuration error when no backend path is configured', async () => {
      assert.ok(!fs.existsSync(sidecarFile(bare)), 'precondition: no api/config.local.php');
      const r = await statusOf(bare);
      assert.equal(r.httpStatusCode, 500);
      assert.deepEqual(json(r), configError);
    });

    it('never falls back to a backend inside public_html or public_html/staging', async () => {
      for (const decoy of ['public_html/backend', 'public_html/staging/backend']) {
        assert.ok(fs.existsSync(path.join(bare.dir, decoy, 'config/config.php')), `precondition: decoy ${decoy} is complete`);
      }
      const r = await call(client(bare, { boot: 'plain' }), 'POST', '/api/auth/login', { username: 'a', password: 'b' });
      assert.equal(r.httpStatusCode, 500);
      assert.deepEqual(json(r), configError);
    });

    it('refuses an explicitly configured path that lies inside a web-served directory', async () => {
      try {
        for (const decoy of ['/bare/public_html/backend', '/bare/public_html/staging/backend']) {
          writeSidecar(bare, decoy);
          const r = await statusOf(bare);
          assert.equal(r.httpStatusCode, 500, decoy);
          assert.deepEqual(json(r), configError, decoy);
          assert.ok(!r.text.includes('bare'), 'the response never reveals paths');
        }
      } finally {
        fs.rmSync(sidecarFile(bare), { force: true });
      }
    });

    it('refuses relative, traversal, missing, empty and incomplete backend paths', async () => {
      try {
        await php.mkdir('/bare/incomplete-backend');
        await php.mkdir('/bare/incomplete-backend/config');
        await php.writeFile('/bare/incomplete-backend/config/config.php', '<?php return [];');
        for (const bad of [
          'backend-staging',
          '../backend-staging',
          '/bare/public_html/staging/../../backend-staging',
          '/bare/does-not-exist',
          '',
          '/bare/incomplete-backend',
        ]) {
          writeSidecar(bare, bad);
          const r = await statusOf(bare);
          assert.equal(r.httpStatusCode, 500, `"${bad}"`);
          assert.deepEqual(json(r), configError, `"${bad}"`);
        }
      } finally {
        fs.rmSync(sidecarFile(bare), { force: true });
      }
    });

    it('accepts the configured private backend outside every web root', async () => {
      const r = await statusOf(main, 'sqlite');
      assert.equal(r.httpStatusCode, 401, r.text);
      assert.equal(json(r).auth_required, true, 'got past resolution into the application');
    });

    it('requires a valid environment name that matches the backend configuration', async () => {
      try {
        for (const env of ['production', 'development', '', 'Staging']) {
          writeSidecar(main, '/main/backend-staging', env);
          const r = await statusOf(main, 'sqlite');
          assert.equal(r.httpStatusCode, 500, `environment "${env}"`);
          assert.deepEqual(json(r), configError, `environment "${env}"`);
        }
      } finally {
        fs.writeFileSync(sidecarFile(main), sidecarPhp(main.mount));
      }
    });

    describe('private boot log for "Server configuration error"', () => {
      const lastRecord = async (logPath: string) => {
        assert.ok(await php.fileExists(logPath), `boot log must exist: ${logPath}`);
        const lines = (await php.readFileAsText(logPath)).trim().split('\n');
        return { text: lines.join('\n'), record: JSON.parse(lines[lines.length - 1]) };
      };

      it('records an incomplete backend with its missing files, but never credentials', async () => {
        const dir = '/bare/boot-log-backend';
        try {
          await php.mkdir(dir);
          await php.mkdir(`${dir}/config`);
          await php.writeFile(`${dir}/config/config.php`, '<?php return [];');
          fs.writeFileSync(
            sidecarFile(bare),
            `<?php return ['backend_path' => '${dir}', 'environment' => 'staging', 'password' => 'Sup3rS3cretPw', 'session_secret' => 'abc123secretvalue'];\n`,
          );
          const r = await call(client(bare, { boot: 'plain' }), 'GET', '/api/admin/status?token=queryTokenValue', undefined, {
            Cookie: 'jyo_php_admin_session=cookieSessionValue',
            Authorization: 'Bearer headerBearerValue',
          });
          assert.equal(r.httpStatusCode, 500);
          assert.deepEqual(json(r), configError);
          const { text, record } = await lastRecord(`${dir}/tmp/logs/api-boot.log`);
          assert.equal(record.code, 'BACKEND_INCOMPLETE');
          assert.deepEqual(record.missing_files, ['auth/Auth.php', 'generator/SiteGenerator.php']);
          assert.equal(record.request.path, '/api/admin/status', 'the query string is never logged');
          for (const secret of ['Sup3rS3cretPw', 'abc123secretvalue', 'queryTokenValue', 'cookieSessionValue', 'headerBearerValue']) {
            assert.ok(!text.includes(secret), `boot log leaked ${secret}`);
          }
        } finally {
          fs.rmSync(sidecarFile(bare), { force: true });
        }
      });

      it('falls back to a private folder next to a missing backend directory', async () => {
        try {
          writeSidecar(bare, '/bare/not-created-yet');
          const r = await statusOf(bare);
          assert.equal(r.httpStatusCode, 500);
          const { record } = await lastRecord('/bare/jyocancook-boot-logs/api-boot.log');
          assert.equal(record.code, 'BACKEND_DIR_MISSING');
          assert.equal(record.parent_dir_exists, true);
        } finally {
          fs.rmSync(sidecarFile(bare), { force: true });
        }
      });

      it('keeps the generic response for an unusable api/config.local.php and logs an invalid environment', async () => {
        try {
          for (const broken of ['<?php // forgot to return the array\n$cfg = [];\n', '<?php return [ "backend_path" => ;\n']) {
            fs.writeFileSync(sidecarFile(bare), broken);
            const r = await statusOf(bare);
            assert.equal(r.httpStatusCode, 500);
            assert.deepEqual(json(r), configError);
          }
          writeSidecar(bare, '/bare/boot-log-backend', 'development');
          const r = await statusOf(bare);
          assert.deepEqual(json(r), configError);
          const { record } = await lastRecord('/bare/boot-log-backend/tmp/logs/api-boot.log');
          assert.equal(record.code, 'GATEWAY_ENVIRONMENT_INVALID');
        } finally {
          fs.rmSync(sidecarFile(bare), { force: true });
        }
      });

      it('records a backend/gateway environment mismatch with a hint about backend config.local.php', async () => {
        try {
          writeSidecar(main, '/main/backend-staging', 'production');
          const r = await statusOf(main, 'sqlite');
          assert.equal(r.httpStatusCode, 500);
          assert.deepEqual(json(r), configError);
          const { text, record } = await lastRecord('/main/backend-staging/tmp/logs/api-boot.log');
          assert.equal(record.code, 'BACKEND_ENVIRONMENT_MISMATCH');
          assert.equal(record.gateway_environment, 'production');
          assert.equal(record.backend_environment, 'staging');
          assert.equal(record.backend_config_local_present, true);
          assert.ok(!text.includes('test-only-secret'), 'the backend session secret is never logged');
        } finally {
          fs.writeFileSync(sidecarFile(main), sidecarPhp(main.mount));
        }
      });

      it('never creates a log inside a web-served directory', async () => {
        try {
          for (const decoy of ['/bare/public_html/backend', '/bare/public_html/staging/backend']) {
            writeSidecar(bare, decoy);
            const r = await statusOf(bare);
            assert.equal(r.httpStatusCode, 500, decoy);
          }
          for (const rel of ['public_html/backend/tmp', 'public_html/staging/backend/tmp', 'public_html/jyocancook-boot-logs', 'public_html/staging/jyocancook-boot-logs']) {
            assert.ok(!fs.existsSync(path.join(bare.dir, rel)), `${rel} must not be created`);
          }
        } finally {
          fs.rmSync(sidecarFile(bare), { force: true });
        }
      });
    });


    it('can take the backend path from server settings, which override api/config.local.php', async () => {
      try {
        writeSidecar(main, '/main/does-not-exist');
        const broken = await statusOf(main, 'sqlite');
        assert.equal(broken.httpStatusCode, 500, 'precondition: the sidecar alone is broken');
        const ok = await statusOf(main, 'env', { 'X-Test-Backend': '/main/backend-staging', 'X-Test-Env': 'staging' });
        assert.equal(ok.httpStatusCode, 401, ok.text);
        const noEnv = await statusOf(main, 'env', { 'X-Test-Backend': '/main/backend-staging' });
        assert.equal(noEnv.httpStatusCode, 500, 'environment must be configured explicitly too');
        assert.deepEqual(json(noEnv), configError);
      } finally {
        fs.writeFileSync(sidecarFile(main), sidecarPhp(main.mount));
      }
    });

    it('serves api/config.local.php to nobody (server rule shipped in api/.htaccess)', () => {
      const ht = fs.readFileSync(path.join(rootDir, 'api/.htaccess'), 'utf8');
      assert.match(ht, /RewriteRule \^config\\\.local\\\.php\$ - \[F,L\]/);
      assert.match(ht, /<Files "config\.local\.php">[\s\S]*Require all denied/);
    });
  });

  // ------------------------------------------------------------ Host guard / config agreement

  describe('Staging cannot be reached through another host name', () => {
    it('answers 404 for the main domain, look-alike hosts and over plain HTTP too', async () => {
      await resetDb(main);
      for (const host of ['jyocancook.example.test', 'www.staging.example.test', `evil${STAGING_HOST}`, `${STAGING_HOST}.evil.test`]) {
        for (const https of [true, false]) {
          const c = client(main, { host, https });
          const s = await call(c, 'GET', '/api/admin/status');
          assert.equal(s.httpStatusCode, 404, `${host} https=${https}: ${s.text}`);
          assert.deepEqual(json(s), { ok: false, error: 'Not found' });
          const l = await login(c);
          assert.equal(l.httpStatusCode, 404, `${host} login: ${l.text}`);
          assert.equal(json(l).csrf_token, undefined, 'no session may start on a foreign host');
        }
      }
    });

    it('still serves the staging host name (case-insensitive)', async () => {
      await resetDb(main);
      const l = await login(client(main, { host: STAGING_HOST.toUpperCase() }));
      assert.equal(l.httpStatusCode, 200, l.text);
    });
  });

  describe('Gateway and backend must agree (PHP config)', () => {
    const cfgFile = '/cfg/backend-staging/config/config.local.php';
    const original = () => fs.readFileSync(path.join(cfg.dir, 'backend-staging/config/config.local.php'), 'utf8');
    const withConfig = async (php_: string, fn: () => Promise<void>) => {
      await php.writeFile(cfgFile, php_);
      try {
        await fn();
      } finally {
        await php.writeFile(cfgFile, original());
      }
    };
    const loadConfig = async () => JSON.parse(await phpRun(`$c = require '/cfg/backend-staging/config/config.php'; echo json_encode([$c['auth']['trusted_proxies'], $c['site']['allowed_hosts'], $c['site']['environment']]);`));

    it('refuses to start when staging has no allowed_hosts', async () => {
      await withConfig(`<?php return ['site' => ['environment' => 'staging', 'url' => 'https://${STAGING_HOST}', 'public_path' => '/cfg/public_html/staging', 'upload_path' => '/cfg/public_html/staging/images/recipes']];`, async () => {
        await resetDb(cfg);
        const r = await call(client(cfg), 'GET', '/api/admin/status');
        assert.equal(r.httpStatusCode, 500, r.text);
        assert.deepEqual(json(r), { ok: false, error: 'Server configuration error' });
      });
    });

    it('refuses to start when the backend says "production" but the gateway is staging', async () => {
      await withConfig(configLocalPhp('/cfg').replace("'environment' => 'staging'", "'environment' => 'production'"), async () => {
        const r = await call(client(cfg), 'GET', '/api/admin/status');
        assert.equal(r.httpStatusCode, 500, r.text);
        assert.deepEqual(json(r), { ok: false, error: 'Server configuration error' });
      });
    });

    it('defaults the environment to development and lower-cases allowed hosts', async () => {
      await withConfig(`<?php return ['site' => ['allowed_hosts' => [' Staging.Example.Test ', '']]];`, async () => {
        const [, hosts, env] = await loadConfig();
        assert.deepEqual(hosts, ['staging.example.test']);
        assert.equal(env, 'development');
      });
    });

    it('keeps trusted_proxies secure: invalid, "trust everyone" and very wide ranges are dropped', async () => {
      const list = ['0.0.0.0/0', '::/0', '0.0.0.0/4', '10.0.0.0/8', 'garbage', '2001:db8::/32', '2001::/8', '192.0.2.5', '', '10.0.0.0/33', '1.2.3.4/abc', '*'];
      await withConfig(`<?php return ['auth' => ['trusted_proxies' => ${JSON.stringify(list).replace(/\\\//g, '/')}]];`, async () => {
        const [proxies] = await loadConfig();
        assert.deepEqual(proxies, ['10.0.0.0/8', '2001:db8::/32', '192.0.2.5']);
      });
    });

    it('trusts no proxy by default', async () => {
      await withConfig(`<?php return [];`, async () => {
        const [proxies] = await loadConfig();
        assert.deepEqual(proxies, []);
      });
    });
  });

  // ------------------------------------------------------------ PathGuard (staging vs production isolation)

  describe('PathGuard: publish and upload targets', () => {
    const probe = async (calls: string) =>
      JSON.parse(await phpRun(`
        require_once '/cfg/backend-staging/services/PathGuard.php';
        function t(callable $f): string { try { return 'ok:' . ($f() ?? ''); } catch (Throwable $e) { return 'error:' . $e->getMessage(); } }
        ${calls}`));

    it('accepts only public_html/staging for staging and only public_html for production', async () => {
      const r = await probe(`
        $b = '/cfg/backend-staging';
        echo json_encode([
          'staging_ok'            => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => '/cfg/public_html/staging'], $b)),
          'staging_trailing'      => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => '/cfg/public_html/staging/'], $b)),
          'staging_at_prod_root'  => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => '/cfg/public_html'], $b)),
          'staging_dotdot'        => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => '/cfg/public_html/staging/..'], $b)),
          'staging_missing'       => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => '/cfg/public_html/staging-typo'], $b)),
          'staging_empty'         => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => ''], $b)),
          'prod_ok'               => t(fn() => PathGuard::assertPublishTarget(['environment' => 'production', 'public_path' => '/cfg/public_html'], $b)),
          'prod_at_staging'       => t(fn() => PathGuard::assertPublishTarget(['environment' => 'production', 'public_path' => '/cfg/public_html/staging'], $b)),
          'unknown_env'           => t(fn() => PathGuard::assertPublishTarget(['environment' => 'qa', 'public_path' => '/cfg/public_html/staging'], $b)),
          'backend_inside_target' => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => '/cfg/public_html/staging'], '/cfg/public_html/staging/api')),
          'backend_contains_it'   => t(fn() => PathGuard::assertPublishTarget(['environment' => 'staging', 'public_path' => '/cfg/public_html/staging'], '/cfg/public_html')),
          'development_free'      => t(fn() => PathGuard::assertPublishTarget(['environment' => 'development', 'public_path' => '/anywhere/dist'], $b)),
        ]);`);
      assert.equal(r.staging_ok, 'ok:/cfg/public_html/staging');
      assert.equal(r.staging_trailing, 'ok:/cfg/public_html/staging');
      assert.match(r.staging_at_prod_root, /^error:.*layout/);
      assert.match(r.staging_dotdot, /^error:.*layout/);
      assert.match(r.staging_missing, /^error:.*missing or not writable/);
      assert.match(r.staging_empty, /^error:.*missing or not writable/);
      assert.equal(r.prod_ok, 'ok:/cfg/public_html');
      assert.match(r.prod_at_staging, /^error:.*layout/);
      assert.match(r.unknown_env, /^error:.*Unknown site\.environment/);
      assert.match(r.backend_inside_target, /^error:.*must not overlap/);
      assert.match(r.backend_contains_it, /^error:.*must not overlap/);
      assert.equal(r.development_free, 'ok:/anywhere/dist');
    });

    it('keeps uploads inside the publish target of the same environment', async () => {
      const r = await probe(`
        $b = '/cfg/backend-staging';
        $s = ['environment' => 'staging', 'public_path' => '/cfg/public_html/staging'];
        echo json_encode([
          'inside'        => t(fn() => PathGuard::assertUploadDir($s, '/cfg/public_html/staging/images/recipes', $b)),
          'production'    => t(fn() => PathGuard::assertUploadDir($s, '/cfg/public_html/images/recipes', $b)),
          'dotdot'        => t(fn() => PathGuard::assertUploadDir($s, '/cfg/public_html/staging/../images/recipes', $b)),
          'backend'       => t(fn() => PathGuard::assertUploadDir($s, '/cfg/backend-staging/tmp', $b)),
          'sibling_name'  => t(fn() => PathGuard::assertUploadDir($s, '/cfg/public_html/staging-evil/images', $b)),
        ]);`);
      assert.equal(r.inside, 'ok:');
      for (const k of ['production', 'dotdot', 'backend', 'sibling_name']) assert.match(r[k], /^error:.*upload_path must be inside/, k);
    });

    it('recognises every web-exposed directory above the staging document root', async () => {
      const r = await probe(`
        echo json_encode([
          PathGuard::isPubliclyServed('/cfg/public_html/backend', ['/cfg/public_html/staging']),
          PathGuard::isPubliclyServed('/cfg/public_html/staging/backend', ['/cfg/public_html/staging']),
          PathGuard::isPubliclyServed('/cfg/backend-staging', ['/cfg/public_html/staging']),
        ]);`);
      assert.deepEqual(r, [true, true, false]);
    });
  });

  // ------------------------------------------------------------ API routing

  describe('API routing', () => {
    it('answers 404 JSON for unknown endpoints without echoing the request', async () => {
      await resetDb(main);
      const anon = client(main);
      for (const url of ['/api', '/api/', '/api/unknown', '/api/auth', '/api/auth/nope', '/api/index.php']) {
        const r = await call(anon, 'GET', url);
        assert.equal(r.httpStatusCode, 404, `${url}: ${r.text}`);
        assert.deepEqual(json(r), { error: 'Endpoint not found' });
      }
    });

    it('only accepts POST for login (a GET with credentials in the URL is not a login)', async () => {
      await resetDb(main);
      const r = await call(client(main), 'GET', `/api/auth/login?username=${ADMIN_USER}&password=x`);
      assert.equal(r.httpStatusCode, 404);
      assert.equal(json(r).csrf_token, undefined);
    });

    it('protects every /api/admin route with the session before routing', async () => {
      await resetDb(main);
      const anon = client(main);
      for (const [method, url] of [['GET', '/api/admin/recipes'], ['GET', '/api/admin/categories'], ['GET', '/api/admin/nonexistent'], ['PUT', '/api/admin/recipes/x'], ['PATCH', '/api/admin/menu']]) {
        const r = await call(anon, method, url);
        assert.equal(r.httpStatusCode, 401, `${method} ${url}: ${r.text}`);
      }
    });

    it('treats unknown methods on known routes as state-changing (CSRF) and then 404', async () => {
      await resetDb(main);
      const { c, csrf } = await authed(main);
      assert.equal((await call(c, 'PUT', '/api/admin/menu', { data: [] })).httpStatusCode, 403);
      assert.equal((await call(c, 'PUT', '/api/admin/menu', { data: [] }, { 'X-CSRF-Token': csrf })).httpStatusCode, 404);
      assert.equal((await call(c, 'GET', '/api/admin/nonexistent')).httpStatusCode, 404);
    });

    it('rejects publishing through GET', async () => {
      await resetDb(main);
      const { c } = await authed(main);
      assert.equal((await call(c, 'GET', '/api/admin/publish')).httpStatusCode, 404);
    });
  });
});

