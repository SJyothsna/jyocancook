<?php
declare(strict_types=1);

/**
 * JyoCanCook content import: existing recipes, categories, tags and menu -> MySQL.
 *
 * Usage (over SSH, from the folder that contains backend-staging/):
 *   php backend-staging/db/import-content.php [--dry-run] [--seed=/absolute/path/to/seed]
 *
 * The content comes from the JSON files shipped in <backend>/seed/ (exported from the `main`
 * branch by the packager): seed/config/{categories,tags,menu}.json and seed/recipes/*.json.
 * Without --seed, <backend>/seed is used; in a development checkout config/ and
 * src/content/recipes/ are read instead.
 *
 * Safe to repeat. The import only ADDS what is missing and never changes anything that exists:
 *   - a category / tag / recipe whose slug (tags: name or slug) is already in the database is skipped,
 *     so edits made in the admin are kept;
 *   - the menu is imported only while the menu table is empty;
 *   - recipes are saved through RecipeService::saveRecipe(), the same code the admin uses, so
 *     ingredients, steps, tags and the category link are stored exactly as the admin stores them.
 * Slugs (and so public URLs such as /recipes/<slug>/) are never rewritten: a recipe whose slug
 * would change is reported as an error and not imported.
 * A recipe deleted in the admin is imported again by the next run.
 *
 * Database credentials come from the existing backend configuration and are never printed.
 */

require_once dirname(__DIR__) . '/config/database.php';
require_once dirname(__DIR__) . '/services/RecipeService.php';

/** Recipe JSON keys that map to MySQL columns / child tables. Any other key is reported. */
const IMPORT_KNOWN_RECIPE_KEYS = [
    'slug', 'title', 'description', 'category', 'subcategories', 'subcategory', 'tags', 'diet', 'prepTime', 'cookTime', 'servings',
    'difficulty', 'image', 'published', 'featured', 'story', 'youtubeUrl', 'nutrition',
    'ingredients', 'steps', 'tips', 'serveWith',
];
const IMPORT_KNOWN_INGREDIENT_KEYS = ['name', 'amount', 'unit', 'section'];
const IMPORT_KNOWN_STEP_KEYS = ['title', 'text', 'image'];

/**
 * @param array{dry_run?: bool, public_path?: ?string} $options
 *        public_path: web root used to check that referenced images exist (null = no check).
 * @return array{source: array<string,int>, created: array<string,int>, skipped: array<string,int>, warnings: list<string>, errors: list<string>}
 */
function importContent(PDO $pdo, string $configDir, string $recipesDir, array $options = []): array {
    $dryRun = !empty($options['dry_run']);
    $publicPath = $options['public_path'] ?? null;
    $result = [
        'source' => ['categories' => 0, 'tags' => 0, 'recipes' => 0, 'menu_items' => 0],
        'created' => ['categories' => 0, 'tags' => 0, 'recipes' => 0, 'menu_items' => 0],
        'skipped' => ['categories' => 0, 'tags' => 0, 'recipes' => 0, 'menu_items' => 0],
        'warnings' => [],
        'errors' => [],
    ];

    $readJson = static function (string $file): ?array {
        if (!is_file($file)) {
            return null;
        }
        $data = json_decode((string)file_get_contents($file), true);
        return is_array($data) ? $data : null;
    };

    // ---- Categories (identified by slug)
    $categories = $readJson($configDir . '/categories.json') ?? [];
    $exists = $pdo->prepare('SELECT COUNT(*) FROM `categories` WHERE `slug` = :slug');
    $insert = $pdo->prepare('INSERT INTO `categories` (`slug`, `name`, `description`, `image`, `order_num`) VALUES (:slug, :name, :description, :image, :order_num)');
    $categorySlugs = [];
    foreach ($categories as $cat) {
        $slug = strtolower(trim((string)($cat['slug'] ?? '')));
        $name = trim((string)($cat['name'] ?? ''));
        $result['source']['categories']++;
        if (!preg_match('/^[a-z0-9-]{1,80}$/', $slug) || $name === '') {
            $result['errors'][] = "category not imported (invalid slug or name): '" . substr($slug, 0, 40) . "'";
            continue;
        }
        $categorySlugs[] = $slug;
        $exists->execute([':slug' => $slug]);
        if ((int)$exists->fetchColumn() > 0) {
            $result['skipped']['categories']++;
            continue;
        }
        if (!$dryRun) {
            try {
                $insert->execute([
                    ':slug' => $slug,
                    ':name' => $name,
                    ':description' => trim((string)($cat['description'] ?? '')),
                    ':image' => trim((string)($cat['image'] ?? '/images/categories/' . $slug . '.svg')),
                    ':order_num' => (int)($cat['order'] ?? 0),
                ]);
            } catch (Throwable $e) {
                $result['errors'][] = "category '{$slug}' not imported: " . $e->getMessage();
                continue;
            }
        }
        $result['created']['categories']++;
    }

    // ---- Recipes (identified by slug), loaded first so their tags can be imported with the tag list
    $recipeFiles = is_dir($recipesDir) ? (glob($recipesDir . '/*.json') ?: []) : [];
    sort($recipeFiles);
    $recipes = [];
    foreach ($recipeFiles as $file) {
        $data = $readJson($file);
        $result['source']['recipes']++;
        if ($data === null || trim((string)($data['title'] ?? '')) === '') {
            $result['errors'][] = 'recipe file not imported (unreadable or no title): ' . basename($file);
            continue;
        }
        $data['slug'] = (string)($data['slug'] ?? basename($file, '.json'));
        $recipes[] = $data;
    }

    // ---- Tags (identified by name, case-insensitive, or slug)
    $tagNames = [];
    foreach (($readJson($configDir . '/tags.json') ?? []) as $name) {
        $tagNames[] = trim((string)$name);
    }
    foreach ($recipes as $data) {
        foreach ((array)($data['tags'] ?? []) as $name) {
            $tagNames[] = trim((string)$name);
        }
    }
    $seenTags = [];
    $findTag = $pdo->prepare('SELECT `id` FROM `tags` WHERE LOWER(`name`) = LOWER(:name) OR `slug` = :slug LIMIT 1');
    $createTag = $pdo->prepare('INSERT INTO `tags` (`name`, `slug`) VALUES (:name, :slug)');
    foreach ($tagNames as $name) {
        $slug = RecipeService::slugify($name);
        if ($name === '' || $slug === '' || isset($seenTags[$slug])) {
            continue;
        }
        $seenTags[$slug] = true;
        $result['source']['tags']++;
        $findTag->execute([':name' => $name, ':slug' => $slug]);
        if ($findTag->fetchColumn()) {
            $result['skipped']['tags']++;
            continue;
        }
        if (!$dryRun) {
            try {
                $createTag->execute([':name' => $name, ':slug' => $slug]);
            } catch (Throwable $e) {
                $result['errors'][] = "tag '{$name}' not imported: " . $e->getMessage();
                continue;
            }
        }
        $result['created']['tags']++;
    }

    // ---- Recipes: category/tag links, ingredients and steps are written by RecipeService
    $service = new RecipeService($pdo);
    $recipeExists = $pdo->prepare('SELECT COUNT(*) FROM `recipes` WHERE `slug` = :slug');
    $dbCategories = $pdo->query('SELECT `slug` FROM `categories`')->fetchAll(PDO::FETCH_COLUMN);
    $knownCategories = array_values(array_unique(array_merge($dbCategories, $categorySlugs)));
    foreach ($recipes as $data) {
        $slug = $data['slug'];
        if (RecipeService::slugify($slug) !== $slug) {
            $result['errors'][] = "recipe '" . substr($slug, 0, 60) . "' not imported: the admin would change its slug (" . RecipeService::slugify($slug) . '), which would change its public URL';
            continue;
        }
        $recipeExists->execute([':slug' => $slug]);
        if ((int)$recipeExists->fetchColumn() > 0) {
            $result['skipped']['recipes']++;
            continue;
        }

        foreach (array_diff(array_keys($data), IMPORT_KNOWN_RECIPE_KEYS) as $key) {
            $result['warnings'][] = "{$slug}: field '{$key}' has no MySQL column and was not imported";
        }
        foreach ((array)($data['ingredients'] ?? []) as $ing) {
            foreach (array_diff(array_keys((array)$ing), IMPORT_KNOWN_INGREDIENT_KEYS) as $key) {
                $result['warnings'][] = "{$slug}: ingredient field '{$key}' has no MySQL column and was not imported";
            }
        }
        foreach ((array)($data['steps'] ?? []) as $step) {
            foreach (array_diff(array_keys((array)$step), IMPORT_KNOWN_STEP_KEYS) as $key) {
                $result['warnings'][] = "{$slug}: step field '{$key}' has no MySQL column and was not imported";
            }
        }
        if (strlen(trim((string)($data['description'] ?? ''))) > 1000) {
            $result['warnings'][] = "{$slug}: description is longer than 1000 characters and is shortened";
        }
        $category = RecipeService::slugify((string)($data['category'] ?? 'curries'));
        if (!in_array($category, $knownCategories, true)) {
            $result['warnings'][] = "{$slug}: category '{$category}' does not exist";
        }
        if ($publicPath !== null) {
            $images = [(string)($data['image'] ?? '')];
            foreach ((array)($data['steps'] ?? []) as $step) {
                $images[] = (string)($step['image'] ?? '');
            }
            foreach (array_filter($images) as $image) {
                if (str_starts_with($image, '/') && !is_file(rtrim($publicPath, '/') . $image)) {
                    $result['warnings'][] = "{$slug}: image file not found under the web root: {$image}";
                }
            }
        }

        if (!$dryRun) {
            try {
                $service->saveRecipe($data);
            } catch (Throwable $e) {
                $result['errors'][] = "recipe '{$slug}' not imported: " . $e->getMessage();
                continue;
            }
        }
        $result['created']['recipes']++;
    }

    // ---- Menu (no stable key: imported only into an empty table)
    $menu = $readJson($configDir . '/menu.json') ?? [];
    $result['source']['menu_items'] = count($menu);
    if ($menu) {
        if ((int)$pdo->query('SELECT COUNT(*) FROM `menu_items`')->fetchColumn() > 0) {
            $result['skipped']['menu_items'] = count($menu);
        } elseif (!$dryRun) {
            $stmt = $pdo->prepare('INSERT INTO `menu_items` (`label`, `href`, `order_num`, `visible`) VALUES (:label, :href, :order_num, :visible)');
            foreach ($menu as $item) {
                $stmt->execute([
                    ':label' => (string)($item['label'] ?? ''),
                    ':href' => (string)($item['href'] ?? ''),
                    ':order_num' => (int)($item['order'] ?? 0),
                    ':visible' => !empty($item['visible']) ? 1 : 0,
                ]);
                $result['created']['menu_items']++;
            }
        } else {
            $result['created']['menu_items'] = count($menu);
        }
    }

    return $result;
}

/**
 * Sub categories (slug + name + order) from <configDir>/subcategories.json, imported only
 * while the subcategories table is empty, so sub categories edited in the admin are never touched.
 * The category -> sub category mapping (the "subcategories" list of each entry in categories.json)
 * is imported with them. Returns the number of sub categories added.
 */
function importSubcategories(PDO $pdo, string $configDir): int {
    $file = $configDir . '/subcategories.json';
    $rows = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    if (!is_array($rows) || !$rows) {
        return 0;
    }
    if ((int)$pdo->query('SELECT COUNT(*) FROM `subcategories`')->fetchColumn() > 0) {
        return 0;
    }
    $stmt = $pdo->prepare('INSERT INTO `subcategories` (`slug`, `name`, `order_num`) VALUES (:slug, :name, :order_num)');
    $added = 0;
    foreach ($rows as $row) {
        $slug = strtolower(trim((string)($row['slug'] ?? '')));
        $name = trim((string)($row['name'] ?? ''));
        if ($name === '' || !preg_match('/^[a-z0-9-]{1,80}$/', $slug)) {
            continue;
        }
        $stmt->execute([':slug' => $slug, ':name' => $name, ':order_num' => (int)($row['order'] ?? 0)]);
        $added++;
    }

    $categories = is_file($configDir . '/categories.json') ? json_decode((string)file_get_contents($configDir . '/categories.json'), true) : null;
    if (is_array($categories)) {
        $link = $pdo->prepare('INSERT INTO `category_subcategories` (`category_slug`, `subcategory_slug`) SELECT c.`slug`, s.`slug` FROM `categories` c, `subcategories` s WHERE c.`slug` = :category AND s.`slug` = :sub');
        foreach ($categories as $cat) {
            foreach ((array)($cat['subcategories'] ?? []) as $sub) {
                try {
                    $link->execute([':category' => strtolower(trim((string)($cat['slug'] ?? ''))), ':sub' => strtolower(trim((string)$sub))]);
                } catch (PDOException) {
                    // already linked
                }
            }
        }
    }
    return $added;
}

/** Seed locations: <backend>/seed when shipped, otherwise the repository (development). */
function importSeedPaths(?string $seedDir = null): array {
    $seedDir ??= dirname(__DIR__) . '/seed';
    if (is_dir($seedDir)) {
        return [$seedDir . '/config', $seedDir . '/recipes'];
    }
    $root = dirname(__DIR__, 2);
    return [$root . '/config', $root . '/src/content/recipes'];
}

// ---- CLI
if (PHP_SAPI === 'cli' && realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    $dryRun = in_array('--dry-run', $argv, true);
    $seed = null;
    foreach ($argv as $arg) {
        if (str_starts_with($arg, '--seed=')) {
            $seed = substr($arg, 7);
        }
    }
    try {
        [$configDir, $recipesDir] = importSeedPaths($seed);
        if (!is_dir($recipesDir)) {
            throw new RuntimeException('Seed folder not found. Expected recipes in: ' . $recipesDir);
        }
        $appConfig = require dirname(__DIR__) . '/config/config.php';
        $pdo = Database::getConnection();
        $r = importContent($pdo, $configDir, $recipesDir, [
            'dry_run' => $dryRun,
            'public_path' => (string)($appConfig['site']['public_path'] ?? '') ?: null,
        ]);

        echo ($dryRun ? "DRY RUN (nothing written)\n" : "Import finished\n");
        printf("%-12s %8s %8s %8s\n", 'what', 'in seed', $dryRun ? 'would add' : 'added', 'kept');
        foreach (['categories', 'tags', 'recipes', 'menu_items'] as $kind) {
            printf("%-12s %8d %8d %8d\n", $kind, $r['source'][$kind], $r['created'][$kind], $r['skipped'][$kind]);
        }
        foreach (['recipes', 'categories', 'tags'] as $table) {
            printf("%s in database: %d\n", $table, (int)$pdo->query("SELECT COUNT(*) FROM `{$table}`")->fetchColumn());
        }
        foreach ($r['warnings'] as $w) {
            echo "WARNING: {$w}\n";
        }
        foreach ($r['errors'] as $e) {
            fwrite(STDERR, "ERROR: {$e}\n");
        }
        echo "\nNext: open /admin/ and use \"Rebuild All Static Pages\" to publish the imported recipes.\n";
        exit($r['errors'] ? 1 : 0);
    } catch (Throwable $e) {
        fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
        exit(1);
    }
}
