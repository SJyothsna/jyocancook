<?php
declare(strict_types=1);

/**
 * JyoCanCook Configuration Service (Categories, Tags, Navigation Menu)
 */

require_once dirname(__DIR__) . '/config/database.php';

class ConfigService {
    private PDO $pdo;

    public function __construct(?PDO $pdo = null) {
        $this->pdo = $pdo ?? Database::getConnection();
    }

    /** Each category also lists the slugs of the sub categories it offers (`subcategories`). */
    public function getCategories(): array {
        $stmt = $this->pdo->query("SELECT `slug`, `name`, `description`, `image`, `order_num` AS `order` FROM `categories` ORDER BY `order_num` ASC, `name` ASC");
        $categories = $stmt->fetchAll();

        $links = [];
        try {
            $rows = $this->pdo->query(
                "SELECT l.`category_slug`, l.`subcategory_slug` FROM `category_subcategories` l
                 INNER JOIN `subcategories` s ON s.`slug` = l.`subcategory_slug`
                 ORDER BY s.`order_num` ASC, s.`name` ASC"
            )->fetchAll();
            foreach ($rows as $row) {
                $links[$row['category_slug']][] = $row['subcategory_slug'];
            }
        } catch (PDOException) {
            // Tables not created yet (backend/db/migrate.php not run since sub categories were added).
        }
        return array_map(static function (array $category) use ($links): array {
            $category['subcategories'] = $links[$category['slug']] ?? [];
            return $category;
        }, $categories);
    }

    public function saveCategories(array $categories): array {
        $this->pdo->beginTransaction();
        try {
            $exists = $this->pdo->prepare("SELECT 1 FROM `categories` WHERE `slug` = ?");
            $update = $this->pdo->prepare("
                UPDATE `categories` SET `name` = :name, `description` = :description, `image` = :image, `order_num` = :order_num
                WHERE `slug` = :slug
            ");
            $insert = $this->pdo->prepare("
                INSERT INTO `categories` (`slug`, `name`, `description`, `image`, `order_num`)
                VALUES (:slug, :name, :description, :image, :order_num)
            ");

            $seenSlugs = [];
            foreach ($categories as $idx => $cat) {
                $name = trim((string)($cat['name'] ?? ''));
                if ($name === '') continue;
                $slug = strtolower(trim((string)($cat['slug'] ?? '')));
                if ($slug === '') {
                    $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $name));
                }
                // The slug becomes a public folder name (/category/<slug>/).
                if (!preg_match('/^[a-z0-9-]{1,80}$/', $slug)) {
                    throw new InvalidArgumentException("Invalid URL slug for category '{$name}' (use letters, digits and hyphens)");
                }
                $seenSlugs[] = $slug;

                $exists->execute([$slug]);
                ($exists->fetchColumn() ? $update : $insert)->execute([
                    ':slug' => $slug,
                    ':name' => $name,
                    ':description' => trim((string)($cat['description'] ?? '')),
                    ':image' => trim((string)($cat['image'] ?? '/images/categories/' . $slug . '.svg')),
                    ':order_num' => (int)($cat['order'] ?? $idx),
                ]);

                // The sub categories a category offers are replaced only when the request carries them.
                if (array_key_exists('subcategories', $cat)) {
                    $subs = array_unique(array_map(static fn($s) => strtolower(trim((string)$s)), (array)$cat['subcategories']));
                    try {
                        $this->pdo->prepare("DELETE FROM `category_subcategories` WHERE `category_slug` = ?")->execute([$slug]);
                        $link = $this->pdo->prepare("INSERT INTO `category_subcategories` (`category_slug`, `subcategory_slug`) VALUES (?, ?)");
                        foreach ($subs as $sub) {
                            if ($sub !== '') $link->execute([$slug, $sub]);
                        }
                    } catch (PDOException) {
                        // Table not created yet (backend/db/migrate.php not run): the category itself is still saved.
                    }
                }
            }

            // Remove categories omitted if desired
            if (!empty($seenSlugs)) {
                $placeholders = implode(',', array_fill(0, count($seenSlugs), '?'));
                $delStmt = $this->pdo->prepare("DELETE FROM `categories` WHERE `slug` NOT IN ($placeholders)");
                $delStmt->execute($seenSlugs);
                try {
                    $this->pdo->prepare("DELETE FROM `category_subcategories` WHERE `category_slug` NOT IN ($placeholders)")->execute($seenSlugs);
                } catch (PDOException) {
                    // Table not created yet.
                }
            }

            $this->pdo->commit();
            return $this->getCategories();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    public function getTags(): array {
        $stmt = $this->pdo->query("SELECT `name` FROM `tags` ORDER BY `name` ASC");
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    public function saveTags(array $tags): array {
        $this->pdo->beginTransaction();
        try {
            // Keep the rows (and so every recipe_tags link) of tags that stay in the list; only
            // tags removed from the list are deleted. Deleting and re-creating all tags would
            // cascade-delete every recipe's tags.
            $byName = [];
            $bySlug = [];
            foreach ($this->pdo->query("SELECT `id`, `name`, `slug` FROM `tags`")->fetchAll() as $row) {
                $byName[strtolower($row['name'])] = $row;
                $bySlug[$row['slug']] = $row;
            }
            $insert = $this->pdo->prepare("INSERT INTO `tags` (`name`, `slug`) VALUES (:name, :slug)");
            $rename = $this->pdo->prepare("UPDATE `tags` SET `name` = :name WHERE `id` = :id");

            $keepIds = [];
            $uniqueTags = array_unique(array_filter(array_map('trim', $tags)));
            foreach ($uniqueTags as $tagName) {
                $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $tagName));
                $slug = trim($slug, '-');
                if ($slug === '') continue;
                $row = $byName[strtolower($tagName)] ?? $bySlug[$slug] ?? null;
                if ($row !== null) {
                    $keepIds[(int)$row['id']] = true;
                    if ($row['name'] !== $tagName) {
                        $rename->execute([':name' => $tagName, ':id' => $row['id']]);
                    }
                    continue;
                }
                $insert->execute([':name' => $tagName, ':slug' => $slug]);
                $keepIds[(int)$this->pdo->lastInsertId()] = true;
                $bySlug[$slug] = ['id' => (int)$this->pdo->lastInsertId(), 'name' => $tagName, 'slug' => $slug];
                $byName[strtolower($tagName)] = $bySlug[$slug];
            }

            if ($keepIds) {
                $placeholders = implode(',', array_fill(0, count($keepIds), '?'));
                $this->pdo->prepare("DELETE FROM `tags` WHERE `id` NOT IN ($placeholders)")->execute(array_keys($keepIds));
            } else {
                $this->pdo->exec("DELETE FROM `tags`");
            }

            $this->pdo->commit();
            return $this->getTags();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Sub categories (independent of categories): rows of slug, name, order. If the table has not
     * been created yet (backend/db/migrate.php not run since this feature was added), there are none.
     */
    public function getSubcategories(): array {
        try {
            $stmt = $this->pdo->query(
                "SELECT `slug`, `name`, `order_num` AS `order` FROM `subcategories` ORDER BY `order_num` ASC, `name` ASC"
            );
            $rows = $stmt->fetchAll();
        } catch (PDOException) {
            return [];
        }
        return array_map(static function (array $row): array {
            $row['order'] = (int)$row['order'];
            return $row;
        }, $rows);
    }

    public function saveSubcategories(array $subcategories): array {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->exec("DELETE FROM `subcategories`");
            $stmt = $this->pdo->prepare("INSERT INTO `subcategories` (`slug`, `name`, `order_num`) VALUES (:slug, :name, :order_num)");

            $seen = [];
            foreach ($subcategories as $idx => $item) {
                $name = trim((string)($item['name'] ?? ''));
                if ($name === '') continue;
                $slug = strtolower(trim((string)($item['slug'] ?? '')));
                if ($slug === '') {
                    $slug = trim(strtolower(preg_replace('/[^a-z0-9]+/i', '-', $name)), '-');
                }
                if (!preg_match('/^[a-z0-9-]{1,80}$/', $slug)) {
                    throw new InvalidArgumentException("Invalid slug for sub category '{$name}' (use letters, digits and hyphens)");
                }
                if (isset($seen[$slug])) {
                    throw new InvalidArgumentException("Sub category '{$name}' appears twice");
                }
                $seen[$slug] = true;

                $stmt->execute([
                    ':slug' => $slug,
                    ':name' => substr($name, 0, 80),
                    ':order_num' => (int)($item['order'] ?? $idx),
                ]);
            }

            $this->pdo->commit();
            return $this->getSubcategories();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    public function getMenu(): array {
        $stmt = $this->pdo->query("SELECT `label`, `href`, `order_num` AS `order`, `visible` FROM `menu_items` ORDER BY `order_num` ASC");
        // The admin UI tests `visible !== false`, so it must be a real boolean (MySQL returns 0/1).
        return array_map(static function (array $row): array {
            $row['order'] = (int)$row['order'];
            $row['visible'] = (bool)(int)$row['visible'];
            return $row;
        }, $stmt->fetchAll());
    }

    public function saveMenu(array $menu): array {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->exec("DELETE FROM `menu_items`");
            $stmt = $this->pdo->prepare("INSERT INTO `menu_items` (`label`, `href`, `order_num`, `visible`) VALUES (:label, :href, :order_num, :visible)");

            foreach ($menu as $idx => $item) {
                $label = trim((string)($item['label'] ?? ''));
                // Generated pages live in lowercase folders and the server is case-sensitive.
                $href = strtolower(trim((string)($item['href'] ?? '')));
                if ($label === '' || $href === '') continue;

                $stmt->execute([
                    ':label' => $label,
                    ':href' => $href,
                    ':order_num' => (int)($item['order'] ?? $idx),
                    ':visible' => !empty($item['visible']) ? 1 : 0,
                ]);
            }

            $this->pdo->commit();
            return $this->getMenu();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }
}
