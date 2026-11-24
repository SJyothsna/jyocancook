<?php
declare(strict_types=1);

/**
 * JyoCanCook Safe Static Site Generator
 *
 * Renders the whole public site from MySQL into a private staging directory first, then swaps it
 * into the publish target in a single all-or-nothing step:
 *   1. every new file is copied next to its destination under a temporary name (live files untouched);
 *   2. the previous version of each replaced file is saved to a private backup directory;
 *   3. the temporary files are renamed into place and stale routes (deleted / unpublished recipes,
 *      removed categories and tags, the Astro-built search index) are moved to the backup directory.
 * Any failure restores the backup and is re-thrown, so a failed publish never leaves a half-updated
 * site and is never reported as success.
 *
 * The publish target is validated by PathGuard: a staging backend can only write inside
 * ".../public_html/staging", a production backend only inside ".../public_html" and only the
 * routes it generates are touched, so staging runs never modify production files.
 */

require_once dirname(__DIR__) . '/config/database.php';
require_once dirname(__DIR__) . '/services/PathGuard.php';
require_once dirname(__DIR__) . '/services/RecipeService.php';
require_once dirname(__DIR__) . '/services/ConfigService.php';
require_once __DIR__ . '/TemplateRenderer.php';

class SiteGenerator {
    private PDO $pdo;
    private RecipeService $recipeService;
    private ConfigService $configService;
    private TemplateRenderer $renderer;
    private array $config;
    private string $lockFile;
    private string $stagingDir;
    private string $backupDir;
    private string $targetDir;
    private string $siteUrl;

    public function __construct(?PDO $pdo = null, ?array $appConfig = null) {
        if ($appConfig === null) {
            $appConfig = require dirname(__DIR__) . '/config/config.php';
        }
        $this->config = $appConfig;

        // Validate the write target before anything else touches the filesystem or the database.
        $this->targetDir = PathGuard::assertPublishTarget($appConfig['site'], dirname(__DIR__));

        $this->pdo = $pdo ?? Database::getConnection();
        $this->recipeService = new RecipeService($this->pdo);
        $this->configService = new ConfigService($this->pdo);
        $this->renderer = new TemplateRenderer();

        $this->siteUrl = rtrim($appConfig['site']['url'], '/');
        $this->lockFile = $appConfig['generator']['lock_file'] ?? dirname(__DIR__) . '/tmp/publish.lock';
        $this->stagingDir = $appConfig['generator']['staging_dir'] ?? dirname(__DIR__) . '/tmp/staging';
        $this->backupDir = $appConfig['generator']['backup_dir'] ?? dirname(__DIR__) . '/tmp/backup';

        $this->ensureDirectories();
    }

    private function ensureDirectories(): void {
        $dirs = [dirname($this->lockFile), $this->stagingDir, $this->backupDir];
        // Only local development may create the target; servers must point at an existing directory.
        if (($this->config['site']['environment'] ?? 'development') === 'development') {
            $dirs[] = $this->targetDir;
        }
        foreach ($dirs as $dir) {
            if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
                throw new RuntimeException('Failed to create a required working directory');
            }
        }
    }

    public function generateFullSite(string $triggeredBy = 'admin'): array {
        $lockHandle = fopen($this->lockFile, 'w+');
        if (!$lockHandle || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
            throw new RuntimeException('Another publishing process is already in progress. Please wait a moment.', 409);
        }

        $logId = null;
        $startTime = microtime(true);
        $stats = [
            'recipes_count' => 0,
            'categories_count' => 0,
            'tags_count' => 0,
            'pages_generated' => 0,
            'duration_ms' => 0,
            'clean_urls' => [],
        ];

        try {
            $logId = $this->startPublishLog($triggeredBy);

            // Clean staging directory
            $this->cleanDirectory($this->stagingDir);

            // Only published recipes are ever rendered: drafts never reach any page, listing,
            // search index or sitemap.
            $publishedRecipes = $this->recipeService->getAllRecipes(true);
            $categories = $this->configService->getCategories();
            $tags = $this->configService->getTags();
            $subcategories = $this->configService->getSubcategories();
            $diets = $this->configService->getDiets();
            $dietSlugs = array_column($diets, 'slug');
            $this->renderer->setNavMenu($this->configService->getMenu());

            if (!$publishedRecipes && !$categories) {
                // An unseeded database would otherwise replace the whole site with empty pages.
                throw new RuntimeException('The database has no categories or recipes yet. Run backend/db/migrate.php first. The public site was not changed.', 409);
            }

            $stats['recipes_count'] = count($publishedRecipes);
            $stats['categories_count'] = count($categories);
            $stats['tags_count'] = count($tags);

            $sitemapUrls = [];

            // 1. Homepage (/)
            $homeHtml = $this->renderer->renderHomePage($publishedRecipes, $categories, $subcategories);
            $this->writeStagedFile('index.html', $homeHtml);
            $sitemapUrls[] = ['loc' => $this->siteUrl . '/', 'changefreq' => 'daily', 'priority' => '1.0'];
            $stats['pages_generated']++;

            // 2. All Recipes Catalog (/recipes/)
            $recipesCatalogHtml = $this->renderer->renderRecipesIndexPage($publishedRecipes, $categories, $tags, $subcategories, $diets);
            $this->writeStagedFile('recipes/index.html', $recipesCatalogHtml);
            $sitemapUrls[] = ['loc' => $this->siteUrl . '/recipes/', 'changefreq' => 'daily', 'priority' => '0.9'];
            $stats['pages_generated']++;

            // 3. Search Page (/search/)
            $searchHtml = $this->renderer->renderSearchPage();
            $this->writeStagedFile('search/index.html', $searchHtml);
            $stats['pages_generated']++;

            // 4. About Page (/about/)
            $aboutHtml = $this->renderer->renderAboutPage();
            $this->writeStagedFile('about/index.html', $aboutHtml);
            $sitemapUrls[] = ['loc' => $this->siteUrl . '/about/', 'changefreq' => 'monthly', 'priority' => '0.5'];
            $stats['pages_generated']++;

            // 5. 404 Page (/404.html)
            $notFoundHtml = $this->renderer->render404Page();
            $this->writeStagedFile('404.html', $notFoundHtml);
            $stats['pages_generated']++;

            // 6. Individual Recipe Pages (/recipes/[slug]/)
            $activeRecipeSlugs = [];
            foreach ($publishedRecipes as $recipe) {
                $slug = $this->assertSafeSlug((string)$recipe['slug'], 'recipe');
                $activeRecipeSlugs[] = $slug;
                $recipeHtml = $this->renderer->renderRecipePage($recipe, $publishedRecipes, $categories);
                $this->writeStagedFile("recipes/{$slug}/index.html", $recipeHtml);
                $sitemapUrls[] = ['loc' => $this->siteUrl . "/recipes/{$slug}/", 'changefreq' => 'weekly', 'priority' => '0.8'];
                $stats['pages_generated']++;
                $stats['clean_urls'][] = "/recipes/{$slug}/";
            }

            // 7. Category Pages (/category/[slug]/)
            $activeCategorySlugs = [];
            foreach ($categories as $cat) {
                $cSlug = $this->assertSafeSlug((string)$cat['slug'], 'category');
                $activeCategorySlugs[] = $cSlug;
                $catRecipes = $this->recipeService->getRecipesByCategory($cSlug, true);
                $catHtml = $this->renderer->renderCategoryPage($cat, $catRecipes, $categories, $subcategories, $dietSlugs);
                $this->writeStagedFile("category/{$cSlug}/index.html", $catHtml);
                $sitemapUrls[] = ['loc' => $this->siteUrl . "/category/{$cSlug}/", 'changefreq' => 'weekly', 'priority' => '0.7'];
                $stats['pages_generated']++;
            }

            // 7b. Diet pages (Diets tab in the admin). /category/<diet slug>/ lists the recipes of
            //     that diet, so each diet is published even when no category has that slug
            //     (diets are not categories).
            foreach ($diets as $diet) {
                $dSlug = $this->assertSafeSlug((string)$diet['slug'], 'diet');
                if (in_array($dSlug, $activeCategorySlugs, true)) continue;
                $activeCategorySlugs[] = $dSlug;
                $dietPage = ['slug' => $dSlug, 'name' => $diet['name'], 'description' => $diet['name'] . ' recipes', 'image' => ''];
                $dietRecipes = $this->recipeService->getRecipesByCategory($dSlug, true);
                $this->writeStagedFile("category/{$dSlug}/index.html", $this->renderer->renderCategoryPage($dietPage, $dietRecipes, $categories, $subcategories, $dietSlugs));
                $sitemapUrls[] = ['loc' => $this->siteUrl . "/category/{$dSlug}/", 'changefreq' => 'weekly', 'priority' => '0.7'];
                $stats['pages_generated']++;
            }

            // 8. Tag Pages (/tag/[slug]/)
            $activeTagSlugs = [];
            foreach ($tags as $tagName) {
                $tSlug = $this->assertSafeSlug(strtolower(preg_replace('/[^a-z0-9]+/i', '-', $tagName)), 'tag');
                $activeTagSlugs[] = $tSlug;
                $tagRecipes = $this->recipeService->getRecipesByTag($tagName, true);
                $tagHtml = $this->renderer->renderTagPage($tagName, $tagRecipes);
                $this->writeStagedFile("tag/{$tSlug}/index.html", $tagHtml);
                $sitemapUrls[] = ['loc' => $this->siteUrl . "/tag/{$tSlug}/", 'changefreq' => 'weekly', 'priority' => '0.6'];
                $stats['pages_generated']++;
            }

            // 9. Lightweight Search Index (search-index.json)
            $searchIndex = [];
            foreach ($publishedRecipes as $r) {
                $searchIndex[] = [
                    'title' => $r['title'],
                    'slug' => $r['slug'],
                    'url' => '/recipes/' . $r['slug'] . '/',
                    'description' => $r['description'] ?? '',
                    'category' => $r['category_name'] ?? $r['category'],
                    'diet' => $r['diet'] ?? 'Vegetarian',
                    'tags' => $r['tags'] ?? [],
                    'ingredients' => array_column($r['ingredients'] ?? [], 'name'),
                    'image' => $r['image'] ?? '/images/recipes/recipe-placeholder.svg',
                    'prepTime' => $r['prepTime'] ?? 15,
                    'cookTime' => $r['cookTime'] ?? 30,
                ];
            }
            $this->writeStagedFile('search-index.json', json_encode($searchIndex, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

            // 10. Sitemap XML
            $sitemapXml = $this->generateSitemapXml($sitemapUrls);
            $this->writeStagedFile('sitemap-0.xml', $sitemapXml);
            $sitemapIndexXml = $this->generateSitemapIndexXml();
            $this->writeStagedFile('sitemap-index.xml', $sitemapIndexXml);

            // 11. All-or-nothing swap into the publish target. Static assets (CSS, images, icons,
            //     .htaccess) are shipped by the deployment package and are never copied or touched here.
            $stale = $this->findStaleRoutes($activeRecipeSlugs, $activeCategorySlugs, $activeTagSlugs);
            $this->publishToTarget($stale);

            $stats['duration_ms'] = (int)((microtime(true) - $startTime) * 1000);
            $this->finishPublishLog($logId, 'success', 'Site regenerated successfully in ' . $stats['duration_ms'] . 'ms', $stats);

            return [
                'ok' => true,
                'message' => 'Website successfully published and updated!',
                'stats' => $stats,
            ];
        } catch (Throwable $e) {
            $stats['duration_ms'] = (int)((microtime(true) - $startTime) * 1000);
            if ($logId !== null) {
                try {
                    $this->finishPublishLog($logId, 'failed', $e->getMessage(), ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
                } catch (Throwable) {
                    // Never let log bookkeeping hide the real failure.
                }
            }
            throw $e;
        } finally {
            flock($lockHandle, LOCK_UN);
            fclose($lockHandle);
        }
    }

    /** Slugs become directory names: only lowercase letters, digits and hyphens (no dots or slashes). */
    private function assertSafeSlug(string $slug, string $kind): string {
        if (!preg_match('/^[a-z0-9-]{1,100}$/', $slug)) {
            throw new RuntimeException("Refusing to publish: invalid {$kind} slug");
        }
        return $slug;
    }

    private function writeStagedFile(string $relativePath, string $content): void {
        $fullPath = $this->stagingDir . '/' . ltrim($relativePath, '/\\');
        $dir = dirname($fullPath);
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new RuntimeException("Failed to create staging directory for: {$relativePath}");
        }

        if (file_put_contents($fullPath, $content) === false) {
            throw new RuntimeException("Failed to write staged file: {$relativePath}");
        }
    }

    /**
     * Generated route folders in the target that no longer correspond to published content.
     * Only recipes/, category/ and tag/ children (plus the obsolete Astro Pagefind index, which
     * still holds the text of recipes it was built from) are ever considered.
     *
     * @return string[] paths relative to the target
     */
    private function findStaleRoutes(array $activeRecipeSlugs, array $activeCategorySlugs, array $activeTagSlugs): array {
        $stale = [];
        $groups = ['recipes' => $activeRecipeSlugs, 'category' => $activeCategorySlugs, 'tag' => $activeTagSlugs];
        foreach ($groups as $group => $active) {
            $base = $this->targetDir . '/' . $group;
            if (!is_dir($base)) {
                continue;
            }
            foreach (scandir($base) ?: [] as $entry) {
                if ($entry === '.' || $entry === '..') continue;
                if (is_dir($base . '/' . $entry) && !in_array($entry, $active, true)) {
                    $stale[] = $group . '/' . $entry;
                }
            }
        }
        if (is_dir($this->targetDir . '/pagefind')) {
            $stale[] = 'pagefind';
        }
        return $stale;
    }

    /**
     * Copies the staged site into the target atomically. See the class comment for the phases.
     *
     * @param string[] $stale
     */
    private function publishToTarget(array $stale): void {
        $runId = gmdate('YmdHis') . '-' . bin2hex(random_bytes(4));
        $runDir = $this->backupDir . '/' . $runId;
        $suffix = '.jyo-new-' . $runId;
        $files = $this->listFiles($this->stagingDir);

        $temps = [];       // rel => temporary file still waiting to be renamed
        $committed = [];   // rel => whether an original was backed up (false: file is new)
        $retired = [];     // stale paths moved into the backup directory
        $createdDirs = [];

        try {
            // Phase 1: stage every file next to its destination; live files are untouched.
            foreach ($files as $rel) {
                $dest = $this->targetDir . '/' . $rel;
                $this->ensureDir(dirname($dest), $createdDirs);
                $tmp = $dest . $suffix;
                $temps[$rel] = $tmp;
                $this->copyFile($this->stagingDir . '/' . $rel, $tmp);
            }

            // Phase 2: back up originals and swap the new files in.
            foreach ($files as $rel) {
                $dest = $this->targetDir . '/' . $rel;
                $hadOriginal = is_file($dest);
                if ($hadOriginal) {
                    $this->copyFile($dest, $runDir . '/files/' . $rel);
                }
                if (!rename($temps[$rel], $dest)) {
                    throw new RuntimeException("Failed to put {$rel} in place");
                }
                unset($temps[$rel]);
                $committed[$rel] = $hadOriginal;
            }

            // Phase 3: retire routes that no longer exist (kept in the backup until success).
            foreach ($stale as $rel) {
                $this->movePath($this->targetDir . '/' . $rel, $runDir . '/stale/' . $rel);
                $retired[] = $rel;
            }
        } catch (Throwable $e) {
            $restored = $this->rollback($runDir, $temps, $committed, $retired, $createdDirs);
            throw new RuntimeException(
                'Publishing failed and ' . ($restored ? 'the previous site was restored: ' : 'the previous site could NOT be fully restored (backup kept in backend/tmp/backup): ') . $e->getMessage(),
                0,
                $e
            );
        }

        $this->deleteRecursive($runDir);
    }

    private function rollback(string $runDir, array $temps, array $committed, array $retired, array $createdDirs): bool {
        $ok = true;
        foreach ($temps as $tmp) {
            if (is_file($tmp) && !@unlink($tmp)) $ok = false;
        }
        foreach (array_reverse($retired) as $rel) {
            try {
                $this->movePath($runDir . '/stale/' . $rel, $this->targetDir . '/' . $rel);
            } catch (Throwable) {
                $ok = false;
            }
        }
        foreach (array_reverse($committed, true) as $rel => $hadOriginal) {
            $dest = $this->targetDir . '/' . $rel;
            try {
                if ($hadOriginal) {
                    $this->copyFile($runDir . '/files/' . $rel, $dest);
                } elseif (is_file($dest) && !@unlink($dest)) {
                    $ok = false;
                }
            } catch (Throwable) {
                $ok = false;
            }
        }
        foreach (array_reverse($createdDirs) as $dir) {
            @rmdir($dir); // only succeeds when empty
        }
        if ($ok) {
            $this->deleteRecursive($runDir);
        }
        return $ok;
    }

    /** @return string[] relative file paths (forward slashes) */
    private function listFiles(string $dir): array {
        $out = [];
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            if ($file->isFile()) {
                $out[] = str_replace('\\', '/', $it->getSubPathname());
            }
        }
        sort($out);
        return $out;
    }

    private function ensureDir(string $dir, array &$created): void {
        if (is_dir($dir)) {
            return;
        }
        $parent = dirname($dir);
        if ($parent !== $dir) {
            $this->ensureDir($parent, $created);
        }
        if (!mkdir($dir, 0755) && !is_dir($dir)) {
            throw new RuntimeException('Failed to create a target directory');
        }
        $created[] = $dir;
    }

    private function copyFile(string $src, string $dst): void {
        $dir = dirname($dst);
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new RuntimeException('Failed to create a directory for ' . basename($dst));
        }
        if (!copy($src, $dst) || filesize($src) !== filesize($dst)) {
            @unlink($dst);
            throw new RuntimeException('Failed to copy ' . basename($src));
        }
    }

    /**
     * Moves a file or folder by copying, then deleting the original. rename() is deliberately not
     * used: the backup folder and the web root can be on different filesystems, where it is not
     * reliable. Throws on failure.
     */
    private function movePath(string $from, string $to): void {
        $dir = dirname($to);
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new RuntimeException('Failed to create a backup directory');
        }
        if (is_dir($from)) {
            $this->copyTree($from, $to);
            $this->deleteRecursive($from);
            if (is_dir($from)) {
                throw new RuntimeException('Failed to remove ' . basename($from));
            }

        } else {
            $this->copyFile($from, $to);
            if (!unlink($from)) {
                throw new RuntimeException('Failed to remove ' . basename($from));
            }
        }
    }

    private function copyTree(string $src, string $dst): void {
        if (!is_dir($dst) && !mkdir($dst, 0755, true) && !is_dir($dst)) {
            throw new RuntimeException('Failed to create a backup directory');
        }
        foreach (scandir($src) ?: [] as $name) {
            if ($name === '.' || $name === '..') continue;
            $s = $src . '/' . $name;
            if (is_dir($s)) {
                $this->copyTree($s, $dst . '/' . $name);
            } else {
                $this->copyFile($s, $dst . '/' . $name);
            }
        }
    }

    private function generateSitemapXml(array $urls): string {
        $xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
        $xml .= "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
        foreach ($urls as $u) {
            $xml .= "  <url>\n";
            $xml .= "    <loc>" . htmlspecialchars($u['loc'], ENT_XML1, 'UTF-8') . "</loc>\n";
            $xml .= "    <changefreq>" . ($u['changefreq'] ?? 'weekly') . "</changefreq>\n";
            $xml .= "    <priority>" . ($u['priority'] ?? '0.5') . "</priority>\n";
            $xml .= "  </url>\n";
        }
        $xml .= "</urlset>\n";
        return $xml;
    }

    private function generateSitemapIndexXml(): string {
        $xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
        $xml .= "<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
        $xml .= "  <sitemap>\n";
        $xml .= "    <loc>" . htmlspecialchars($this->siteUrl . '/sitemap-0.xml', ENT_XML1, 'UTF-8') . "</loc>\n";
        $xml .= "  </sitemap>\n";
        $xml .= "</sitemapindex>\n";
        return $xml;
    }

    private function startPublishLog(string $triggeredBy): int {
        $stmt = $this->pdo->prepare("
            INSERT INTO `publish_logs` (`status`, `triggered_by`, `message`, `started_at`)
            VALUES ('in_progress', :triggered_by, 'Publishing site...', NOW())
        ");
        $stmt->execute([':triggered_by' => $triggeredBy]);
        return (int)$this->pdo->lastInsertId();
    }

    private function finishPublishLog(int $logId, string $status, string $message, array $details): void {
        $stmt = $this->pdo->prepare("
            UPDATE `publish_logs` SET
                `status` = :status,
                `message` = :message,
                `details_json` = :details,
                `completed_at` = NOW()
            WHERE `id` = :id
        ");
        $stmt->execute([
            ':status' => $status,
            ':message' => substr($message, 0, 255),
            ':details' => json_encode($details, JSON_UNESCAPED_UNICODE),
            ':id' => $logId,
        ]);
    }

    private function cleanDirectory(string $dir): void {
        if (!is_dir($dir)) return;
        $items = scandir($dir);
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $path = $dir . '/' . $item;
            if (is_dir($path)) {
                $this->deleteRecursive($path);
            } else {
                unlink($path);
            }
        }
    }

    private function deleteRecursive(string $dir): void {
        if (!is_dir($dir)) return;
        $items = scandir($dir);
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $path = $dir . '/' . $item;
            if (is_dir($path)) {
                $this->deleteRecursive($path);
            } else {
                unlink($path);
            }
        }
        rmdir($dir);
    }
}
