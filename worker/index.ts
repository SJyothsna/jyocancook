import { SignJWT, jwtVerify } from 'jose';

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  ALLOWED_GITHUB_USER_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  GITHUB_CONTENT_TOKEN?: string;
  GITHUB_TOKEN?: string; // fallback
  SESSION_SECRET?: string;
}

export interface SessionUser {
  userId: string;
  login: string;
  name: string;
}

const SESSION_COOKIE_NAME = 'jyo_admin_session';
const OAUTH_STATE_COOKIE_NAME = 'jyo_oauth_state';
const SESSION_MAX_AGE_SECONDS = 8 * 3600; // 8 hours
const OAUTH_STATE_MAX_AGE_SECONDS = 600; // 10 minutes

export const json = (data: any, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json;charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });

export const invalid = (message: string, status = 400, headers: HeadersInit = {}) =>
  json({ error: message }, status, headers);

export function configured(env: Env): boolean {
  const contentToken = env.GITHUB_CONTENT_TOKEN || env.GITHUB_TOKEN;
  return !!(
    contentToken &&
    env.GITHUB_OWNER &&
    !env.GITHUB_OWNER.startsWith('REPLACE') &&
    env.GITHUB_REPO &&
    !env.GITHUB_REPO.startsWith('REPLACE') &&
    env.GITHUB_OAUTH_CLIENT_ID &&
    !env.GITHUB_OAUTH_CLIENT_ID.startsWith('REPLACE') &&
    env.ALLOWED_GITHUB_USER_ID &&
    !env.ALLOWED_GITHUB_USER_ID.startsWith('REPLACE') &&
    env.GITHUB_OAUTH_CLIENT_SECRET &&
    env.SESSION_SECRET
  );
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export function createCookieHeader(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

export function clearCookieHeader(name: string, path = '/'): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function generateState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionToken(
  user: { id: number | string; login: string; name?: string },
  secret: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  return await new SignJWT({
    sub: String(user.id),
    login: user.login,
    name: user.name || user.login,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secretKey);
}

export async function verifySessionToken(
  token: string,
  secret: string,
  allowedUserId: string
): Promise<SessionUser | null> {
  if (!token || !secret || !allowedUserId) return null;
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    const sub = String(payload.sub || '').trim();
    const expected = String(allowedUserId).trim();
    if (!sub || sub !== expected) {
      return null;
    }
    return {
      userId: sub,
      login: String(payload.login || ''),
      name: String(payload.name || payload.login || ''),
    };
  } catch {
    return null;
  }
}

export async function getSession(req: Request, env: Env): Promise<SessionUser | null> {
  if (!env.SESSION_SECRET || !env.ALLOWED_GITHUB_USER_ID) return null;
  const cookies = parseCookies(req.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token, env.SESSION_SECRET, env.ALLOWED_GITHUB_USER_ID);
}

export async function github(env: Env, path: string, options: RequestInit = {}): Promise<any> {
  const token = env.GITHUB_CONTENT_TOKEN || env.GITHUB_TOKEN;
  const url = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(
    env.GITHUB_REPO
  )}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'JyoCanCook-Admin',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let message = 'GitHub API error';
    try {
      message = ((await res.json()) as any).message || message;
    } catch {}
    throw new Error(`${message} (${res.status})`);
  }
  return res.json();
}

export function decode(input: string): string {
  const binary = atob(input.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return btoa(out);
}

export async function readFile(env: Env, path: string): Promise<{ sha: string; content: string }> {
  const d = await github(env, `contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`);
  return { sha: d.sha, content: decode(d.content) };
}

export async function saveFile(env: Env, path: string, body: string, sha?: string): Promise<any> {
  return github(env, `contents/${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `content: update ${path}`,
      content: encode(body),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function deleteFile(env: Env, path: string, sha: string): Promise<any> {
  return github(env, `contents/${path}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `content: delete ${path}`,
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

export function safeLink(s: string): boolean {
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') && !/[<>'"\n\r]/.test(s);
}

export function validUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeRecipe(r: any) {
  if (!r || typeof r !== 'object') throw Error('Missing recipe');
  const title = String(r.title || '').trim();
  const id = slug(String(r.slug || title));
  if (!title || title.length > 140 || !id) throw Error('Valid recipe title and slug required');
  if (!Array.isArray(r.ingredients) || !Array.isArray(r.steps) || !r.ingredients.length || !r.steps.length) {
    throw Error('At least one ingredient and step are required');
  }
  const img = String(r.image || '/images/recipes/recipe-placeholder.svg');
  if (!safeLink(img) && !validUrl(img)) throw Error('Invalid image URL');
  const steps = r.steps.slice(0, 80).map((s: any) => ({
    title: String(s.title || '').slice(0, 180),
    text: String(s.text || '').slice(0, 4000),
    ...(s.image && safeLink(String(s.image)) ? { image: s.image } : {}),
  }));
  const ingredients = r.ingredients.slice(0, 120).map((i: any) => ({
    amount: i.amount === null || i.amount === '' ? null : Number(i.amount),
    unit: String(i.unit || '').slice(0, 25),
    name: String(i.name || '').slice(0, 180),
    ...(i.section ? { section: String(i.section).slice(0, 100)} : {}),
  }));
  if (ingredients.some((i: any) => i.amount !== null && (!Number.isFinite(i.amount) || i.amount < 0))) {
    throw Error('Invalid ingredient quantity');
  }
  const nut = r.nutrition && typeof r.nutrition === 'object' ? {
    ...(r.nutrition.calories !== undefined && r.nutrition.calories !== '' && !isNaN(Number(r.nutrition.calories)) ? { calories: Math.max(0, Math.min(100000, Math.round(Number(r.nutrition.calories)))) } : {}),
    ...(r.nutrition.carbs !== undefined && r.nutrition.carbs !== '' && !isNaN(Number(r.nutrition.carbs)) ? { carbs: Math.max(0, Math.min(10000, Number(Number(r.nutrition.carbs).toFixed(1)))) } : {}),
    ...(r.nutrition.protein !== undefined && r.nutrition.protein !== '' && !isNaN(Number(r.nutrition.protein)) ? { protein: Math.max(0, Math.min(10000, Number(Number(r.nutrition.protein).toFixed(1)))) } : {}),
    ...(r.nutrition.fat !== undefined && r.nutrition.fat !== '' && !isNaN(Number(r.nutrition.fat)) ? { fat: Math.max(0, Math.min(10000, Number(Number(r.nutrition.fat).toFixed(1)))) } : {}),
    ...(r.nutrition.fiber !== undefined && r.nutrition.fiber !== '' && !isNaN(Number(r.nutrition.fiber)) ? { fiber: Math.max(0, Math.min(10000, Number(Number(r.nutrition.fiber).toFixed(1)))) } : {}),
  } : undefined;
  const nutrition = nut && Object.keys(nut).length > 0 ? nut : undefined;

  return {
    slug: id,
    title,
    description: String(r.description || '').slice(0, 1000),
    category: slug(String(r.category || '')),
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 30).map((t: any) => String(t).slice(0, 60)) : [],
    diet: String(r.diet || 'Vegetarian').slice(0, 40),
    prepTime: Math.max(0, Math.min(10000, Number(r.prepTime) || 0)),
    cookTime: Math.max(0, Math.min(10000, Number(r.cookTime) || 0)),
    servings: Math.max(1, Math.min(100, Number(r.servings) || 4)),
    difficulty: String(r.difficulty || 'Easy').slice(0, 40),
    image: img,
    published: r.published === true,
    featured: r.featured === true,
    ...(r.story ? { story: String(r.story).slice(0, 10000) } : {}),
    ingredients,
    steps,
    tips: Array.isArray(r.tips) ? r.tips.slice(0, 30).map(String) : [],
    serveWith: Array.isArray(r.serveWith) ? r.serveWith.slice(0, 30).map(String) : [],
    ...(r.youtubeUrl && validUrl(String(r.youtubeUrl)) ? { youtubeUrl: r.youtubeUrl } : {}),
    ...(nutrition ? { nutrition } : {}),
  };
}

export function sanitizeConfig(type: string, data: any) {
  if (!Array.isArray(data) || data.length > 200) throw Error('Expected a list (maximum 200 entries)');
  if (type === 'categories') {
    const result = data.map((x: any) => ({
      slug: slug(String(x.slug || x.name || '')),
      name: String(x.name || '').slice(0, 80),
      description: String(x.description || '').slice(0, 300),
      image: String(
        x.image || x.emoji || '/images/categories/' + slug(String(x.slug || x.name || '')) + '.svg'
      ).slice(0, 300),
      order: Number(x.order) || 0,
    }));
    if (result.some((x: any) => !x.slug || !x.name)) throw Error('Category name and slug required');
    if (new Set(result.map((x: any) => x.slug)).size !== result.length) throw Error('Duplicate category slug');
    return result;
  }
  if (type === 'tags') return [...new Set(data.map((x: any) => String(x).trim().slice(0, 60)).filter(Boolean))];
  if (type === 'menu') {
    const result = data.map((x: any) => ({
      label: String(x.label || '').slice(0, 70),
      href: String(x.href || ''),
      order: Number(x.order) || 0,
      visible: x.visible !== false,
    }));
    if (result.some((x: any) => !x.label || !safeLink(x.href))) {
      throw Error('Menu links must be internal paths starting with /');
    }
    return result;
  }
  throw Error('Unsupported type');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    const isAuthRoute = path === '/api/auth/login' || path === '/api/auth/callback' || path === '/api/auth/logout';
    const isAdminPage = path === '/admin' || path.startsWith('/admin/');
    const isAdminApi = path.startsWith('/api/admin/');

    // Public visitor pages are served directly
    if (!isAuthRoute && !isAdminPage && !isAdminApi) {
      return env.ASSETS.fetch(req);
    }

    // Check worker configuration for admin and auth operations
    if (!configured(env)) {
      return invalid(
        'Admin authentication is not configured. Configure GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, ALLOWED_GITHUB_USER_ID, GITHUB_CONTENT_TOKEN, and SESSION_SECRET as described in docs/ADMIN_SETUP.md.',
        503
      );
    }

    // --------------------------------------------------------------------------
    // 1. GitHub OAuth Authentication Endpoints
    // --------------------------------------------------------------------------

    if (path === '/api/auth/login') {
      const state = generateState();
      const callbackUrl = new URL('/api/auth/callback', req.url).toString();
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
        env.GITHUB_OAUTH_CLIENT_ID
      )}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}&scope=read:user`;

      const headers = new Headers({
        Location: authUrl,
        'Cache-Control': 'no-store',
      });
      headers.append(
        'Set-Cookie',
        createCookieHeader(OAUTH_STATE_COOKIE_NAME, state, {
          maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
          path: '/api/auth',
          sameSite: 'Lax',
        })
      );
      return new Response(null, { status: 302, headers });
    }

    if (path === '/api/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      if (error) {
        return invalid(`GitHub OAuth error: ${errorDescription || error}`, 400);
      }
      if (!code || !state) {
        return invalid('Missing authorization code or state parameter.', 400);
      }

      const cookies = parseCookies(req.headers.get('cookie'));
      const savedState = cookies[OAUTH_STATE_COOKIE_NAME];
      if (!savedState || savedState !== state) {
        return invalid('CSRF state mismatch or login request expired. Please try logging in again.', 403);
      }

      // Exchange authorization code for GitHub access token
      const callbackUrl = new URL('/api/auth/callback', req.url).toString();
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'JyoCanCook-Admin',
        },
        body: JSON.stringify({
          client_id: env.GITHUB_OAUTH_CLIENT_ID,
          client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
          code,
          redirect_uri: callbackUrl,
        }),
      });

      if (!tokenRes.ok) {
        return invalid(`Failed to exchange OAuth code with GitHub (${tokenRes.status}).`, 400);
      }

      const tokenData = (await tokenRes.json()) as any;
      if (tokenData.error) {
        return invalid(`GitHub OAuth token error: ${tokenData.error_description || tokenData.error}`, 400);
      }

      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return invalid('No access token returned by GitHub OAuth.', 400);
      }

      // Fetch authenticated GitHub user profile
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'JyoCanCook-Admin',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!userRes.ok) {
        return invalid(`Failed to fetch GitHub user profile (${userRes.status}).`, 400);
      }

      const user = (await userRes.json()) as any;
      const numericUserId = String(user.id || '').trim();
      const allowedUserId = String(env.ALLOWED_GITHUB_USER_ID || '').trim();

      // Server-side verification of authorised GitHub numeric user ID
      if (!numericUserId || numericUserId !== allowedUserId) {
        return invalid(
          `Forbidden: GitHub User ID ${numericUserId} (@${user.login || 'unknown'}) is not authorised to access JyoCanCook admin.`,
          403
        );
      }

      // Create signed session token
      const sessionToken = await createSessionToken(
        { id: numericUserId, login: String(user.login || ''), name: String(user.name || user.login || '') },
        env.SESSION_SECRET!
      );

      const headers = new Headers({
        Location: '/admin/',
        'Cache-Control': 'no-store',
      });
      headers.append(
        'Set-Cookie',
        createCookieHeader(SESSION_COOKIE_NAME, sessionToken, {
          maxAge: SESSION_MAX_AGE_SECONDS,
          path: '/',
          sameSite: 'Lax',
        })
      );
      headers.append('Set-Cookie', clearCookieHeader(OAUTH_STATE_COOKIE_NAME, '/api/auth'));
      return new Response(null, { status: 302, headers });
    }

    if (path === '/api/auth/logout') {
      const headers = new Headers({
        Location: '/',
        'Cache-Control': 'no-store',
      });
      headers.append('Set-Cookie', clearCookieHeader(SESSION_COOKIE_NAME, '/'));
      headers.append('Set-Cookie', clearCookieHeader(OAUTH_STATE_COOKIE_NAME, '/api/auth'));
      return new Response(null, { status: 302, headers });
    }

    // --------------------------------------------------------------------------
    // 2. Protect /admin, /admin/* and /api/admin/*
    // --------------------------------------------------------------------------

    const session = await getSession(req, env);

    // If unauthenticated browser request for admin UI, redirect to login
    if (isAdminPage) {
      if (!session) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/api/auth/login',
            'Cache-Control': 'no-store',
          },
        });
      }
      const response = await env.ASSETS.fetch(req);
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      headers.set('x-robots-tag', 'noindex, nofollow');
      return new Response(response.body, { status: response.status, headers });
    }

    // If unauthenticated API request, reject with 401 Unauthorized
    if (!session) {
      return invalid('Not authenticated. Please log in via GitHub OAuth.', 401);
    }

    // --------------------------------------------------------------------------
    // 3. Admin API Endpoints (/api/admin/*)
    // --------------------------------------------------------------------------

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
      return invalid('Method not allowed', 405);
    }
    if (req.method !== 'GET' && !req.headers.get('content-type')?.includes('application/json')) {
      return invalid('Content type must be application/json', 415);
    }
    if (req.method !== 'GET') {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) {
        return invalid('Invalid origin', 403);
      }
    }

    try {
      const segment = path.split('/').filter(Boolean);
      const type = segment[2] || '';

      if (type === 'status' && req.method === 'GET') {
        return json({
          ok: true,
          user: {
            id: session.userId,
            login: session.login,
            name: session.name,
          },
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPO,
          branch: env.GITHUB_BRANCH,
        });
      }

      if (['categories', 'menu', 'tags'].includes(type)) {
        const file = `config/${type}.json`;
        if (req.method === 'GET') {
          const obj = await readFile(env, file);
          return json({ data: JSON.parse(obj.content), sha: obj.sha });
        }
        if (req.method === 'POST') {
          const body = (await req.json()) as any;
          const current = await readFile(env, file);
          if (body.sha !== current.sha) return invalid('Content changed; reload before saving.', 409);
          const validated = sanitizeConfig(type, body.data);
          await saveFile(env, file, JSON.stringify(validated, null, 2) + '\n', current.sha);
          return json({ ok: true });
        }
      }

      if (type === 'recipes') {
        if (segment.length === 3 && req.method === 'GET') {
          const files = (await github(
            env,
            `contents/src/content/recipes?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`
          )) as any[];
          const items = await Promise.all(
            files
              .filter((f) => f.name.endsWith('.json'))
              .map(async (f) => {
                const item = await readFile(env, f.path);
                return { ...JSON.parse(item.content), _sha: item.sha };
              })
          );
          return json({ data: items });
        }
        if (segment.length === 4) {
          const recipeSlug = slug(segment[3]);
          const file = `src/content/recipes/${recipeSlug}.json`;
          if (req.method === 'GET') {
            const item = await readFile(env, file);
            return json({ recipe: JSON.parse(item.content), sha: item.sha });
          }
          if (req.method === 'POST') {
            const body = (await req.json()) as any;
            const validated = sanitizeRecipe(body.recipe);
            await saveFile(env, file, JSON.stringify(validated, null, 2) + '\n', body.sha);
            return json({ ok: true, slug: validated.slug });
          }
          if (req.method === 'DELETE') {
            const body = (await req.json()) as any;
            if (!body.sha) return invalid('Missing file sha', 400);
            await deleteFile(env, file, body.sha);
            return json({ ok: true });
          }
        }
      }

      if (type === 'image' && req.method === 'POST') {
        const body = (await req.json()) as any;
        const name =
          slug(String(body.name || 'image').replace(/\.[^.]+$/, '')) +
          '-' +
          Date.now().toString(36) +
          '.' +
          (body.name?.split('.').pop()?.toLowerCase() || 'jpg');
        const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'svg'];
        const ext = name.split('.').pop() || '';
        if (!allowedExts.includes(ext)) {
          return invalid('Unsupported image format (use JPG, PNG, WebP or SVG)', 400);
        }
        const dataUrl = String(body.content || '');
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        if (!base64 || base64.length > 6 * 1024 * 1024) {
          return invalid('Invalid or oversized image payload', 400);
        }
        const filePath = `public/images/recipes/${name}`;
        await github(env, `contents/${filePath}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: `content: upload image ${name}`,
            content: base64,
            branch: env.GITHUB_BRANCH,
          }),
        });
        return json({ ok: true, path: `/images/recipes/${name}` });
      }

      return invalid('Not found', 404);
    } catch (err: any) {
      return invalid(err?.message || 'Server error', 500);
    }
  },
};
