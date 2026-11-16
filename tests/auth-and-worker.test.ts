import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  configured,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  createCookieHeader,
  clearCookieHeader,
  type Env,
  type Fetcher,
} from '../worker/index.ts';

const mockAssets: Fetcher = {
  async fetch(input: RequestInfo | URL) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new Response(`Asset content for ${url}`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  },
};

const baseEnv: Env = {
  ASSETS: mockAssets,
  GITHUB_OWNER: 'jyocancook-dev',
  GITHUB_REPO: 'jyocancook',
  GITHUB_BRANCH: 'main',
  GITHUB_OAUTH_CLIENT_ID: 'gh_client_12345',
  ALLOWED_GITHUB_USER_ID: '987654321',
  GITHUB_OAUTH_CLIENT_SECRET: 'gh_secret_abcdef',
  GITHUB_CONTENT_TOKEN: 'ghp_content_token_xyz',
  SESSION_SECRET: 'super-secret-session-key-at-least-32-chars-long!',
};

describe('JyoCanCook Worker Authentication & Authorization', () => {
  describe('Configuration Validation', () => {
    it('should return true when all required variables and secrets are configured', () => {
      assert.strictEqual(configured(baseEnv), true);
    });

    it('should return false if GITHUB_OAUTH_CLIENT_ID is missing or contains REPLACE', () => {
      const env = { ...baseEnv, GITHUB_OAUTH_CLIENT_ID: 'REPLACE_WITH_CLIENT_ID' };
      assert.strictEqual(configured(env), false);
    });

    it('should return false if ALLOWED_GITHUB_USER_ID is missing or contains REPLACE', () => {
      const env = { ...baseEnv, ALLOWED_GITHUB_USER_ID: 'REPLACE_WITH_USER_ID' };
      assert.strictEqual(configured(env), false);
    });

    it('should return false if GITHUB_OAUTH_CLIENT_SECRET is missing', () => {
      const env = { ...baseEnv };
      delete env.GITHUB_OAUTH_CLIENT_SECRET;
      assert.strictEqual(configured(env), false);
    });

    it('should return false if GITHUB_CONTENT_TOKEN and GITHUB_TOKEN are missing', () => {
      const env = { ...baseEnv };
      delete env.GITHUB_CONTENT_TOKEN;
      delete env.GITHUB_TOKEN;
      assert.strictEqual(configured(env), false);
    });

    it('should return false if SESSION_SECRET is missing', () => {
      const env = { ...baseEnv };
      delete env.SESSION_SECRET;
      assert.strictEqual(configured(env), false);
    });
  });

  describe('JWT Session Tokens', () => {
    it('should create and verify valid session token for allowed numeric user ID', async () => {
      const token = await createSessionToken(
        { id: '987654321', login: 'jyocancook-author', name: 'Jyo Can Cook' },
        baseEnv.SESSION_SECRET!
      );
      assert.ok(token && typeof token === 'string');

      const verified = await verifySessionToken(token, baseEnv.SESSION_SECRET!, '987654321');
      assert.ok(verified);
      assert.strictEqual(verified.userId, '987654321');
      assert.strictEqual(verified.login, 'jyocancook-author');
      assert.strictEqual(verified.name, 'Jyo Can Cook');
    });

    it('should reject session token if verified against a different user ID', async () => {
      const token = await createSessionToken(
        { id: '987654321', login: 'jyocancook-author', name: 'Jyo Can Cook' },
        baseEnv.SESSION_SECRET!
      );

      const verified = await verifySessionToken(token, baseEnv.SESSION_SECRET!, '111222333');
      assert.strictEqual(verified, null);
    });

    it('should reject session token signed with wrong secret', async () => {
      const token = await createSessionToken(
        { id: '987654321', login: 'jyocancook-author', name: 'Jyo Can Cook' },
        'different-secret-key-at-least-32-chars!'
      );

      const verified = await verifySessionToken(token, baseEnv.SESSION_SECRET!, '987654321');
      assert.strictEqual(verified, null);
    });

    it('should reject expired session token', async () => {
      const token = await createSessionToken(
        { id: '987654321', login: 'jyocancook-author' },
        baseEnv.SESSION_SECRET!,
        -10 // expired 10 seconds ago
      );

      const verified = await verifySessionToken(token, baseEnv.SESSION_SECRET!, '987654321');
      assert.strictEqual(verified, null);
    });
  });

  describe('Cookie Utilities', () => {
    it('should parse cookie headers correctly', () => {
      const cookies = parseCookies('jyo_admin_session=abc123token; jyo_oauth_state=state_xyz; other=val');
      assert.strictEqual(cookies['jyo_admin_session'], 'abc123token');
      assert.strictEqual(cookies['jyo_oauth_state'], 'state_xyz');
      assert.strictEqual(cookies['other'], 'val');
    });

    it('should generate secure HttpOnly SameSite cookie headers', () => {
      const header = createCookieHeader('test_cookie', 'test_val', {
        maxAge: 3600,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      });
      assert.ok(header.includes('test_cookie=test_val'));
      assert.ok(header.includes('Max-Age=3600'));
      assert.ok(header.includes('Path=/'));
      assert.ok(header.includes('HttpOnly'));
      assert.ok(header.includes('Secure'));
      assert.ok(header.includes('SameSite=Lax'));
    });

    it('should generate clear cookie header with Max-Age=0', () => {
      const clear = clearCookieHeader('test_cookie', '/');
      assert.ok(clear.includes('test_cookie='));
      assert.ok(clear.includes('Max-Age=0'));
      assert.ok(clear.includes('HttpOnly'));
      assert.ok(clear.includes('Secure'));
    });
  });

  describe('Worker Request Handling & Route Protection', () => {
    it('should allow public visitor pages without authentication', async () => {
      const req = new Request('https://jyocancook.com/');
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('Asset content'));
    });

    it('should return 503 if worker is unconfigured when accessing /admin', async () => {
      const unconfiguredEnv = { ...baseEnv, GITHUB_OAUTH_CLIENT_ID: 'REPLACE_ME' };
      const req = new Request('https://jyocancook.com/admin/');
      const res = await worker.fetch(req, unconfiguredEnv);
      assert.strictEqual(res.status, 503);
      const json = await res.json();
      assert.ok(json.error.includes('Admin authentication is not configured'));
    });

    it('should redirect unauthenticated browser request for /admin to /api/auth/login', async () => {
      const req = new Request('https://jyocancook.com/admin/');
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('Location'), '/api/auth/login');
    });

    it('should redirect unauthenticated browser request for /admin/recipes to /api/auth/login', async () => {
      const req = new Request('https://jyocancook.com/admin/recipes');
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('Location'), '/api/auth/login');
    });

    it('should reject unauthenticated API request to /api/admin/status with 401', async () => {
      const req = new Request('https://jyocancook.com/api/admin/status');
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.includes('Not authenticated'));
    });

    it('should reject unauthenticated API write to /api/admin/recipes with 401', async () => {
      const req = new Request('https://jyocancook.com/api/admin/recipes/andhra-chicken-curry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipe: { title: 'Hacked Recipe' } }),
      });
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.includes('Not authenticated'));
    });

    it('should handle /api/auth/login by setting CSRF cookie and redirecting to GitHub OAuth', async () => {
      const req = new Request('https://jyocancook.com/api/auth/login');
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 302);
      const location = res.headers.get('Location') || '';
      assert.ok(location.startsWith('https://github.com/login/oauth/authorize'));
      assert.ok(location.includes(`client_id=${baseEnv.GITHUB_OAUTH_CLIENT_ID}`));
      assert.ok(location.includes('redirect_uri=https%3A%2F%2Fjyocancook.com%2Fapi%2Fauth%2Fcallback'));
      assert.ok(location.includes('state='));

      const setCookie = res.headers.get('Set-Cookie') || '';
      assert.ok(setCookie.includes('jyo_oauth_state='));
      assert.ok(setCookie.includes('HttpOnly'));
      assert.ok(setCookie.includes('Path=/api/auth'));
    });

    it('should reject /api/auth/callback if CSRF state does not match', async () => {
      const req = new Request('https://jyocancook.com/api/auth/callback?code=mock_code&state=attack_state', {
        headers: {
          Cookie: 'jyo_oauth_state=legitimate_state',
        },
      });
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.ok(data.error.includes('CSRF state mismatch'));
    });

    it('should reject /api/auth/callback if GitHub user ID is not authorized', async () => {
      // Mock global fetch for GitHub OAuth and User endpoints
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          if (urlStr.includes('github.com/login/oauth/access_token')) {
            return new Response(JSON.stringify({ access_token: 'gho_mock_access_token_123' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (urlStr.includes('api.github.com/user')) {
            return new Response(
              JSON.stringify({
                id: 123456, // Unauthorized numeric ID!
                login: 'unauthorized-user',
                name: 'Unauthorized User',
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          return originalFetch(input, init);
        };

        const state = 'valid_oauth_state_123';
        const req = new Request(`https://jyocancook.com/api/auth/callback?code=good_code&state=${state}`, {
          headers: {
            Cookie: `jyo_oauth_state=${state}`,
          },
        });

        const res = await worker.fetch(req, baseEnv);
        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.ok(data.error.includes('Forbidden: GitHub User ID 123456'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should complete /api/auth/callback for authorized numeric user ID and set session cookie', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          if (urlStr.includes('github.com/login/oauth/access_token')) {
            return new Response(JSON.stringify({ access_token: 'gho_mock_access_token_123' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (urlStr.includes('api.github.com/user')) {
            return new Response(
              JSON.stringify({
                id: 987654321, // Matches ALLOWED_GITHUB_USER_ID!
                login: 'jyocancook-owner',
                name: 'Jyothsna Sirasanameti',
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          return originalFetch(input, init);
        };

        const state = 'valid_oauth_state_456';
        const req = new Request(`https://jyocancook.com/api/auth/callback?code=good_code&state=${state}`, {
          headers: {
            Cookie: `jyo_oauth_state=${state}`,
          },
        });

        const res = await worker.fetch(req, baseEnv);
        assert.strictEqual(res.status, 302);
        assert.strictEqual(res.headers.get('Location'), '/admin/');

        const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie') || ''];
        const sessionCookie = setCookies.find((c) => c.includes('jyo_admin_session='));
        assert.ok(sessionCookie, 'Session cookie must be set');
        assert.ok(sessionCookie.includes('HttpOnly'));
        assert.ok(sessionCookie.includes('Secure'));
        assert.ok(sessionCookie.includes('SameSite=Lax'));

        const clearStateCookie = setCookies.find((c) => c.includes('jyo_oauth_state='));
        assert.ok(clearStateCookie, 'State cookie must be cleared');
        assert.ok(clearStateCookie.includes('Max-Age=0'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should serve /admin and set no-store headers when authenticated', async () => {
      const sessionToken = await createSessionToken(
        { id: '987654321', login: 'jyocancook-owner', name: 'Jyo' },
        baseEnv.SESSION_SECRET!
      );

      const req = new Request('https://jyocancook.com/admin/', {
        headers: {
          Cookie: `jyo_admin_session=${sessionToken}`,
        },
      });

      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('cache-control'), 'no-store');
      assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow');
      const text = await res.text();
      assert.ok(text.includes('Asset content'));
    });

    it('should return user status on /api/admin/status when authenticated', async () => {
      const sessionToken = await createSessionToken(
        { id: '987654321', login: 'jyocancook-owner', name: 'Jyothsna' },
        baseEnv.SESSION_SECRET!
      );

      const req = new Request('https://jyocancook.com/api/admin/status', {
        headers: {
          Cookie: `jyo_admin_session=${sessionToken}`,
        },
      });

      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.user.id, '987654321');
      assert.strictEqual(data.user.login, 'jyocancook-owner');
      assert.strictEqual(data.user.name, 'Jyothsna');
    });

    it('should reject cross-site mutations with 403 Invalid origin', async () => {
      const sessionToken = await createSessionToken(
        { id: '987654321', login: 'jyocancook-owner' },
        baseEnv.SESSION_SECRET!
      );

      const req = new Request('https://jyocancook.com/api/admin/recipes/andhra-chicken-curry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://malicious-cross-origin.com',
          Cookie: `jyo_admin_session=${sessionToken}`,
        },
        body: JSON.stringify({ recipe: { title: 'Cross Site Recipe' } }),
      });

      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.error, 'Invalid origin');
    });

    it('should reject non-JSON mutations with 415 Unsupported Media Type', async () => {
      const sessionToken = await createSessionToken(
        { id: '987654321', login: 'jyocancook-owner' },
        baseEnv.SESSION_SECRET!
      );

      const req = new Request('https://jyocancook.com/api/admin/categories', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          Origin: 'https://jyocancook.com',
          Cookie: `jyo_admin_session=${sessionToken}`,
        },
        body: 'raw text payload',
      });

      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 415);
      const data = await res.json();
      assert.strictEqual(data.error, 'Content type must be application/json');
    });

    it('should reject unsupported HTTP methods on admin API with 405 Method Not Allowed', async () => {
      const sessionToken = await createSessionToken(
        { id: '987654321', login: 'jyocancook-owner' },
        baseEnv.SESSION_SECRET!
      );

      const req = new Request('https://jyocancook.com/api/admin/status', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          Cookie: `jyo_admin_session=${sessionToken}`,
        },
        body: JSON.stringify({}),
      });

      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 405);
      const data = await res.json();
      assert.strictEqual(data.error, 'Method not allowed');
    });

    it('should clear cookies and redirect on /api/auth/logout', async () => {
      const req = new Request('https://jyocancook.com/api/auth/logout');
      const res = await worker.fetch(req, baseEnv);
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('Location'), '/');

      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie') || ''];
      const sessionClear = setCookies.find((c) => c.includes('jyo_admin_session='));
      assert.ok(sessionClear && sessionClear.includes('Max-Age=0'));
    });
  });
});
