# Bob instructions — JyoCanCook

## Get started

1. Extract `JyoCanCook-Cloudflare-Starter.zip`.
2. Open the extracted `jyocancook-project` folder in Bob.
3. Ask Bob: **"Read README.md and docs/DEPLOYMENT.md. Install dependencies, run `npm run build`, report and fix compilation errors without changing the website's approved warm burgundy-and-cream recipe design. Never store secrets in repository files."**
4. Run `npm run dev` and check home, recipe, category, tag, admin route and mobile layout. Search full-text needs a production build.

## First deployment prompt for Bob

"This is an Astro static site with an accompanying Cloudflare Worker in `worker/index.ts`. Read `docs/DEPLOYMENT.md` and `docs/ADMIN_SETUP.md`. Prepare it for deployment to **my** Cloudflare account using a GitHub repository. Explain each manual step requiring my Cloudflare/GitHub credentials. Do not ask me to paste a token into source code, commit any secret, disable security checks or invent credentials. Configure GitHub Actions only after the required secrets are available. The domain is jyocancook.com."

## Add features later

- Add Tamil / Telugu recipe title: "Add an optional `teluguTitle` property to recipe JSON, admin form, types and recipe template. Preserve all existing recipes."
- Add multiple categories per recipe: "Extend `category` to support a secondary category list, update category pages and admin form with backward compatibility."
- Add improved image upload: "Use R2 object storage with signed uploads to reduce GitHub image sizes; restrict via the same Access JWT."
- Add recipe step photos: "Extend admin form to let me upload separate step photos and save each step's image URL. Existing renderer already supports steps[].image."
- Add custom menu pages: "Build an editable static page model and admin editor; validate internal links and prerender pages at build time."

## How to add a recipe once deployed

1. Visit `https://jyocancook.com/admin/` and sign in through GitHub OAuth.
2. Select **Recipes → Add recipe**.
3. Enter title and slug, select category, add tags, ingredients, steps, image and optional tips.
4. Upload your photo (JPG/PNG/WebP up to 4 MB) and click **Upload photo** first.
5. Tick **Publish now** (or leave unchecked to save as draft).
6. Click **Create recipe**.
7. Check the GitHub Actions deployment status. When it succeeds, visit the new URL `/recipes/<slug>/`.

## What Bob cannot do automatically without your permissions

- Authorize your GitHub repository or Cloudflare account
- Create private Access rules for your login without account access
- Supply your GitHub Personal Access Token or Cloudflare API token
- Confirm the actual domain's DNS ownership

Use test recipes until the authentication and deployment workflow are fully verified.
