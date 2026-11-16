# Deploy JyoCanCook to Cloudflare Workers

The public site consists of Astro-built HTML/CSS/JS. The Worker serves these static assets and provides a protected admin API with GitHub OAuth authorization.

## Prerequisites

- Node.js 20.19+ or Node.js 22+ LTS, npm, Git
- GitHub repository `jyocancook` (private or public)
- Cloudflare account with custom zone/domain `jyocancook.com`

## 1. Local verification & tests

```sh
npm install
npm test
npm run build
```

The test runner will verify all GitHub OAuth authorization flows, CSRF validation, user ID verification, and route protection.

The build should produce `dist/` and `dist/pagefind/`. To preview the public site in production-like mode use `npm run preview`.

## 2. GitHub

Create a repository and commit the files (never commit `node_modules`, `dist`, secrets or `.dev.vars`):

```sh
git init
git add .
git commit -m "Initial JyoCanCook website"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## 3. Cloudflare Worker configuration

Open `wrangler.jsonc` and update the non-secret variables:

- `GITHUB_OWNER` — account/org that owns the repo
- `GITHUB_REPO` — actual repo name (`jyocancook`)
- `GITHUB_BRANCH` — `main`
- `GITHUB_OAUTH_CLIENT_ID` — GitHub OAuth App Client ID (see `docs/ADMIN_SETUP.md`)
- `ALLOWED_GITHUB_USER_ID` — your numeric GitHub User ID

### Configure Cloudflare Worker secrets (never in wrangler.jsonc or git):

```sh
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put GITHUB_CONTENT_TOKEN
npx wrangler secret put SESSION_SECRET
```

## 4. First deployment

```sh
npx wrangler login
npm run deploy
```

Wrangler will deploy the Worker and print the workers.dev URL. Public pages load immediately; `/admin/` will initiate the GitHub OAuth login flow.

## 5. Domain

From Cloudflare dashboard → Workers & Pages → your `jyocancook` Worker → Settings → Domains & Routes → add Custom Domain `jyocancook.com`. Configure DNS records and certificates as prompted.

## 6. Automatic deployment after publishing (CI/CD)

The admin commits recipe/category/menu updates directly to GitHub via the Worker. **Without CI/CD, saving a recipe will NOT rebuild or update the live static site.**

Add repository secrets in GitHub (`Settings` → `Secrets and variables` → `Actions`):

- `CLOUDFLARE_API_TOKEN` — scoped to your account's Worker deployment permissions
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account identifier

GitHub Actions runs `npm install`, `npm test`, `npm run build`, and `npx wrangler deploy`.

## 7. Verify end-to-end

- Visit `https://jyocancook.com/admin/`; you are redirected to GitHub to authorize login.
- Sign in with your authorized GitHub account; you are redirected to `/admin/` with an active session.
- Add a sample recipe; verify GitHub commit and Actions rebuild.
- Verify the published recipe appears at `/recipes/<slug>/` after CI/CD completes.
- Verify search and mobile responsiveness.
