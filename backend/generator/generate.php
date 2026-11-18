<?php
declare(strict_types=1);

/**
 * JyoCanCook CLI Static Site Generation Script
 * Usage: php backend/generator/generate.php
 */

require_once __DIR__ . '/SiteGenerator.php';

if (php_sapi_name() === 'cli') {
    echo "Starting JyoCanCook static site generation...\n";
    try {
        $generator = new SiteGenerator();
        $result = $generator->generateFullSite('cli_cron');
        echo "Site generation finished successfully!\n";
        print_r($result);
    } catch (Throwable $e) {
        echo "Generation failed: " . $e->getMessage() . "\n";
        exit(1);
    }
} else {
    http_response_code(403);
    echo "Forbidden";
}
