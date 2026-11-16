# Secure Admin Setup — GitHub OAuth & Worker Configuration

The admin interface is at `https://jyocancook.com/admin/`. It is built into the same repository, with administrative authentication and write operations securely handled on the server side by the Cloudflare Worker (`worker/index.ts`) using GitHub OAuth.

---

## 1. Create a GitHub OAuth Application

1. Go to **GitHub** → **Settings** → **Developer Settings** → **OAuth Apps** → **New OAuth App**.
2. Fill in the application details:
   - **Application name**: `JyoCanCook Admin`
   - **Homepage URL**: `https://jyocancook.com`
   - **Authorization callback URL**: `https://jyocancook.com/api/auth/callback`
3. Click **Register application**.
4. Note your **Client ID** (used as `GITHUB_OAUTH_CLIENT_ID` in `wrangler.jsonc`).
5. Click **Generate a new client secret** and copy it immediately.

---

## 2. Find Your Numeric GitHub User ID

The Worker verifies authorization server-side using your immutable numeric GitHub User ID, preventing unauthorized access even if usernames change.

To retrieve your numeric GitHub User ID:

```sh
curl -s https://api.github.com/users/<YOUR_GITHUB_USERNAME> | grep '"id":'
```

For example, if the output contains `"id": 12345678`, your `ALLOWED_GITHUB_USER_ID` is `12345678`.

---

## 3. Create a GitHub Personal Access Token (for Content Publishing)

Create a separate fine-grained Personal Access Token (PAT) used solely by the Worker to commit recipes, categories, tags, and photos to your repository:

1. Go to **GitHub** → **Settings** → **Developer Settings** → **Personal Access Tokens** → **Fine-grained tokens** → **Generate new token**.
2. Configure permissions:
   - **Token name**: `JyoCanCook Worker Publisher`
   - **Repository access**: **Only select repositories** → choose `jyocancook`
   - **Permissions**: **Repository permissions** → **Contents: Read and write**
3. Generate and copy the token.

> **Security Note:** Keep your OAuth credentials (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`) separate from the content publishing token (`GITHUB_CONTENT_TOKEN`).

---

## 4. Configure `wrangler.jsonc` (Non-Secret Plaintext Variables)

Update the plaintext variables in `wrangler.jsonc`:

```jsonc
{
  "name": "jyocancook",
  "main": "worker/index.ts",
  "compatibility_date": "2026-11-16",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": [
      "/api/auth/*",
      "/admin",
      "/admin/*",
      "/api/admin/*"
    ],
    "not_found_handling": "404-page"
  },
  "vars": {
    "GITHUB_OWNER": "YOUR_GITHUB_USERNAME",
    "GITHUB_REPO": "jyocancook",
    "GITHUB_BRANCH": "main",
    "GITHUB_OAUTH_CLIENT_ID": "YOUR_GITHUB_OAUTH_CLIENT_ID",
    "ALLOWED_GITHUB_USER_ID": "YOUR_NUMERIC_GITHUB_USER_ID"
  }
}
```

---

## 5. Store Worker Secrets in Cloudflare

Store your sensitive secrets securely in Cloudflare using the Wrangler CLI. **Never store these in source code or plaintext `wrangler.jsonc` vars.**

```sh
# 1. GitHub OAuth App Client Secret
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET

# 2. GitHub Fine-Grained Content Publishing Token
npx wrangler secret put GITHUB_CONTENT_TOKEN

# 3. Session Signing Secret (random string, 32+ characters)
npx wrangler secret put SESSION_SECRET
```

> To generate a strong random `SESSION_SECRET`:
> ```sh
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## 6. Authentication & Route Protection Summary

- **`/api/auth/login`**: Generates a cryptographic CSRF `state` parameter, sets a short-lived `HttpOnly`, `Secure`, `SameSite=Lax` cookie, and redirects to GitHub's OAuth authorization endpoint.
- **`/api/auth/callback`**: Validates the CSRF `state` cookie, exchanges the authorization code for an access token, fetches the user profile from GitHub, and enforces that `user.id` strictly matches `ALLOWED_GITHUB_USER_ID`. On success, issues a signed JWT session cookie (`jyo_admin_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, 8-hour expiry) and redirects to `/admin/`.
- **`/api/auth/logout`**: Clears the session and state cookies and redirects to `/`.
- **`/admin`, `/admin/*`**: Static admin assets are protected; unauthenticated browser requests are redirected to `/api/auth/login`. Authenticated requests are served with `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
- **`/api/admin/*`**: Unauthenticated API requests and write mutations are rejected with `401 Unauthorized`, preventing unauthorized publishing.
- **Public Website (`/`, `/recipes/*`, etc.)**: Served directly from static assets without authentication.

---

## 7. Verifying Authentication & Authorisation

Run the automated test suite locally before deploying:

```sh
npm test
```

All authentication, CSRF validation, user ID verification, route protection, and session management tests must pass before deploying to production.
