# JyoCanCook — Production deployment (jyocancook.com)

First production deployment of the Astro + PHP + MySQL site on Hostinger. Nothing is deployed automatically and nothing in this repository connects to Hostinger: you build ZIP files on your laptop and run the commands below yourself.

**Branch.** `feature/hostinger-static-publishing` is the permanent deployment branch. It is **not** merged into `main`, and nothing in the packaging reads `main`: the site is built from this branch's working tree and the database seed is read from this branch's committed `HEAD`.

**The staging site is never touched.** `public_html/staging/`, `backend-staging/`, the staging database and the staging password protection stay exactly as they are. The production ZIP has no `staging/` entry, production has its own folder, database, user, session secret and session cookie, and the production code refuses to start if it is pointed at a staging backend or a staging-named database.

**MySQL is the source of truth after the first import.** The initial package is used **once**. Every later code deployment uses the code-only *update* package (section 6), which cannot contain recipes, pages or images, so it can never overwrite admin-managed content or uploaded photos.

Related: `docs/HOSTINGER_STAGING.md` (staging), `docs/HOSTINGER_DEPLOYMENT.md` (overview).

## 0. Values used in this guide

| Name | Value |
|---|---|
| Account root (`ACCOUNT`) | `/home/u616903313/domains/jyocancook.com` |
| Web root | `$ACCOUNT/public_html` |
| Private backend | `$ACCOUNT/backend-production` (never inside `public_html`) |
| Uploaded photos | `$ACCOUNT/public_html/images/recipes` |
| Site URL | `https://jyocancook.com` (hosts `jyocancook.com`, `www.jyocancook.com`) |
| Environment | `production` |
| Database / user | a **new** production database and user (names must **not** contain the word `staging`) |

```text
ACCOUNT/
├── backend-production/        <- PRIVATE. From backend.zip.  (new)
│   ├── auth/ config/ db/ generator/ services/ seed/ tmp/
│   └── config/config.local.php   <- you create it (DB credentials, secret)   [config file 1 of 2]
├── backend-staging/           <- staging backend. NOT TOUCHED
└── public_html/               <- production web root. From public_html.zip
    ├── index.html, admin/, api/, recipes/, category/, tag/, images/, _astro/, .htaccess, robots.txt
    ├── api/config.local.php      <- you create it (backend path only, no passwords)   [config file 2 of 2]
    └── staging/               <- staging site. NOT TOUCHED (password protected)
```

## 1. Before you start (laptop)

1. Check out the deployment branch and make sure everything is committed (the seed is read from the commit):

   ```powershell
   git checkout feature/hostinger-static-publishing
   git status --short          # must print nothing
   ```

2. Install, test and build the initial packages:

   ```powershell
   npm.cmd ci
   npm.cmd test
   npm.cmd run package:production
   ```

   `package:production` rebuilds the site with `SITE_URL=https://jyocancook.com`, verifies the archives and writes `deploy/production/`:

   | File | Extract into |
   |---|---|
   | `public_html.zip` | `ACCOUNT/public_html/` |
   | `backend.zip` | `ACCOUNT/backend-production/` |
   | `MANIFEST.sha256` | not uploaded to the web; used to check the upload |

   The packager **fails** (and writes nothing) if: `public_html.zip` would contain `staging/`; any file mentions `staging.jyocancook.com` or `backend-staging`; a noindex header or `Disallow: /` is present; a staging host guard is present; the config samples are not the production values; or a secret, token or `config.local.php` is found. It warns if the content in the working tree differs from `HEAD` or if there are uncommitted changes: if you see that warning, commit and build again.

   It overwrites `dist/` (the staging build there is replaced by the production build). `deploy/staging/` is not touched.

3. Seed content: `backend.zip` ships the content committed on this branch in `backend-production/seed/` (**7 recipes, 8 categories, 14 tags, 8 menu items, 40 ingredients, 23 steps**, plus the recipe images in `public_html.zip`). It is read from git `HEAD`, not from your working tree and not from `main`.
4. Create the session secret on your laptop (needed in step 4). It must differ from staging's:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. hPanel → **Databases → MySQL Databases**: create the production database and a user with a strong password, and give the user all privileges on that database only. Write down the exact database name, user and host (usually `localhost`). Do **not** reuse the staging database or user.
6. hPanel → **Advanced → SSH Access**: enabled, host/port/user noted.

## 2. Upload the files (outside the web root)

Upload to the account root, not to `public_html`, so the ZIPs can never be downloaded:

```powershell
scp -P <port> deploy/production/public_html.zip deploy/production/backend.zip deploy/production/MANIFEST.sha256 <user>@<host>:domains/jyocancook.com/
```

(or hPanel File Manager → upload into `domains/jyocancook.com/`).

## 3. Server steps (SSH) — in this order

```bash
ssh -p <port> <user>@<host>
export ACCOUNT=/home/u616903313/domains/jyocancook.com
cd "$ACCOUNT"
php -v                       # 8.1 or newer (8.3 expected)
ls                           # you should see public_html, backend-staging, and the three uploaded files
```

The order matters: **extract the backend → extract the public files → create the backend config file → create the gateway config file → create the tables → validate → import → create the admin.** The two config files are created *after* both ZIPs are extracted, because `config.local.sample.php` and `api.config.local.sample.php` come from `backend.zip` and `public_html/api/` comes from `public_html.zip`.

### Step 1 — Check the upload and take a safety backup

```bash
sha256sum -c MANIFEST.sha256          # both lines must say OK

# Copy of the current production files (staging excluded: it is not changed and can be large).
mkdir -p "$HOME/prod-backups"
tar --exclude='public_html/staging' -czf "$HOME/prod-backups/public_html-before-production-$(date +%Y%m%d-%H%M%S).tar.gz" public_html
ls -l "$HOME/prod-backups"
```

### Step 2 — Extract the backend (private, outside `public_html`)

```bash
mkdir -p backend-production
unzip -o backend.zip -d backend-production
ls backend-production                  # auth config db generator services seed tmp .htaccess (no wrapper folder)
ls backend-production/auth/Auth.php    # must exist directly here
ls backend-production/config           # config.php database.php config.local.sample.php api.config.local.sample.php
chmod 750 backend-production/tmp
```

### Step 3 — Extract the public files (staging stays untouched)

```bash
cd "$ACCOUNT"
unzip -o public_html.zip -d public_html
ls public_html/index.html public_html/api/index.php
```

* `public_html.zip` has no `staging/` entry, so `unzip` cannot change anything under `public_html/staging/`.
* It replaces only production files (`index.html`, `.htaccess`, `robots.txt`, `api/index.php`, `api/.htaccess`, `_astro/`, `images/`, `recipes/` ...). Old test files that are not in the ZIP stay where they are.
* The ZIP's root `.htaccess` forces HTTPS and routes `/api/` to the gateway. A folder with its own rewrite rules (`public_html/staging/`) does not inherit them, and staging's own host guard and password protection keep applying.
* To remove old leftovers deliberately, list them first and delete named items only (never use `rm -rf public_html/*`):

  ```bash
  ls -la public_html
  # rm -rf public_html/<old-folder>     # one named item at a time; never 'staging'
  ```

Until the next two steps are done, the static pages are visible but `/api/` answers with a configuration error. That is expected.

### Step 4 — Create the two private config files (in this order)

**4a. Backend config (`config.local.php`, holds the database password and secret).** Never put it in a ZIP or in git (`**/config.local.php` is git-ignored).

```bash
cd "$ACCOUNT"
cp backend-production/config/config.local.sample.php backend-production/config/config.local.php
chmod 600 backend-production/config/config.local.php
nano backend-production/config/config.local.php     # replace every REPLACE_* value
```

| Setting | Value |
|---|---|
| `db.host` / `db.port` | `localhost` / `3306` (as shown in hPanel) |
| `db.name`, `db.user`, `db.pass` | the **production** database, user and password |
| `site.environment` | `production` (already set) |
| `site.url` | `https://jyocancook.com` (already set) |
| `site.allowed_hosts` | `['jyocancook.com', 'www.jyocancook.com']` (already set) |
| `site.public_path` | `$accountRoot . '/public_html'` (already set) |
| `site.upload_path` | `$accountRoot . '/public_html/images/recipes'` (already set) |
| `auth.session_secret` | the 64-hex-character value from section 1, **different from staging** |
| `auth.trusted_proxies` | `[]` (keep empty) |

`$accountRoot = dirname(__DIR__, 2)` resolves to `ACCOUNT` because the file is in `ACCOUNT/backend-production/config/`.

The production backend refuses to start (and logs why) if: the environment is not `production`; `allowed_hosts` is empty; `session_secret` is shorter than 32 characters or still starts with `REPLACE_`; the database name contains `staging`; or the upload folder is outside `public_html` or inside `public_html/staging`.

**4b. Gateway config (`public_html/api/config.local.php`, no passwords).** It only tells the public API where the private backend is. Create it now that `public_html/api/` exists:

```bash
cat > public_html/api/config.local.php <<EOF
<?php
return [
    'backend_path' => '$ACCOUNT/backend-production',
    'environment'  => 'production',
];
EOF
chmod 640 public_html/api/config.local.php
cat public_html/api/config.local.php     # backend_path ends with /backend-production, environment is production
test -d "$ACCOUNT/backend-production/auth" && echo "backend path exists"
```

The gateway refuses a backend whose environment differs from `production` (`BACKEND_ENVIRONMENT_MISMATCH`), so it can never run against `backend-staging`. `public_html/api/config.local.php` is not in the ZIP, so extracting `public_html.zip` again never replaces it.

### Step 5 — Create the production database tables (schema)

Use the production database from section 1. Either:

```bash
mysql -h localhost -u <PROD_DB_USER> -p <PROD_DB_NAME> < backend-production/db/schema.sql
```

or phpMyAdmin → select the **production** database → Import → `backend-production/db/schema.sql`. (The file only has `CREATE TABLE IF NOT EXISTS`; it is safe to repeat. `php backend-production/db/migrate.php` also creates the tables, but it imports the content straight away; this guide imports the content separately in steps 7–8.)

### Step 6 — Validate PHP syntax and configuration

```bash
cd "$ACCOUNT"
find backend-production public_html/api -name '*.php' -print0 | xargs -0 -n1 php -l | grep -v '^No syntax errors' || echo "all PHP files OK"

php <<'PHP'
<?php
$c = require 'backend-production/config/config.php';
$yes = static fn($b) => $b ? 'yes' : 'NO';
echo "environment      : {$c['site']['environment']}\n";
echo "url              : {$c['site']['url']}\n";
echo "allowed_hosts    : " . implode(', ', $c['site']['allowed_hosts']) . "\n";
echo "public_path      : {$c['site']['public_path']} (exists: " . $yes(is_dir($c['site']['public_path'])) . ")\n";
echo "upload_path      : {$c['site']['upload_path']} (exists: " . $yes(is_dir($c['site']['upload_path'])) . ")\n";
echo "db name / user   : {$c['db']['name']} / {$c['db']['user']}\n";
echo "secret length    : " . strlen($c['auth']['session_secret']) . " (need 32+)  placeholder: " . $yes(str_starts_with($c['auth']['session_secret'], 'REPLACE_')) . " (must be NO)\n";
echo "session cookie   : {$c['auth']['session_name']}\n";
echo "tmp writable     : " . $yes(is_writable('backend-production/tmp')) . "\n";
echo "public writable  : " . $yes(is_writable($c['site']['public_path'])) . "\n";
require 'backend-production/config/database.php';
try { $n = Database::getConnection()->query('SHOW TABLES')->rowCount(); echo "database         : connected, $n tables\n"; }
catch (Throwable $e) { echo "database         : FAILED - " . $e->getMessage() . "\n"; }
PHP
```

Expected: environment `production`, hosts `jyocancook.com, www.jyocancook.com`, `public_path` ending `/public_html` (not `/staging`), secret length 64, placeholder `NO`, cookie `jyo_prod_admin_session`, both writable `yes`, database connected with 10 tables. The script prints no password or secret.

### Step 7 — Dry run of the content import (writes nothing)

```bash
php backend-production/db/import-content.php --dry-run
```

Expected: "DRY RUN (nothing written)" and a table showing the seed counts and "would add" 7 recipes, 8 categories, 14 tags, 8 menu items. Warnings about missing images are listed; images are in `public_html/images/`.

### Step 8 — Run the real import (once)

```bash
php backend-production/db/import-content.php
```

* Idempotent and non-destructive: it only **adds** what is missing and never overwrites anything edited in the admin. Slugs and public URLs are never changed. Re-running adds nothing.
* After this, **MySQL is the source of truth**. A recipe you delete in the admin is added again by a later run of this importer. Step 12 removes the seed so that cannot happen by accident.

### Step 9 — Create the admin account

```bash
php backend-production/db/create-admin.php
```

It asks for a username, an email and a hidden password (14 characters or more). It refuses to run if an admin already exists and stores only a bcrypt hash. Use a password that is not used on staging.

### Step 10 — Verify the database

```bash
mysql -h localhost -u <PROD_DB_USER> -p <PROD_DB_NAME> -e "
SELECT 'recipes' AS what, COUNT(*) AS n FROM recipes
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'tags', COUNT(*) FROM tags
UNION ALL SELECT 'menu_items', COUNT(*) FROM menu_items
UNION ALL SELECT 'recipe_ingredients', COUNT(*) FROM recipe_ingredients
UNION ALL SELECT 'recipe_steps', COUNT(*) FROM recipe_steps
UNION ALL SELECT 'admins', COUNT(*) FROM admins;"
```

| what | expected |
|---|---|
| recipes | 7 |
| categories | 8 |
| tags | 14 |
| menu_items | 8 |
| recipe_ingredients | 40 |
| recipe_steps | 23 |
| admins | 1 |

(`import-content.php` also prints `<table> in database: N` lines.) If the numbers differ, stop and do not publish.

### Step 11 — Test the site, then the admin

**Status endpoint** (anonymous, from your laptop):

```powershell
curl.exe -i https://jyocancook.com/api/admin/status
```

Expected: `HTTP 401` and JSON saying authentication is required. **Not** `500 {"ok":false,"error":"Server configuration error"}`.

If you get that error, read the private boot log; it names the cause (`code`) and contains no secrets:

```bash
tail -n 5 "$ACCOUNT/backend-production/tmp/logs/api-boot.log"
# if the backend folder itself cannot be found, look here instead:
tail -n 5 "$ACCOUNT/jyocancook-boot-logs/api-boot.log"
```

| `code` | Meaning / fix |
|---|---|
| `BACKEND_PATH_NOT_CONFIGURED`, `BACKEND_PATH_INVALID` | `public_html/api/config.local.php` is missing or `backend_path` is not an absolute path (step 4b) |
| `BACKEND_DIR_MISSING` | the folder named in `backend_path` does not exist |
| `BACKEND_INCOMPLETE` | `backend-production` lacks required files (extract `backend.zip` again, step 2) |
| `BACKEND_IN_WEB_ROOT` | `backend_path` points inside `public_html` |
| `GATEWAY_ENVIRONMENT_INVALID`, `BACKEND_ENVIRONMENT_MISMATCH` | gateway environment is not `production`, or it points at a backend whose `site.environment` is not `production` (for example `backend-staging`) |
| `BACKEND_ALLOWED_HOSTS_EMPTY` | `site.allowed_hosts` is empty in `config.local.php` (step 4a) |
| `BACKEND_SESSION_SECRET_INVALID` | `auth.session_secret` is shorter than 32 characters or still a `REPLACE_*` value (step 4a) |

**Admin test (browser):**

1. Open `https://jyocancook.com/admin/` and sign in with the account from step 9. A wrong password must be refused.
2. Open a recipe, make a harmless reversible edit (for example add a word to the description), save, and open `https://jyocancook.com/recipes/<slug>/` to see it. Revert the edit and save again.
3. Click **Rebuild All Static Pages** once. This replaces the pages that came from the Astro build with pages generated from MySQL (the imported content). It writes only into `public_html` generated routes and never into `public_html/staging`.
4. Check that the home page, a category page, a tag page, search and the images load, and that `https://jyocancook.com/sitemap-index.xml` lists production URLs.

### Step 12 — Go-live clean-up: remove the ZIPs and the seed

Only after steps 10 and 11 passed:

```bash
cd "$ACCOUNT"
rm public_html.zip backend.zip MANIFEST.sha256
rm -rf backend-production/seed          # the importer can no longer re-add recipes deleted in the admin
ls backend-production                   # no seed/ any more
```

Keep `deploy/production/` on your laptop in case you ever need to rebuild an empty database. From now on only the update package (section 6) is deployed.

## 4. Security and isolation checks

| # | Check | Expected |
|---|---|---|
| 1 | `curl.exe -i https://jyocancook.com/api/admin/status` | `401` JSON, not a configuration error |
| 2 | `http://jyocancook.com/` | redirects to `https://` |
| 3 | `https://jyocancook.com/api/config.local.php` | `403` |
| 4 | `https://jyocancook.com/backend-production/`, `/backend-production/config/config.php`, `/backend-production/config/config.local.php` | `404` (not under the web root) |
| 5 | `https://jyocancook.com/images/recipes/` | no directory listing; a `.php` file placed there is never executed |
| 6 | `POST /api/admin/publish` while signed in but without `X-CSRF-Token` | `403` |
| 7 | `GET /api/admin/recipes` signed out | `401` |
| 8 | `https://staging.jyocancook.com/` | still shows the **password prompt** (`401`) |
| 9 | `https://jyocancook.com/staging/` | `401` or `403`, never the staging page |
| 10 | Staging admin login and a staging publish | still work; they change only `public_html/staging` and the staging database |
| 11 | Production admin login with a staging account (and the reverse) | refused: separate databases, separate cookies (`jyo_prod_admin_session` vs `jyo_php_admin_session`) |
| 12 | Compare `public_html/staging` and `backend-staging` before and after (File Manager "Last modified", or `find public_html/staging backend-staging -newer public_html.zip` before you delete the ZIP) | nothing changed |
| 13 | `https://jyocancook.com/robots.txt` | allows crawling, lists `https://jyocancook.com/sitemap-index.xml`, disallows `/admin/` |
| 14 | `View source` of any production page | no `staging.jyocancook.com` |

The production publisher can write only into `public_html` generated routes: it refuses any public path that is not a directory named `public_html`, never writes into `public_html/staging`, and refuses an upload folder inside it.

## 5. Roll back (first deployment)

* **Public files:** the safety archive from step 1 holds the previous `public_html` (without staging). Restore only what you replaced, for example:

  ```bash
  cd "$ACCOUNT"
  tar -xzf ../prod-backups/public_html-before-production-<timestamp>.tar.gz public_html/index.html public_html/.htaccess
  ```
* **Backend:** `backend-production` is new. Removing it (and `public_html/api/config.local.php`) takes the API offline without touching anything else.
* **Database:** the production database is new and separate. Drop and recreate its tables, or restore a backup you took, without any effect on staging.

## 6. Later code deployments (never overwrite recipes or uploads)

After go-live the initial `public_html.zip` must **not** be extracted again: it contains the recipe pages, listing, category and tag pages, search index, sitemap and the seed images from the repository, and would put the old versions back over what the admin published and uploaded.

For every later code change use the update package instead:

```powershell
git checkout feature/hostinger-static-publishing
git status --short                          # must print nothing
npm.cmd test
npm.cmd run package:production-update       # writes deploy/production-update/
```

`deploy/production-update/` contains `public_html.zip`, `backend.zip` and `MANIFEST.sha256`, built with the same safeguards as the initial package. The packager verifies that they contain **none** of: `index.html`, `404.html`, `recipes/`, `category/`, `tag/`, `search/`, `about/`, `images/`, `search-index.json`, `sitemap*.xml`, `pagefind/`, `staging/`, the database `seed/`, or any `config.local.php`. They hold only code: `api/`, `admin/`, `_astro/`, `styles/`, `.htaccess`, `robots.txt` and the backend PHP files.

Deploy it with the same upload, checksum and backup commands as steps 1–3, but **without** steps 4–11 (the config files and the database already exist):

```bash
cd "$ACCOUNT"
sha256sum -c MANIFEST.sha256
tar --exclude='public_html/staging' -czf "$HOME/prod-backups/public_html-before-update-$(date +%Y%m%d-%H%M%S).tar.gz" public_html
tar -czf "$HOME/prod-backups/backend-before-update-$(date +%Y%m%d-%H%M%S).tar.gz" --exclude='backend-production/tmp' backend-production
unzip -o backend.zip -d backend-production
unzip -o public_html.zip -d public_html
find backend-production public_html/api -name '*.php' -print0 | xargs -0 -n1 php -l | grep -v '^No syntax errors' || echo "all PHP files OK"
rm public_html.zip backend.zip MANIFEST.sha256
curl -i https://jyocancook.com/api/admin/status      # 401 JSON
```

Then, in the admin, click **Rebuild All Static Pages** if the change affects how pages look. This regenerates every page from MySQL, so admin-managed recipes stay exactly as they are.

What an update does not touch: recipes, categories, tags and menu (MySQL); `images/recipes/` uploads and replaced photos; the generated recipe, category, tag, search and sitemap files; `backend-production/config/config.local.php`; `public_html/api/config.local.php`; `backend-production/tmp/` logs and backups; everything staging. The update package does not change database tables; a code change that needs a new column or table needs its own explicit migration step.

**Sub category column (required once on an existing database, before saving any recipe with the updated code).** In phpMyAdmin, select the database and run:

```sql
ALTER TABLE `recipes` ADD COLUMN `subcategory_slug` VARCHAR(80) NULL AFTER `category_slug`;
```

A fresh database gets the column from `schema.sql`. Running it twice fails with "Duplicate column name", which is harmless.



Never run `php backend-production/db/import-content.php` or `migrate.php` after go-live: with no `seed/` folder (step 12) they find nothing to import and add nothing.

## 7. Things to know

* **Staging passwords.** Production extraction never writes to `public_html/staging/`, so its `.htaccess` and `.htpasswd` stay. Still do check 8 and 9 above on Hostinger's real Apache, because it merges parent `.htaccess` files with child ones.
* **`auth.session_secret`** is validated (32+ characters, not a placeholder) but the current login code uses PHP's native sessions and does not read it. Do not rely on it for anything.
* **Sessions** are `HttpOnly`, `Secure`, `SameSite=Strict`, and carry an environment marker. Production and staging share the account's PHP session store but use different cookie names and reject each other's sessions.
* **Hostinger's MySQL `wait_timeout` is about 20 seconds.** A very long publish should still finish well within that between statements; if you see "MySQL server has gone away" during a publish, run it again.
* **Publishing** is all-or-nothing with a backup in `backend-production/tmp/`. An empty database can never wipe the pages (the publisher refuses with HTTP 409).
* **Tests** run on PHP 8.3 compiled to WebAssembly with SQLite standing in for MySQL, not on Hostinger's Apache or MySQL. Steps 6, 7, 10 and 11 above are the real-server verification.
