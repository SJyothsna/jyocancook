# JyoCanCook — Hostinger Native Deployment Guide

This guide walks you through hosting JyoCanCook's admin portal and static website directly on **Hostinger** (using PHP 8.1+ and MySQL), allowing you to publish recipes that generate live static HTML pages instantly without GitHub commits or Cloudflare build triggers.

> For the staging site, follow [`HOSTINGER_STAGING.md`](HOSTINGER_STAGING.md). Packages are built with `npm run package:staging` (Node.js only).
>
> For the production site (jyocancook.com), follow [`HOSTINGER_PRODUCTION.md`](HOSTINGER_PRODUCTION.md): it has the exact build commands, the order in which the private configuration files are created, and how to deploy later code changes without touching recipes or uploaded photos. This page is only a general overview.
>
> `/home/u123456789/backend` below is shown at the account root for illustration. The API never guesses where the backend is: `public_html/api/config.local.php` must contain `'backend_path'` (absolute path to the private `backend` folder) and `'environment' => 'production'`. See "Tell the API where its backend is" in `HOSTINGER_STAGING.md`; production works the same way with `backend/` instead of `backend-staging/`.
>
> The sample values below are placeholders only. Never commit or share the real values.

---

## 1. Hostinger Directory Structure

On your Hostinger hosting account (via hPanel File Manager or SSH/FTP), place the files in this structure:

```
/home/u123456789/
├── backend/                       <-- Private (Outside public_html)
│   ├── auth/
│   │   └── Auth.php
│   ├── config/
│   │   ├── config.php
│   │   └── config.local.php       <-- Store your MySQL credentials here!
│   ├── db/
│   │   ├── schema.sql
│   │   └── migrate.php
│   ├── generator/
│   │   ├── SiteGenerator.php
│   │   ├── TemplateRenderer.php
│   │   └── generate.php
│   ├── services/
│   │   ├── RecipeService.php
│   │   ├── ConfigService.php
│   │   └── ImageService.php
│   └── tmp/                       <-- Staging and lock files (auto-created)
│
└── public_html/                   <-- Public Web Root
    ├── .htaccess                  <-- URL routing, caching & security rules
    ├── index.html                 <-- Static Homepage
    ├── 404.html                   <-- Custom 404 page
    ├── sitemap-index.xml          <-- Google Sitemap
    ├── sitemap-0.xml
    ├── search-index.json          <-- Instant client search index
    ├── about/
    │   └── index.html
    ├── search/
    │   └── index.html
    ├── recipes/
    │   ├── index.html
    │   ├── andhra-chicken-curry/
    │   │   └── index.html
    │   └── [recipe-slug]/
    │       └── index.html
    ├── category/
    │   └── [category-slug]/
    │       └── index.html
    ├── tag/
    │   └── [tag-slug]/
    │       └── index.html
    ├── admin/
    │   └── index.html             <-- Admin dashboard UI
    ├── api/
    │   ├── .htaccess
    │   └── index.php              <-- PHP API gateway
    ├── images/
    │   ├── recipes/               <-- Persistent photo uploads
    │   └── categories/
    └── styles/
        └── global.css
```

---

## 2. Database Setup (Hostinger hPanel)

1. Log in to your **Hostinger hPanel**.
2. Navigate to **Databases** → **Management**.
3. Create a new MySQL database:
   - **Database Name:** e.g. `u123456789_jyocancook`
   - **Username:** e.g. `u123456789_admin`
   - **Password:** A strong, random password.
4. Open **phpMyAdmin** for your new database.
5. Click **Import** and upload [`backend/db/schema.sql`](backend/db/schema.sql).

---

## 3. Configure Database Credentials

In `/home/u123456789/backend/config/config.local.php`, configure your database credentials:

```php
<?php
return [
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'u123456789_jyocancook',
        'user' => 'u123456789_admin',
        'pass' => 'REPLACE_DB_PASSWORD',
        'charset' => 'utf8mb4',
    ],
    'site' => [
        'url' => 'https://jyocancook.com',
        'environment' => 'production',
        'allowed_hosts' => ['jyocancook.com', 'www.jyocancook.com'],
        'public_path' => '/home/u123456789/public_html',
        'upload_path' => '/home/u123456789/public_html/images/recipes',
    ],
    'auth' => [
        'session_secret' => 'REPLACE_WITH_64_HEX_CHARS',
    ],
];
```

---

## 4. Run Migration (Import Existing Recipes)

To import all existing recipes, categories, tags, and navigation menus from the repository into MySQL, run via SSH:

```bash
php backend/db/migrate.php
```

`migrate.php` is safe to re-run: it creates missing tables and adds missing content through `backend/db/import-content.php`, and never overwrites recipes, categories, tags or the menu edited in the admin. The import can also be run alone (`php backend/db/import-content.php --dry-run`, then without `--dry-run`).

The migration does not create any admin account. Create the initial admin interactively (password is hidden and only its hash is stored):

```bash
php backend/db/create-admin.php
```

---

## 5. Generate Static Website Content

To perform the initial full-site static build, run:

```bash
php backend/generator/generate.php
```

All static pages (`index.html`, `/recipes/[slug]/index.html`, `/category/[slug]/index.html`, etc.) will be compiled and placed in `public_html/`.

---

## 6. Daily Usage in `/admin/`

1. Go to `https://jyocancook.com/admin/` in your browser.
2. Log in with your admin credentials.
3. When you create, edit, or publish a recipe:
   - The recipe is saved to MySQL.
   - The PHP static generator runs **immediately** in the background.
   - The updated HTML is placed live on the site in **under 100ms**.
   - No GitHub commits, Cloudflare deployments, or Node builds needed!
