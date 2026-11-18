# JyoCanCook — Staging deployment (staging.jyocancook.com)

Nothing here touches the live `jyocancook.com` site. Nothing is deployed automatically: you upload the two ZIP files by hand.

Staging runs the PHP admin, saves recipes to its **own MySQL database** and writes static HTML pages straight into `public_html/staging`. There are no GitHub commits and no Astro rebuilds.

## 1. Folder layout

`HOSTINGER_ACCOUNT_ROOT` is the folder that contains `public_html/`. Do not guess it; see "Find your account root" below.

```text
HOSTINGER_ACCOUNT_ROOT/
├── backend-staging/            <- PRIVATE (never inside public_html). From backend.zip
│   ├── auth/  config/  db/  generator/  services/  seed/
│   ├── config/config.local.php <- you create this on the server (credentials)
│   └── tmp/                    <- logs, lock file, publish backups (must be writable)
│
└── public_html/                <- live site (production) - never modified by staging
    ├── index.html, recipes/ ...
    └── staging/                <- staging document root. From public_html.zip
        ├── index.html
        ├── admin/  api/  recipes/  category/  tag/
        ├── images/  styles/  _astro/
        └── api/config.local.php  <- you create this on the server (no passwords)
```

### Find your account root

hPanel → **File Manager**. The folder that shows `public_html` next to your other folders is the account root. Over SSH, run `pwd` right after login: that is normally the account root. Write the absolute path down; you need it in section 5.

## 2. Build the packages (laptop, Node.js only, no PHP)

```powershell
npm run package:staging
```

This builds the Astro site for `https://staging.jyocancook.com`, assembles the files, verifies them (it fails on any secret, development stub or wrong layout) and writes:

| File (`deploy/staging/`) | Upload to | Extract into |
|---|---|---|
| `backend.zip` | `HOSTINGER_ACCOUNT_ROOT/` | `HOSTINGER_ACCOUNT_ROOT/backend-staging/` |
| `public_html.zip` | `HOSTINGER_ACCOUNT_ROOT/public_html/staging/` | `HOSTINGER_ACCOUNT_ROOT/public_html/staging/` |
| `MANIFEST.sha256` | not uploaded | checksums for reference |

Both ZIPs keep their files at the archive root. The files must end up **directly** inside the destination folder: `public_html/staging/index.html` and `backend-staging/auth/Auth.php`, with no extra `public_html/` or `backend/` folder level. If File Manager creates an extra folder, move the contents up one level and delete the empty folder.

## 3. Upload order

1. **Backend first.** In File Manager create `backend-staging` (account root, next to `public_html`), upload `backend.zip` into it and extract there.
2. Create the server config (sections 4 and 5) **before** the public files go live.
3. Then upload and extract `public_html.zip` into `public_html/staging/`.
4. Apply the password protection (section 6) **immediately after every extraction** and verify it.

Delete the uploaded ZIP files from the server once extracted.

## 4. Database configuration

Use the separate **staging** database you created. In `backend-staging/config/` copy `config.local.sample.php` to **`config.local.php`** and replace every `REPLACE_*` value:

| Setting | Value |
|---|---|
| `db.host` | `localhost` (hPanel → Databases shows the host; try `127.0.0.1` if you get a connection error) |
| `db.port` | `3306` |
| `db.name` | the staging database name from hPanel → Databases (for example `u123456789_staging`) |
| `db.user` | the staging database user |
| `db.pass` | that user's password |
| `site.environment` | `staging` (already set) |
| `site.url` | `https://staging.jyocancook.com` (already set) |
| `site.allowed_hosts` | `['staging.jyocancook.com']` (already set; any other host name gets 404 from the API) |
| `site.public_path` | `$accountRoot . '/public_html/staging'` (already set; derived from the file location) |
| `site.upload_path` | `$accountRoot . '/public_html/staging/images/recipes'` (already set) |
| `auth.session_secret` | 64 random hex characters (see below) |
| `auth.session_lifetime` | `28800` (8 hours) |
| `auth.trusted_proxies` | `[]` (keep empty) |

Generate the secret on your laptop and paste it only into the server file:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Notes:

* Set the file permission of `config.local.php` to `600`.
* `$accountRoot = dirname(__DIR__, 2)` works when the folder is exactly `HOSTINGER_ACCOUNT_ROOT/backend-staging`. If your layout differs, replace that line with the real absolute path.
* `session_secret` must be set, but the current login code uses PHP's native sessions and does not read it yet. Do not rely on it for anything.
* Sessions: the cookie is `HttpOnly`, `Secure` and `SameSite=Strict`, and the session id is regenerated at login. Staging is HTTPS-only, so no further session setting is needed.
* `config.local.php` is in `.gitignore` and is never packaged. Do not paste real values into chat, tickets or GitHub.

### `trusted_proxies`

Leave it `[]`. The login rate limiter then uses only the real connecting address and ignores `X-Forwarded-For` / `CF-Connecting-IP`. Entries are accepted only as valid IPs or CIDR ranges no wider than /8 (IPv4) or /16 (IPv6); `0.0.0.0/0`, `::/0` and malformed values are discarded. Add a range only if staging is placed behind a proxy or CDN whose address range you know.

## 5. Tell the API where its backend is

`public_html/staging/api/index.php` never guesses. It loads the backend only from an explicitly configured, validated absolute path. It refuses a relative path, a missing or incomplete folder, and any folder inside `public_html` (and it never falls back to `public_html/backend`). If anything is wrong it returns a generic `500 {"error":"Server configuration error"}` and writes a failure code plus non-secret details to the private boot log `backend-staging/tmp/logs/api-boot.log` (see "Private logs and writable folders" below).

Create `public_html/staging/api/config.local.php` from `backend-staging/config/api.config.local.sample.php`:

```php
<?php
return [
    'backend_path' => '/ABSOLUTE/PATH/TO/HOSTINGER_ACCOUNT_ROOT/backend-staging',
    'environment'  => 'staging',
];
```

Replace the path with the real absolute path of `backend-staging`. This file contains no passwords. `api/.htaccess` blocks web access to it. It is not in the ZIP, so extracting again does not overwrite it.

The production site uses the same mechanism with `'environment' => 'production'` and its own `backend-production` folder (see `docs/HOSTINGER_PRODUCTION.md`). The API refuses to start if the environment in this file and the `site.environment` / `site.allowed_hosts` in the backend config do not agree, so staging code can never be pointed at production by mistake.

Alternative if you can set server variables: `JYOCANCOOK_BACKEND_PATH` and `JYOCANCOOK_ENVIRONMENT`.

## 6. Protect staging (two layers, both required)

Staging is physically inside the live site's folder, so it can be reached as `https://staging.jyocancook.com/` **and** as `https://jyocancook.com/staging/`.

**Layer 1: Hostinger directory password (you do this).**

1. hPanel → **Websites → jyocancook.com → Advanced → Password Protect Directories** (wording varies).
2. Choose the folder `public_html/staging`, enable protection, and create a user name and a strong password. hPanel writes `.htpasswd` and edits `public_html/staging/.htaccess` itself.
3. Because the protection lives in `public_html/staging`, it applies to both URLs.
4. **Re-extracting `public_html.zip` overwrites `public_html/staging/.htaccess` and removes the protection.** After every extraction re-apply it, then verify (section 8).

**Layer 2: host rule (in the package, nothing to do).** The packaged `.htaccess` files (`staging/`, `api/`, `images/recipes/`, `_astro/`) start with a rule that answers `403` for any host name other than `staging.jyocancook.com`. So `https://jyocancook.com/staging/...` is refused even if the password protection is missing. The same rule is repeated in each folder because a folder with its own rewrite rules does not inherit the parent's. The API adds a third check: `allowed_hosts`.

Also in the package: HTTPS is forced, staging pages carry `X-Robots-Tag: noindex, nofollow, noarchive`, and `robots.txt` is `Disallow: /`.

Your existing main-site `.htaccess` is not modified. If it has a catch-all rewrite that fires before the subfolder rules, the check in section 8 will tell you.

## 7. Create the content and the first admin (SSH)

hPanel → **Advanced → SSH Access** (enable it and note host, port and user).

```bash
ssh -p <port> <user>@<host>
cd HOSTINGER_ACCOUNT_ROOT          # the folder that contains public_html and backend-staging
php -v                             # needs 8.1 or newer
php backend-staging/db/migrate.php          # creates the tables (safe to re-run) and adds any missing seed content
php backend-staging/db/create-admin.php     # asks for username, email and a hidden password (minimum 14 characters)
```

### Import the existing recipes, categories and tags

`backend.zip` ships the content committed on the branch it was built from (`feature/hostinger-static-publishing`, read from git `HEAD`) in `backend-staging/seed/` (7 recipes, 8 categories, 14 tags, 8 menu items). `migrate.php` imports it; to import (or re-import) on its own:

```bash
cd HOSTINGER_ACCOUNT_ROOT
php backend-staging/db/import-content.php --dry-run   # shows what would be added, writes nothing
php backend-staging/db/import-content.php             # imports
```

* Repeatable and non-destructive: it only **adds** what is missing (recipes, categories and tags are matched by slug; tags also by name; the menu only while the menu table is empty). Anything that exists is left exactly as edited in the admin. Slugs, and so public URLs (`/recipes/<slug>/`, `/category/<slug>/`, `/tag/<slug>/`), are never changed.
* A recipe you delete in the admin is imported again by the next run.
* It prints warnings for fields without a database column and for image files missing under `public_html/staging/`, and exits with an error if a recipe could not be imported. It uses the database settings in `config.local.php` and prints no credentials.
* To change the content that is shipped, build with `--seed-ref <git ref>` (default `HEAD`, the checked-out branch; `worktree` uses the files in the working tree).

* There is no default or hard-coded admin password. `create-admin.php` runs from the command line only, refuses to run if an admin already exists, and stores only a bcrypt hash. The password is never written to a file, an environment variable or the shell history.
* Run `migrate.php` **before** the first publish. If the database has no categories and no recipes, the publisher refuses to run (HTTP 409, "was not changed") so an empty database can never wipe the pages.
* To reset the admin: delete the row in phpMyAdmin → `admins` (staging database), then run `create-admin.php` again.
* If `php` is older than 8.1, use `php8.2` or `php8.3` instead.
* After `migrate.php`, either click **Rebuild All Static Pages** in the admin or run `php backend-staging/generator/generate.php` to publish the pages generated from MySQL.

### Private logs and writable folders

| Path | Needs | Why |
|---|---|---|
| `backend-staging/tmp/` | writable by PHP (permission `750`/`755`) | logs, lock file, publish staging area and rollback backup |
| `backend-staging/tmp/logs/api-errors.log` | created automatically | private error log; clients only see `{"error":"Internal server error","reference":"<id>"}`; search the log for `ref=<id>` |
| `backend-staging/tmp/logs/api-boot.log` | created automatically | one JSON line per `Server configuration error`: a `code` (for example `BACKEND_INCOMPLETE`, `BACKEND_ENVIRONMENT_MISMATCH`) plus non-secret facts. If the backend folder itself does not exist, the line is written to `jyocancook-boot-logs/api-boot.log` next to it instead. Never inside `public_html`. |
| `public_html/staging/` | writable by PHP | the only place the publisher writes |
| `public_html/staging/images/recipes/` | writable by PHP | photo uploads (script execution is blocked there) |

`backend-staging/` is outside the web root and also carries `Require all denied`. Passwords and tokens are redacted in logs. Rotate or delete the log periodically.

## 8. Checks after upload

Do these in a private browser window (or `curl`) after applying the password.

| # | Check | Expected |
|---|---|---|
| 1 | `https://staging.jyocancook.com/` without credentials | `401` password prompt |
| 2 | `https://jyocancook.com/staging/` without credentials | `401` or `403`; never the staging page |
| 3 | `https://jyocancook.com/staging/` **with** the staging password | `403` (host rule) |
| 4 | `https://jyocancook.com/` | the live site, unchanged |
| 5 | `http://staging.jyocancook.com/` | redirects to `https://` |
| 6 | `https://staging.jyocancook.com/api/admin/status` (after the password) | `401` JSON |
| 7 | `https://staging.jyocancook.com/api/config.local.php` | `403` |
| 8 | `https://staging.jyocancook.com/backend/`, `/backend-staging/`, `/backend/config/config.php` | `404` |
| 9 | `/admin/` sign-in, then create a recipe and publish | page appears at `/recipes/<slug>/`, in category/tag pages, `search-index.json` and `sitemap-0.xml` |
| 10 | Save the recipe as a draft | page is removed from the public site; it is still listed in the admin |
| 11 | Delete the recipe | page and all listings disappear |
| 12 | `GET /api/auth/logout` | `405`; the Logout button signs you out |
| 13 | Logged in, `POST` without `X-CSRF-Token` | `403` |
| 14 | Upload `.svg` or a renamed PHP file as a photo | rejected |
| 15 | Wrong password 5+ times | login is rate limited and the account is locked for a while |
| 16 | Look at `jyocancook.com` files in File Manager | no file changed outside `public_html/staging` |

## 9. Behaviour to know

* **Publishing is all-or-nothing.** Pages are generated into a private area first, then swapped in with a backup. If anything fails, the previous pages are restored and the admin shows an error; it never reports success for a failed publish. When a save succeeds but the pages cannot be updated, the message says "saved, but the public site could not be updated ... The public site was not changed; use Publish to try again."
* **Only generated routes change.** `index.html`, `404.html`, `recipes/`, `category/`, `tag/`, `search/`, `about/`, `search-index.json` and the sitemap files are regenerated. Routes that no longer have a recipe, category or tag are removed. The admin UI, `_astro/`, `styles/`, `images/`, `api/` and `.htaccess` are never touched. The old Astro `pagefind/` search folder is removed on the first publish because the PHP search page uses `search-index.json`.
* **Drafts are never public.** Unpublished recipes get no page, listing, search entry or sitemap entry. A photo uploaded for a draft is stored in `images/recipes/` and can be opened by anyone who knows its file name until the recipe is deleted; it is not linked anywhere.
* **Lock.** Two publishes cannot run at once; the second gets "another publish is running, try again".
* **Production is separate.** `npm run package:production` builds the live packages (`public_html.zip` into `public_html/`, `backend.zip` into `backend-production/`). See `docs/HOSTINGER_PRODUCTION.md`. It never touches `public_html/staging/` or `backend-staging/`.

## 10. What was and was not tested before upload

* The packaging, ZIP layout and secret scan are tested in Node.
* The PHP gateway, authentication, CSRF, backend resolution, host guard, path checks and static publishing were run with real PHP 8.3 compiled to WebAssembly and **SQLite standing in for MySQL**. That is not Hostinger's PHP or MySQL.
* **Not covered locally:** MySQL-only SQL (`ON DUPLICATE KEY UPDATE` when saving categories/menu, `INSERT IGNORE` in the migration), Hostinger's Apache and hPanel password protection, file permissions and the real hPanel/SSH behaviour. Test those on staging with section 8.
