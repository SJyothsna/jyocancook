import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Hostinger Native PHP Backend & Static Publisher Architecture', () => {
  const rootDir = path.resolve(__dirname, '..');

  describe('File Structure & Module Verification', () => {
    const requiredFiles = [
      'backend/config/config.php',
      'backend/config/database.php',
      'backend/db/schema.sql',
      'backend/db/migrate.php',
      'backend/auth/Auth.php',
      'backend/services/RecipeService.php',
      'backend/services/ConfigService.php',
      'backend/services/ImageService.php',
      'backend/generator/TemplateRenderer.php',
      'backend/generator/SiteGenerator.php',
      'backend/generator/generate.php',
      'api/index.php',
      'api/.htaccess',
      'public/.htaccess',
      'bin/package-hostinger.mjs',
      'backend/db/create-admin.php',
      'docs/HOSTINGER_DEPLOYMENT.md',
    ];

    for (const relFile of requiredFiles) {
      it(`should contain valid file: ${relFile}`, () => {
        const fullPath = path.join(rootDir, relFile);
        assert.ok(fs.existsSync(fullPath), `File missing: ${relFile}`);
        const content = fs.readFileSync(fullPath, 'utf-8');
        assert.ok(content.length > 20, `File ${relFile} should not be empty`);
      });
    }
  });

  describe('MySQL Database Schema Validation', () => {
    const schemaSql = fs.readFileSync(path.join(rootDir, 'backend/db/schema.sql'), 'utf-8');

    it('should define all required relational tables', () => {
      const requiredTables = [
        'admins',
        'categories',
        'tags',
        'menu_items',
        'recipes',
        'recipe_ingredients',
        'recipe_steps',
        'recipe_tags',
        'publish_logs',
        'login_attempts',
      ];

      for (const table of requiredTables) {
        assert.ok(
          schemaSql.includes(`CREATE TABLE IF NOT EXISTS \`${table}\``),
          `Schema must define table: ${table}`
        );
      }
    });

    it('should have foreign keys with ON DELETE CASCADE for ingredients, steps and tags', () => {
      assert.ok(schemaSql.includes('FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE'));
      assert.ok(schemaSql.includes('FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE'));
    });

    it('should include story, nutrition, and indexes in recipes table', () => {
      assert.ok(schemaSql.includes('`story` TEXT NULL'));
      assert.ok(schemaSql.includes('`calories` INT UNSIGNED NULL'));
      assert.ok(schemaSql.includes('`carbs` DECIMAL(6,1) NULL'));
      assert.ok(schemaSql.includes('`protein` DECIMAL(6,1) NULL'));
      assert.ok(schemaSql.includes('`fat` DECIMAL(6,1) NULL'));
      assert.ok(schemaSql.includes('`fiber` DECIMAL(6,1) NULL'));
      assert.ok(schemaSql.includes('`youtube_url` VARCHAR(300) NULL'));
    });
  });

  describe('Security & Authorization Rules', () => {
    const authCode = fs.readFileSync(path.join(rootDir, 'backend/auth/Auth.php'), 'utf-8');
    const imageServiceCode = fs.readFileSync(path.join(rootDir, 'backend/services/ImageService.php'), 'utf-8');
    const rootHtaccess = fs.readFileSync(path.join(rootDir, 'public/.htaccess'), 'utf-8');

    it('should use password_verify and password_hash with secure cookies and CSRF tokens', () => {
      assert.ok(authCode.includes('password_verify('));
      assert.ok(authCode.includes('session_regenerate_id(true)'));
      assert.ok(authCode.includes("'httponly' => true"));
      assert.ok(authCode.includes("'samesite' => 'Lax'"));
      assert.ok(authCode.includes('random_bytes(32)'));
      assert.ok(authCode.includes('hash_equals('));
    });

    it('should enforce rate limiting on failed login attempts', () => {
      assert.ok(authCode.includes('login_attempts'));
      assert.ok(authCode.includes('rate_limit_lockout_seconds'));
      assert.ok(authCode.includes('rate_limit_max_attempts'));
    });

    it('should restrict file uploads by MIME, size and block script execution', () => {
      assert.ok(imageServiceCode.includes('image/jpeg'));
      assert.ok(imageServiceCode.includes('image/png'));
      assert.ok(imageServiceCode.includes('image/webp'));
      assert.ok(!imageServiceCode.includes('image/svg+xml'), 'SVG uploads must not be allowed');
      assert.ok(imageServiceCode.includes('Deny from all'));
      assert.ok(imageServiceCode.includes('Options -ExecCGI -Indexes'));
    });

    it('should set security headers in public_html .htaccess', () => {
      assert.ok(rootHtaccess.includes('X-Content-Type-Options "nosniff"'));
      assert.ok(rootHtaccess.includes('X-Frame-Options "SAMEORIGIN"'));
      assert.ok(rootHtaccess.includes('X-XSS-Protection "1; mode=block"'));
      assert.ok(rootHtaccess.includes('Options -Indexes'));
    });
  });

  describe('Static Site Generator & Template Consistency', () => {
    const rendererCode = fs.readFileSync(path.join(rootDir, 'backend/generator/TemplateRenderer.php'), 'utf-8');
    const generatorCode = fs.readFileSync(path.join(rootDir, 'backend/generator/SiteGenerator.php'), 'utf-8');

    it('should render Schema.org Recipe JSON-LD and HowToStep structured data', () => {
      assert.ok(rendererCode.includes("'@type' => 'Recipe'") || rendererCode.includes('"@type": "Recipe"'));
      assert.ok(rendererCode.includes('HowToStep'));
      assert.ok(rendererCode.includes('NutritionInformation'));
    });

    it('should support YouTube embeds, compact metadata, nutrition row, and story callout', () => {
      assert.ok(rendererCode.includes('video-container'));
      assert.ok(rendererCode.includes('meta-strip'));
      assert.ok(rendererCode.includes('nutrition-strip'));
      assert.ok(rendererCode.includes('recipe-story-panel'));
      assert.ok(rendererCode.includes('Story &amp; Background'));
    });

    it('should render both You Might Also Like and Latest Recipes in sidebar', () => {
      assert.ok(rendererCode.includes('You Might Also Like'));
      assert.ok(rendererCode.includes('Latest Recipes'));
      assert.ok(rendererCode.includes('sidebar-recipe-list'));
    });

    it('should use concurrency locks, staging builds, and clean up stale routes', () => {
      assert.ok(generatorCode.includes('publish.lock'));
      assert.ok(generatorCode.includes('staging'));
      assert.ok(generatorCode.includes('findStaleRoutes'));
      assert.ok(generatorCode.includes('search-index.json'));
      assert.ok(generatorCode.includes('sitemap-index.xml'));
    });
  });

  describe('Hostinger Packaging', () => {
    const apiCode = fs.readFileSync(path.join(rootDir, 'api/index.php'), 'utf-8');
    const packageCode = fs.readFileSync(path.join(rootDir, 'bin/package-hostinger.mjs'), 'utf-8');
    const migrateCode = fs.readFileSync(path.join(rootDir, 'backend/db/migrate.php'), 'utf-8');
    const configCode = fs.readFileSync(path.join(rootDir, 'backend/config/config.php'), 'utf-8');
    const createAdminCode = fs.readFileSync(path.join(rootDir, 'backend/db/create-admin.php'), 'utf-8');

    it('should locate the backend only through an explicit, validated path (no guessed fallback)', () => {
      assert.ok(apiCode.includes('JYOCANCOOK_BACKEND_PATH'));
      assert.ok(apiCode.includes('resolveBackend('));
      assert.ok(!/dirname\(__DIR__(, ?\d)?\) \. '\/backend/.test(apiCode), 'no hardcoded backend location');
    });

    it('should ship global.css and replace Astro api stubs with the PHP gateway', () => {
      assert.ok(packageCode.includes("'styles/global.css'"));
      assert.ok(packageCode.includes("rel === 'api'"));
    });

    it('should not hardcode an admin password or session secret', () => {
      assert.ok(!migrateCode.includes('JyoCanCook@2026'));
      assert.ok(!migrateCode.includes('password_hash('));
      assert.ok(!configCode.includes('jyo-secret-salt'));
    });

    it('should create the initial admin only through a CLI prompt that hashes the password', () => {
      assert.ok(createAdminCode.includes("php_sapi_name() !== 'cli'"));
      assert.ok(createAdminCode.includes('password_hash('));
      assert.ok(createAdminCode.includes('stty -echo'));
    });
  });
});
