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

    public function getCategories(): array {
        $stmt = $this->pdo->query("SELECT `slug`, `name`, `description`, `image`, `order_num` AS `order` FROM `categories` ORDER BY `order_num` ASC, `name` ASC");
        return $stmt->fetchAll();
    }

    public function saveCategories(array $categories): array {
        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare("
                INSERT INTO `categories` (`slug`, `name`, `description`, `image`, `order_num`)
                VALUES (:slug, :name, :description, :image, :order_num)
                ON DUPLICATE KEY UPDATE
                    `name` = VALUES(`name`),
                    `description` = VALUES(`description`),
                    `image` = VALUES(`image`),
                    `order_num` = VALUES(`order_num`)
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

                $stmt->execute([
                    ':slug' => $slug,
                    ':name' => $name,
                    ':description' => trim((string)($cat['description'] ?? '')),
                    ':image' => trim((string)($cat['image'] ?? '/images/categories/' . $slug . '.svg')),
                    ':order_num' => (int)($cat['order'] ?? $idx),
                ]);
            }

            // Remove categories omitted if desired
            if (!empty($seenSlugs)) {
                $placeholders = implode(',', array_fill(0, count($seenSlugs), '?'));
                $delStmt = $this->pdo->prepare("DELETE FROM `categories` WHERE `slug` NOT IN ($placeholders)");
                $delStmt->execute($seenSlugs);
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
                $href = trim((string)($item['href'] ?? ''));
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
