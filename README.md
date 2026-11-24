# JyoCanCook — Astro + PHP/MySQL on Hostinger

An authentic homemade Indian recipe platform with categories, tags, full-text recipe search, curated starter content, and a password-protected `/admin/` dashboard. Recipes are stored in MySQL and published as static HTML by the PHP backend on Hostinger.

## Quick start

1. Install Node.js 20.19+ or 22+ and Git.
2. Open the project folder in your terminal.
3. Run `npm install`.
4. Run `npm test` to run the test suite.
5. Run `npm run dev` to preview the website locally (typically `http://localhost:4321`). The local admin API writes to `config/*.json` and `src/content/recipes/`.
6. Run `npm run build` to generate static HTML and the Pagefind index.
7. Package and deploy to Hostinger using `docs/HOSTINGER_STAGING.md` (staging) or `docs/HOSTINGER_PRODUCTION.md` (production). `docs/HOSTINGER_DEPLOYMENT.md` is the general overview.

## What is included

- Authentic Indian recipe landing page with warm burgundy & cream theme, responsive hero banner, and 112×88px category icon tiles
- Individual recipe pages with ingredients scaler, step-by-step checklist, structured instructions, recipe structured data, Save (per-browser), Share, and Print
- Category and tag index pages with ingredient-name filters
- Pagefind full-text search index built at compile time
- Admin login protecting `/admin/` and `/api/admin/*` (PHP sessions with CSRF protection)
- Structured admin editor for recipes (grouped ingredients, step titles, multiline instructions), categories, tags, and navigation menu
- PHP static site generator that rebuilds pages immediately when a recipe is published

## Project layout

```
config/                  categories.json / subcategories.json / diets.json / tags.json / menu.json (seed content)
src/content/recipes/     one JSON file per recipe (seed content and local dev)
src/pages/               public and admin routes
src/components/          recipe cards and custom category SVG icons
src/layouts/             common header, navigation, footer, SEO
src/styles/              warm burgundy & cream design tokens and global styles
src/scripts/admin.ts     structured recipe editor and publishing UI
src/lib/admin-sanitize.ts  validation used by the local-dev admin API
api/                     public PHP API gateway (index.php, .htaccess)
backend/                 PHP backend: auth, MySQL schema/migrations, services, static generator
bin/                     Hostinger packaging scripts
public/images/recipes/   high-resolution recipe photography
docs/                    Hostinger deployment guides
tests/                   automated tests
```

## Security

- Admin login uses a username and password verified server-side by the PHP backend (`backend/auth/Auth.php`).
- State-changing requests require a CSRF token.
- Credentials live in `config.local.php` files on the server and are never committed.
