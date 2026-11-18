<?php
declare(strict_types=1);

/**
 * JyoCanCook Global Configuration
 * Designed for Hostinger Native & Local PHP/MySQL environments.
 * Keep sensitive credentials out of public_html.
 */

// Load optional local override configuration file if present
$localConfigFile = __DIR__ . '/config.local.php';
if (file_exists($localConfigFile)) {
    $localConfig = require $localConfigFile;
} else {
    $localConfig = [];
}

// Keep only well-formed proxy IPs / CIDR ranges and refuse "trust everyone" ranges
// (0.0.0.0/0, ::/0, or anything wider than /8 for IPv4 and /16 for IPv6), so a configuration
// slip can never let a client choose its own rate-limit identity via forwarded headers.
$cleanTrustedProxies = static function (array $list): array {
    $out = [];
    foreach ($list as $entry) {
        $entry = trim((string)$entry);
        [$ip, $bits] = array_pad(explode('/', $entry, 2), 2, null);
        $bin = filter_var($ip, FILTER_VALIDATE_IP) ? @inet_pton($ip) : false;
        if ($bin === false) {
            continue;
        }
        $max = strlen($bin) * 8;
        $prefix = ($bits === null || $bits === '') ? $max : (ctype_digit($bits) ? (int)$bits : -1);
        if ($prefix < ($max === 32 ? 8 : 16) || $prefix > $max) {
            continue;
        }
        $out[] = $entry;
    }
    return $out;
};

$environment = (string)($localConfig['site']['environment'] ?? 'development');

return [
    'db' => [
        'host' => getenv('DB_HOST') ?: ($localConfig['db']['host'] ?? '127.0.0.1'),
        'port' => (int)(getenv('DB_PORT') ?: ($localConfig['db']['port'] ?? 3306)),
        'name' => getenv('DB_NAME') ?: ($localConfig['db']['name'] ?? 'jyocancook_db'),
        'user' => getenv('DB_USER') ?: ($localConfig['db']['user'] ?? 'root'),
        'pass' => getenv('DB_PASS') !== false ? getenv('DB_PASS') : ($localConfig['db']['pass'] ?? ''),
        'charset' => 'utf8mb4',
    ],
    'site' => [
        'name' => 'JyoCanCook',
        'tagline' => 'Homemade Recipes',
        // 'staging' | 'production' on a server; 'development' (default) only for local CLI use.
        // The publisher and the API refuse to run a server without staging/production.
        'environment' => $environment,
        // Host names this backend may serve. The API answers 404 for any other Host header, so a
        // staging backend cannot be reached through the main domain (e.g. jyocancook.com/staging/).
        'allowed_hosts' => array_values(array_filter(array_map(
            static fn($h) => strtolower(trim((string)$h)),
            (array)($localConfig['site']['allowed_hosts'] ?? [])
        ))),
        'url' => getenv('SITE_URL') ?: ($localConfig['site']['url'] ?? 'https://jyocancook.com'),
        // Path to the public web root where static HTML and public assets reside
        'public_path' => getenv('PUBLIC_HTML_PATH') ?: ($localConfig['site']['public_path'] ?? dirname(__DIR__, 2) . '/dist'),
        // Path to persistent uploaded images
        'upload_path' => getenv('UPLOAD_PATH') ?: ($localConfig['site']['upload_path'] ?? dirname(__DIR__, 2) . '/public/images/recipes'),
    ],
    'auth' => [
        // Production uses its own cookie name, so a staging session id (same account, same PHP session
        // store) is never accepted by production even if someone copies the cookie across.
        'session_name' => $environment === 'production' ? 'jyo_prod_admin_session' : 'jyo_php_admin_session',
        'session_lifetime' => (int)(getenv('SESSION_LIFETIME') ?: ($localConfig['auth']['session_lifetime'] ?? 86400 * 7)), // 7 days
        // Must be set in backend/config/config.local.php (outside public_html) or SESSION_SECRET.
        'session_secret' => getenv('SESSION_SECRET') ?: ($localConfig['auth']['session_secret'] ?? ''),
        'rate_limit_max_attempts' => 5,           // failed logins per client IP per window
        'rate_limit_account_max_attempts' => 20,  // failed logins per account per window (defeats IP rotation)
        'rate_limit_lockout_seconds' => 900, // 15 minutes lockout
        // CIDR ranges of reverse proxies/CDNs whose forwarded client-IP headers may be trusted.
        // Empty (default): only REMOTE_ADDR is used and X-Forwarded-For / CF-Connecting-IP are ignored.
        'trusted_proxies' => $cleanTrustedProxies((array)($localConfig['auth']['trusted_proxies'] ?? [])),
    ],
    'generator' => [
        'lock_file' => dirname(__DIR__) . '/tmp/publish.lock',
        'staging_dir' => dirname(__DIR__) . '/tmp/staging',
        'backup_dir' => dirname(__DIR__) . '/tmp/backup',
        'max_exec_time' => 300,
    ],
];
