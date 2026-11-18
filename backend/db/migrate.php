<?php
declare(strict_types=1);

/**
 * JyoCanCook Database Migration Script
 * Creates the schema (CREATE TABLE IF NOT EXISTS) and adds any missing seed content.
 *
 * Safe to re-run: content is imported by db/import-content.php, which only adds what is missing
 * and never overwrites recipes, categories, tags or the menu edited in the admin.
 */

require_once dirname(__DIR__) . '/config/database.php';
require_once __DIR__ . '/import-content.php';

function runMigration(?PDO $pdo = null): array {
    if ($pdo === null) {
        $pdo = Database::getConnection();
    }

    $summary = [
        'schema_created' => false,
        'categories_imported' => 0,
        'tags_imported' => 0,
        'menu_imported' => 0,
        'recipes_imported' => 0,
        'admin_exists' => false,
        'warnings' => [],
        'errors' => [],
    ];

    // 1. Run Schema Definition
    $schemaFile = __DIR__ . '/schema.sql';
    if (file_exists($schemaFile)) {
        $sql = file_get_contents($schemaFile);
        $pdo->exec($sql);
        $summary['schema_created'] = true;
    } else {
        throw new RuntimeException("schema.sql not found at {$schemaFile}");
    }

    // 2. Add missing content (seed shipped in backend/seed, or the repository in development)
    [$configDir, $recipesDir] = importSeedPaths();
    $appConfig = require dirname(__DIR__) . '/config/config.php';
    $r = importContent($pdo, $configDir, $recipesDir, [
        'public_path' => (string)($appConfig['site']['public_path'] ?? '') ?: null,
    ]);
    $summary['categories_imported'] = $r['created']['categories'];
    $summary['tags_imported'] = $r['created']['tags'];
    $summary['menu_imported'] = $r['created']['menu_items'];
    $summary['recipes_imported'] = $r['created']['recipes'];
    $summary['warnings'] = $r['warnings'];
    $summary['errors'] = $r['errors'];

    // 3. Admin accounts are never created here. Use backend/db/create-admin.php.
    $summary['admin_exists'] = (int)$pdo->query("SELECT COUNT(*) FROM `admins`")->fetchColumn() > 0;

    return $summary;
}

// CLI Execution Support
if (PHP_SAPI === 'cli' && realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    echo "Starting JyoCanCook database migration...\n";
    try {
        $result = runMigration();
        echo "Migration completed successfully!\n";
        print_r($result);
        if (!$result['admin_exists']) {
            echo "No admin account exists yet. Run: php backend/db/create-admin.php\n";
        }
        exit($result['errors'] ? 1 : 0);
    } catch (Throwable $e) {
        echo "Error during migration: " . $e->getMessage() . "\n";
        exit(1);
    }
}
