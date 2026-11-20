<?php
declare(strict_types=1);

/**
 * JyoCanCook Recipe Management Service
 */

require_once dirname(__DIR__) . '/config/database.php';

class RecipeService {
    private PDO $pdo;

    public function __construct(?PDO $pdo = null) {
        $this->pdo = $pdo ?? Database::getConnection();
    }

    public static function slugify(string $text): string {
        $text = strtolower(trim($text));
        $text = preg_replace('/[^a-z0-9]+/i', '-', $text) ?? '';
        $text = trim($text, '-');
        return substr($text, 0, 80);
    }

    public function getAllRecipes(bool $publishedOnly = false): array {
        $sql = "
            SELECT r.*, c.name AS category_name
            FROM `recipes` r
            LEFT JOIN `categories` c ON r.category_slug = c.slug
        ";
        if ($publishedOnly) {
            $sql .= " WHERE r.published = 1 ";
        }
        $sql .= " ORDER BY r.title ASC ";

        $stmt = $this->pdo->query($sql);
        $recipes = $stmt->fetchAll();

        $results = [];
        foreach ($recipes as $row) {
            $results[] = $this->hydrateRecipe($row);
        }

        return $results;
    }

    public function getRecipeBySlug(string $slug, bool $publishedOnly = false): ?array {
        $sql = "
            SELECT r.*, c.name AS category_name
            FROM `recipes` r
            LEFT JOIN `categories` c ON r.category_slug = c.slug
            WHERE r.slug = :slug
        ";
        if ($publishedOnly) {
            $sql .= " AND r.published = 1 ";
        }
        $sql .= " LIMIT 1 ";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':slug' => $slug]);
        $row = $stmt->fetch();

        if (!$row) return null;
        return $this->hydrateRecipe($row);
    }

    public function getRecipesByCategory(string $categorySlug, bool $publishedOnly = true): array {
        $all = $this->getAllRecipes($publishedOnly);
        return array_values(array_filter($all, function ($r) use ($categorySlug) {
            return $r['category'] === $categorySlug
                || ($categorySlug === 'vegetarian' && ($r['diet'] ?? '') === 'Vegetarian')
                || ($categorySlug === 'non-vegetarian' && ($r['diet'] ?? '') === 'Non-Vegetarian');
        }));
    }

    public function getRecipesByTag(string $tagSlugOrName, bool $publishedOnly = true): array {
        $all = $this->getAllRecipes($publishedOnly);
        $target = strtolower(trim($tagSlugOrName));
        return array_values(array_filter($all, function ($r) use ($target) {
            $tags = array_map('strtolower', $r['tags'] ?? []);
            return in_array($target, $tags, true);
        }));
    }

    public function saveRecipe(array $input, ?string $originalSlug = null): array {
        $title = trim((string)($input['title'] ?? ''));
        if ($title === '') {
            throw new InvalidArgumentException('Recipe title is required');
        }

        $rawSlug = trim((string)($input['slug'] ?? $title));
        $slug = self::slugify($rawSlug);
        if ($slug === '') {
            throw new InvalidArgumentException('Valid recipe URL slug required');
        }

        // Check for slug collision
        $checkStmt = $this->pdo->prepare("SELECT `id`, `slug` FROM `recipes` WHERE `slug` = :slug LIMIT 1");
        $checkStmt->execute([':slug' => $slug]);
        $existing = $checkStmt->fetch();

        $originalId = null;
        if ($originalSlug) {
            $origStmt = $this->pdo->prepare("SELECT `id` FROM `recipes` WHERE `slug` = :slug LIMIT 1");
            $origStmt->execute([':slug' => $originalSlug]);
            $originalId = $origStmt->fetchColumn();
        }

        if ($existing && (!$originalId || (int)$existing['id'] !== (int)$originalId)) {
            throw new InvalidArgumentException("A recipe with slug '{$slug}' already exists");
        }

        $ingredients = $input['ingredients'] ?? [];
        if (!is_array($ingredients) || empty($ingredients)) {
            throw new InvalidArgumentException('At least one ingredient is required');
        }

        $steps = $input['steps'] ?? [];
        if (!is_array($steps) || empty($steps)) {
            throw new InvalidArgumentException('At least one instruction step is required');
        }

        $category = self::slugify((string)($input['category'] ?? 'curries'));
        // Several subcategories are stored comma-separated in the existing subcategory_slug column.
        $subInput = $input['subcategories'] ?? ($input['subcategory'] ?? []);
        $subList = [];
        foreach ((array)$subInput as $sub) {
            $subSlug = self::slugify((string)$sub);
            if ($subSlug !== '' && !in_array($subSlug, $subList, true)) {
                $subList[] = $subSlug;
            }
        }
        $subcategory = $subList ? implode(',', $subList) : null;
        if ($subcategory !== null && strlen($subcategory) > 80) {
            throw new InvalidArgumentException('Too many subcategories selected (limit is 80 characters in total)');
        }
        $diet = in_array($input['diet'] ?? '', ['Vegetarian', 'Non-Vegetarian', 'Vegan', 'Eggitarian'], true)
            ? $input['diet']
            : 'Vegetarian';

        $nut = $input['nutrition'] ?? [];
        $calories = isset($nut['calories']) && $nut['calories'] !== '' ? max(0, (int)$nut['calories']) : null;
        $carbs = isset($nut['carbs']) && $nut['carbs'] !== '' ? max(0.0, (float)$nut['carbs']) : null;
        $protein = isset($nut['protein']) && $nut['protein'] !== '' ? max(0.0, (float)$nut['protein']) : null;
        $fat = isset($nut['fat']) && $nut['fat'] !== '' ? max(0.0, (float)$nut['fat']) : null;
        $fiber = isset($nut['fiber']) && $nut['fiber'] !== '' ? max(0.0, (float)$nut['fiber']) : null;

        $tips = is_array($input['tips'] ?? null) ? array_values(array_filter(array_map('trim', $input['tips']))) : [];
        $serveWith = is_array($input['serveWith'] ?? null) ? array_values(array_filter(array_map('trim', $input['serveWith']))) : [];

        $published = !empty($input['published']) ? 1 : 0;
        $featured = !empty($input['featured']) ? 1 : 0;
        $story = !empty($input['story']) ? trim((string)$input['story']) : null;
        $youtubeUrl = !empty($input['youtubeUrl']) ? trim((string)$input['youtubeUrl']) : null;
        $image = !empty($input['image']) ? trim((string)$input['image']) : '/images/recipes/recipe-placeholder.svg';

        $this->pdo->beginTransaction();
        try {
            if ($originalId) {
                // Update existing
                $updateStmt = $this->pdo->prepare("
                    UPDATE `recipes` SET
                        `slug` = :slug,
                        `title` = :title,
                        `description` = :description,
                        `category_slug` = :category_slug,
                        `subcategory_slug` = :subcategory_slug,
                        `diet` = :diet,
                        `prep_time` = :prep_time,
                        `cook_time` = :cook_time,
                        `servings` = :servings,
                        `difficulty` = :difficulty,
                        `image` = :image,
                        `published` = :published,
                        `featured` = :featured,
                        `story` = :story,
                        `youtube_url` = :youtube_url,
                        `calories` = :calories,
                        `carbs` = :carbs,
                        `protein` = :protein,
                        `fat` = :fat,
                        `fiber` = :fiber,
                        `tips_json` = :tips_json,
                        `serve_with_json` = :serve_with_json,
                        `published_at` = IF(:publish_now = 1 AND `published_at` IS NULL, NOW(), `published_at`)
                    WHERE `id` = :id
                ");
                $updateStmt->execute([
                    ':slug' => $slug,
                    ':title' => $title,
                    ':description' => substr(trim((string)($input['description'] ?? '')), 0, 1000),
                    ':category_slug' => $category,
                    ':subcategory_slug' => $subcategory,
                    ':diet' => $diet,
                    ':prep_time' => max(0, (int)($input['prepTime'] ?? 15)),
                    ':cook_time' => max(0, (int)($input['cookTime'] ?? 30)),
                    ':servings' => max(1, (int)($input['servings'] ?? 4)),
                    ':difficulty' => trim((string)($input['difficulty'] ?? 'Easy')),
                    ':image' => $image,
                    ':published' => $published,
                    ':publish_now' => $published,
                    ':featured' => $featured,
                    ':story' => $story,
                    ':youtube_url' => $youtubeUrl,
                    ':calories' => $calories,
                    ':carbs' => $carbs,
                    ':protein' => $protein,
                    ':fat' => $fat,
                    ':fiber' => $fiber,
                    ':tips_json' => !empty($tips) ? json_encode($tips, JSON_UNESCAPED_UNICODE) : null,
                    ':serve_with_json' => !empty($serveWith) ? json_encode($serveWith, JSON_UNESCAPED_UNICODE) : null,
                    ':id' => $originalId,
                ]);
                $recipeId = (int)$originalId;
            } else {
                // Insert new
                $insertStmt = $this->pdo->prepare("
                    INSERT INTO `recipes` (
                        `slug`, `title`, `description`, `category_slug`, `subcategory_slug`, `diet`,
                        `prep_time`, `cook_time`, `servings`, `difficulty`, `image`,
                        `published`, `featured`, `story`, `youtube_url`,
                        `calories`, `carbs`, `protein`, `fat`, `fiber`,
                        `tips_json`, `serve_with_json`, `published_at`
                    ) VALUES (
                        :slug, :title, :description, :category_slug, :subcategory_slug, :diet,
                        :prep_time, :cook_time, :servings, :difficulty, :image,
                        :published, :featured, :story, :youtube_url,
                        :calories, :carbs, :protein, :fat, :fiber,
                        :tips_json, :serve_with_json, IF(:publish_now = 1, COALESCE(:published_at_in, NOW()), NULL)
                    )
                ");
                $insertStmt->execute([
                    ':slug' => $slug,
                    ':title' => $title,
                    ':description' => substr(trim((string)($input['description'] ?? '')), 0, 1000),
                    ':category_slug' => $category,
                    ':subcategory_slug' => $subcategory,
                    ':diet' => $diet,
                    ':prep_time' => max(0, (int)($input['prepTime'] ?? 15)),
                    ':cook_time' => max(0, (int)($input['cookTime'] ?? 30)),
                    ':servings' => max(1, (int)($input['servings'] ?? 4)),
                    ':difficulty' => trim((string)($input['difficulty'] ?? 'Easy')),
                    ':image' => $image,
                    ':published' => $published,
                    ':publish_now' => $published,
                    ':featured' => $featured,
                    ':story' => $story,
                    ':youtube_url' => $youtubeUrl,
                    ':calories' => $calories,
                    ':carbs' => $carbs,
                    ':protein' => $protein,
                    ':fat' => $fat,
                    ':fiber' => $fiber,
                    ':tips_json' => !empty($tips) ? json_encode($tips, JSON_UNESCAPED_UNICODE) : null,
                    ':serve_with_json' => !empty($serveWith) ? json_encode($serveWith, JSON_UNESCAPED_UNICODE) : null,
                    // Keeps the original publish date of recipes imported from the repository (empty = now).
                    ':published_at_in' => ($ts = strtotime((string)($input['publishedAt'] ?? ''))) !== false ? gmdate('Y-m-d H:i:s', $ts) : null,
                ]);
                $recipeId = (int)$this->pdo->lastInsertId();
            }

            // Sync Ingredients
            $this->pdo->prepare("DELETE FROM `recipe_ingredients` WHERE `recipe_id` = ?")->execute([$recipeId]);
            $ingStmt = $this->pdo->prepare("
                INSERT INTO `recipe_ingredients` (`recipe_id`, `section`, `name`, `amount`, `unit`, `order_num`)
                VALUES (:recipe_id, :section, :name, :amount, :unit, :order_num)
            ");
            foreach ($ingredients as $idx => $ing) {
                $name = trim((string)($ing['name'] ?? ''));
                if ($name === '') continue;
                $ingStmt->execute([
                    ':recipe_id' => $recipeId,
                    ':section' => !empty($ing['section']) ? trim((string)$ing['section']) : null,
                    ':name' => $name,
                    ':amount' => isset($ing['amount']) && $ing['amount'] !== '' && is_numeric($ing['amount']) ? (float)$ing['amount'] : null,
                    ':unit' => trim((string)($ing['unit'] ?? '')),
                    ':order_num' => $idx,
                ]);
            }

            // Sync Steps
            $this->pdo->prepare("DELETE FROM `recipe_steps` WHERE `recipe_id` = ?")->execute([$recipeId]);
            $stepStmt = $this->pdo->prepare("
                INSERT INTO `recipe_steps` (`recipe_id`, `title`, `text`, `image`, `order_num`)
                VALUES (:recipe_id, :title, :text, :image, :order_num)
            ");
            foreach ($steps as $idx => $step) {
                $stepText = trim((string)($step['text'] ?? ''));
                $stepTitle = trim((string)($step['title'] ?? ''));
                if ($stepText === '' && $stepTitle === '') continue;
                $stepStmt->execute([
                    ':recipe_id' => $recipeId,
                    ':title' => $stepTitle !== '' ? $stepTitle : 'Step ' . ($idx + 1),
                    ':text' => $stepText,
                    ':image' => !empty($step['image']) ? trim((string)$step['image']) : null,
                    ':order_num' => $idx,
                ]);
            }

            // Sync Tags
            $this->pdo->prepare("DELETE FROM `recipe_tags` WHERE `recipe_id` = ?")->execute([$recipeId]);
            $tagInput = $input['tags'] ?? [];
            if (is_array($tagInput)) {
                $tagFindStmt = $this->pdo->prepare("SELECT `id` FROM `tags` WHERE LOWER(`name`) = LOWER(:name) OR `slug` = :slug LIMIT 1");
                $tagCreateStmt = $this->pdo->prepare("INSERT INTO `tags` (`name`, `slug`) VALUES (:name, :slug)");
                $recipeTagStmt = $this->pdo->prepare("INSERT IGNORE INTO `recipe_tags` (`recipe_id`, `tag_id`) VALUES (:recipe_id, :tag_id)");

                foreach ($tagInput as $tagName) {
                    $tagName = trim((string)$tagName);
                    if ($tagName === '') continue;
                    $tagSlug = self::slugify($tagName);

                    $tagFindStmt->execute([':name' => $tagName, ':slug' => $tagSlug]);
                    $tagId = $tagFindStmt->fetchColumn();

                    if (!$tagId) {
                        $tagCreateStmt->execute([':name' => $tagName, ':slug' => $tagSlug]);
                        $tagId = $this->pdo->lastInsertId();
                    }

                    if ($tagId) {
                        $recipeTagStmt->execute([':recipe_id' => $recipeId, ':tag_id' => (int)$tagId]);
                    }
                }
            }

            $this->pdo->commit();
            return $this->getRecipeBySlug($slug, false) ?? [];
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    public function deleteRecipe(string $slug): bool {
        $stmt = $this->pdo->prepare("DELETE FROM `recipes` WHERE `slug` = :slug");
        $stmt->execute([':slug' => $slug]);
        return $stmt->rowCount() > 0;
    }

    private function hydrateRecipe(array $row): array {
        $recipeId = (int)$row['id'];

        // Ingredients
        $ingStmt = $this->pdo->prepare("
            SELECT `section`, `name`, `amount`, `unit`
            FROM `recipe_ingredients`
            WHERE `recipe_id` = :id
            ORDER BY `order_num` ASC
        ");
        $ingStmt->execute([':id' => $recipeId]);
        $ingredients = array_map(function ($i) {
            return [
                'name' => $i['name'],
                'amount' => $i['amount'] !== null ? (float)$i['amount'] : null,
                'unit' => $i['unit'] ?? '',
                'section' => $i['section'] ?? null,
            ];
        }, $ingStmt->fetchAll());

        // Steps
        $stepStmt = $this->pdo->prepare("
            SELECT `title`, `text`, `image`
            FROM `recipe_steps`
            WHERE `recipe_id` = :id
            ORDER BY `order_num` ASC
        ");
        $stepStmt->execute([':id' => $recipeId]);
        $steps = array_map(function ($s) {
            $res = [
                'title' => $s['title'],
                'text' => $s['text'],
            ];
            if (!empty($s['image'])) {
                $res['image'] = $s['image'];
            }
            return $res;
        }, $stepStmt->fetchAll());

        // Tags
        $tagStmt = $this->pdo->prepare("
            SELECT t.`name`
            FROM `tags` t
            INNER JOIN `recipe_tags` rt ON t.`id` = rt.`tag_id`
            WHERE rt.`recipe_id` = :id
            ORDER BY t.`name` ASC
        ");
        $tagStmt->execute([':id' => $recipeId]);
        $tags = $tagStmt->fetchAll(PDO::FETCH_COLUMN);

        // Nutrition
        $nutrition = [];
        if ($row['calories'] !== null) $nutrition['calories'] = (int)$row['calories'];
        if ($row['carbs'] !== null) $nutrition['carbs'] = (float)$row['carbs'];
        if ($row['protein'] !== null) $nutrition['protein'] = (float)$row['protein'];
        if ($row['fat'] !== null) $nutrition['fat'] = (float)$row['fat'];
        if ($row['fiber'] !== null) $nutrition['fiber'] = (float)$row['fiber'];

        return [
            'slug' => $row['slug'],
            'title' => $row['title'],
            'description' => $row['description'] ?? '',
            'category' => $row['category_slug'] ?? 'curries',
            'category_name' => $row['category_name'] ?? $row['category_slug'],
            'subcategories' => array_values(array_filter(explode(',', (string)($row['subcategory_slug'] ?? '')))),
            'tags' => $tags,
            'diet' => $row['diet'] ?? 'Vegetarian',
            'prepTime' => (int)$row['prep_time'],
            'cookTime' => (int)$row['cook_time'],
            'servings' => (int)$row['servings'],
            'difficulty' => $row['difficulty'] ?? 'Easy',
            'image' => $row['image'] ?? '/images/recipes/recipe-placeholder.svg',
            'published' => (bool)$row['published'],
            'featured' => (bool)$row['featured'],
            'story' => $row['story'] ?? null,
            'youtubeUrl' => $row['youtube_url'] ?? null,
            'nutrition' => !empty($nutrition) ? $nutrition : null,
            'ingredients' => $ingredients,
            'steps' => $steps,
            'tips' => !empty($row['tips_json']) ? json_decode($row['tips_json'], true) : [],
            'serveWith' => !empty($row['serve_with_json']) ? json_decode($row['serve_with_json'], true) : [],
            'publishedAt' => $row['published_at'] ?? null,
            'updatedAt' => $row['updated_at'] ?? null,
        ];
    }
}
