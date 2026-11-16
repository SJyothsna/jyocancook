# JyoCanCook — Astro + Cloudflare Workers

An authentic homemade Indian recipe platform with categories, tags, full-text recipe search, curated starter content, and a GitHub-backed `/admin/` dashboard protected by GitHub OAuth.

## Quick start

1. Install Node.js 20.19+ or 22+ and Git.
2. Open the project folder in your terminal.
3. Run `npm install`.
4. Run `npm test` to verify authentication & authorisation tests.
5. Run `npm run dev` to preview the website locally (typically `http://localhost:4321`).
6. Run `npm run build` to generate static HTML and the Pagefind index.
7. Configure GitHub OAuth administrator publishing using `docs/ADMIN_SETUP.md`.
8. Deploy to Cloudflare using `docs/DEPLOYMENT.md`.

## What is included

- Authentic Indian recipe landing page with warm burgundy & cream theme, responsive hero banner, and 112×88px category icon tiles
- Individual recipe pages with ingredients scaler, step-by-step checklist, structured instructions, recipe structured data, Save (per-browser), Share, and Print
- Category and tag index pages with ingredient-name filters
- Pagefind full-text search index built at compile time
- GitHub OAuth authorization code login protecting `/admin/` and `/api/admin/*`
- Structured admin editor for recipes (grouped ingredients, step titles, multiline instructions), categories, tags, and navigation menu
- Server-side GitHub commit API in Cloudflare Worker (`worker/index.ts`)
- GitHub Actions CI/CD workflow for automated site rebuilding when publishing

## Project layout

```
config/                  categories.json / tags.json / menu.json
src/content/recipes/     one JSON file per recipe
src/pages/               public and admin routes
src/components/          recipe cards and custom category SVG icons
src/layouts/             common header, navigation, footer, SEO
src/styles/              warm burgundy & cream design tokens and global styles
src/scripts/admin.ts     structured recipe editor and publishing UI
worker/index.ts          GitHub OAuth login/callback/logout & admin publishing API
public/images/recipes/   high-resolution recipe photography
docs/                    admin setup and deployment guides
tests/                   automated authentication and authorization tests
.github/workflows/       automated deployment workflow
```

## Security & Authentication Architecture

- Admin dashboard (`/admin`, `/admin/*`) and API routes (`/api/admin/*`) are protected by **GitHub OAuth Authorization Code flow**.
- Unauthenticated requests to `/admin` are redirected to `/api/auth/login`.
- Login generates a cryptographic CSRF `state` and sets a short-lived `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- `/api/auth/callback` validates the CSRF state, exchanges the authorization code for an OAuth token, retrieves the GitHub user profile, and enforces server-side verification of the authorized numeric GitHub User ID (`ALLOWED_GITHUB_USER_ID`).
- Authenticated sessions receive a signed `HttpOnly`, `Secure`, `SameSite=Lax` JWT session cookie with an 8-hour expiry.
- Unauthenticated API calls and write mutations are strictly rejected with `401 Unauthorized`.
- Sensitive credentials (`GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_CONTENT_TOKEN`, `SESSION_SECRET`) are stored as encrypted Cloudflare Worker secrets—never in source code or git.
