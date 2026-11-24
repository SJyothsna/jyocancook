<?php
declare(strict_types=1);

/**
 * JyoCanCook Public API Gateway
 * Handles Admin CRUD, Session Authentication, Secure Image Uploads,
 * and On-Server Static Site Generation triggers.
 */

// Never display PHP errors to clients (they can contain server paths and SQL).
ini_set('display_errors', '0');
ini_set('html_errors', '0');
error_reporting(E_ALL);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 1; mode=block');

// Helper to send JSON responses
function sendJson(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Append a detailed error to a private log (outside public_html) and return a short
 * reference id for the client. Never logs stack-trace arguments, so credentials passed
 * to constructors cannot leak into the log.
 */
function logPrivateError(Throwable $e, ?string $logDir): string {
    $ref = bin2hex(random_bytes(6));
    $message = preg_replace('/(pass(word)?|secret|token|pwd)\s*[=:]\s*\S+/i', '$1=[redacted]', $e->getMessage());
    $frames = [];
    foreach (array_slice($e->getTrace(), 0, 8) as $f) {
        $frames[] = (isset($f['class']) ? $f['class'] . '::' : '') . ($f['function'] ?? '?')
            . '@' . basename((string)($f['file'] ?? '?')) . ':' . ($f['line'] ?? 0);
    }
    $line = sprintf(
        "[%s] ref=%s %s: %s (%s:%d) | %s\n",
        gmdate('Y-m-d H:i:s'),
        $ref,
        get_class($e),
        substr((string)$message, 0, 500),
        basename($e->getFile()),
        $e->getLine(),
        implode(' < ', $frames)
    );
    $written = false;
    if ($logDir !== null) {
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0750, true);
        }
        $written = @file_put_contents($logDir . '/api-errors.log', $line, FILE_APPEND | LOCK_EX) !== false;
    }
    if (!$written) {
        // Server error log gets the reference only, never the details.
        error_log('[JyoCanCook API] unhandled error ref=' . $ref);
    }
    return $ref;
}

/**
 * Read a server-provided setting (SetEnv / host environment). Apache exposes variables set before an
 * internal rewrite with a REDIRECT_ prefix, so both spellings are checked.
 */
function serverSetting(string $name): string {
    $value = getenv($name);
    if (!is_string($value) || $value === '') {
        $value = $_SERVER[$name] ?? $_SERVER['REDIRECT_' . $name] ?? '';
    }
    return is_string($value) ? trim($value) : '';
}

/**
 * Make a value safe to write to the private boot log: printable ASCII only, credential-looking
 * "name=value" / "name: value" pairs redacted, and a length cap. Log lines are JSON, so a value can
 * never start a new log line.
 */
function bootSanitize(string $value, int $max = 300): string {
    $value = preg_replace('/[^\x20-\x7E]/', '?', $value) ?? '';
    $value = preg_replace('/(pass(word)?|secret|token|pwd|session|cookie|authorization)\s*[=:]\s*\S+/i', '$1=[redacted]', $value) ?? '';
    return substr($value, 0, $max);
}

/**
 * Directories a web server may serve: the document root and the gateway's parent (the staging
 * document root), plus every public_html ancestor of either (staging sits inside the main domain's
 * public_html).
 *
 * @return list<string>
 */
function servedDirectories(string $apiDir): array {
    $served = [];
    foreach ([(string)($_SERVER['DOCUMENT_ROOT'] ?? ''), dirname($apiDir)] as $docRoot) {
        $dir = $docRoot !== '' ? realpath($docRoot) : false;
        $isDocRoot = true;
        while ($dir !== false) {
            if ($isDocRoot || basename($dir) === 'public_html') {
                $served[] = str_replace('\\', '/', $dir);
            }
            $isDocRoot = false;
            $parent = dirname($dir);
            $dir = $parent === $dir ? false : $parent;
        }
    }
    return $served;
}

/** True when $path (already resolved) is one of the directories in $dirs or lies below one. */
function isInsideAny(string $path, array $dirs): bool {
    $candidate = rtrim(str_replace('\\', '/', $path), '/') . '/';
    foreach ($dirs as $dir) {
        if (str_starts_with($candidate, rtrim($dir, '/') . '/')) {
            return true;
        }
    }
    return false;
}

/**
 * Choose a private, writable directory for boot diagnostics. It is derived only from the configured
 * backend path and is never inside a web-served directory:
 *   1. <backend>/tmp/logs        when the backend directory exists, otherwise
 *   2. <parent of backend>/jyocancook-boot-logs
 * Returns null when no safe location exists (the failure is then only reported to the PHP error log).
 */
function bootLogDirectory(string $configuredPath, string $apiDir): ?string {
    if ($configuredPath === ''
        || str_contains($configuredPath, "\0")
        || !preg_match('#^(/|[A-Za-z]:[\\\\/])#', $configuredPath)
        || preg_match('#(^|[\\\\/])\.\.([\\\\/]|$)#', $configuredPath)) {
        return null;
    }
    $candidates = [];
    $real = realpath($configuredPath);
    if ($real !== false && is_dir($real)) {
        $candidates[] = $real . '/tmp/logs';
    }
    $parent = realpath(dirname($configuredPath));
    if ($parent !== false && is_dir($parent)) {
        $candidates[] = $parent . '/jyocancook-boot-logs';
    }
    $served = servedDirectories($apiDir);
    foreach ($candidates as $dir) {
        if (isInsideAny($dir, $served)) {
            continue;
        }
        if ((is_dir($dir) || @mkdir($dir, 0750, true)) && is_writable($dir)) {
            return $dir;
        }
    }
    return null;
}

/**
 * Record why the gateway refused to start ("Server configuration error"), in a private file
 * (api-boot.log) outside public_html. This runs before the application logger exists, so it must not
 * depend on the backend being usable. It records only: a stable failure code, the reason, PHP and
 * request basics (method, path WITHOUT query string, host name) and non-secret path/environment
 * facts. It never reads or records config file contents, credentials, session secrets, tokens,
 * cookies, request headers or bodies. Never throws.
 *
 * @param array<string, scalar|array|null> $context
 */
function logBootFailure(string $code, string $reason, array $context, string $configuredPath, string $apiDir): void {
    $ref = '';
    $written = false;
    try {
        $ref = bin2hex(random_bytes(6));
        $record = [
            'time' => gmdate('Y-m-d\TH:i:s\Z'),
            'ref' => $ref,
            'code' => $code,
            'reason' => $reason,
            'php' => PHP_VERSION,
            'sapi' => PHP_SAPI,
            'request' => [
                'method' => (string)($_SERVER['REQUEST_METHOD'] ?? ''),
                'path' => (string)(parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?? ''),
                'host' => (string)($_SERVER['HTTP_HOST'] ?? ''),
            ],
            'gateway_dir' => $apiDir,
            'document_root' => (string)($_SERVER['DOCUMENT_ROOT'] ?? ''),
            'open_basedir' => (string)ini_get('open_basedir'),
        ] + $context;
        array_walk_recursive($record, static function (&$value): void {
            if (is_string($value)) {
                $value = bootSanitize($value);
            }
        });
        $line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        $dir = bootLogDirectory($configuredPath, $apiDir);
        if ($dir !== null && $line !== false) {
            $written = @file_put_contents($dir . '/api-boot.log', $line . "\n", FILE_APPEND | LOCK_EX) !== false;
        }
    } catch (Throwable) {
        // Diagnostics must never change the response.
    }
    // The PHP error log only gets the code, the reason and the reference; never paths or values.
    error_log('[JyoCanCook API] refusing to start: ' . $code . ' - ' . $reason . ' ref=' . $ref
        . ($written ? ' (details in private api-boot.log)' : ' (private api-boot.log could not be written)'));
}

/**
 * Locate and validate the private backend. Nothing is guessed: the location must be configured
 * explicitly, in one of two places (first match wins):
 *   1. server settings JYOCANCOOK_BACKEND_PATH and JYOCANCOOK_ENVIRONMENT, or
 *   2. api/config.local.php next to this file (created on the server; never packaged or committed):
 *        <?php return ['backend_path' => '/absolute/path/to/backend-staging', 'environment' => 'staging'];
 * Staging and production each use their own gateway, backend directory and environment name.
 *
 * The path must be absolute, exist, contain the backend entry files, and lie outside every
 * directory a web server may serve: the document root and any public_html ancestor of it (the
 * staging document root sits inside the main domain's public_html). There is no fallback.
 *
 * On failure `code` is a stable machine-readable identifier, `reason` a short sentence, `configured_path`
 * the path that was configured (for choosing the private diagnostic log location) and `context`
 * non-secret facts for api-boot.log. Only the backend_path and environment values are ever read from
 * api/config.local.php; nothing else in it is inspected or logged.
 *
 * @return array{path: ?string, environment: ?string, reason: string, code: string, configured_path: string, context: array}
 */
function resolveBackend(string $apiDir): array {
    $path = serverSetting('JYOCANCOOK_BACKEND_PATH');
    $environment = serverSetting('JYOCANCOOK_ENVIRONMENT');
    $context = ['config_source' => $path !== '' ? 'server setting' : 'none'];
    if ($path === '') {
        $sidecar = $apiDir . '/config.local.php';
        $context['sidecar_exists'] = is_file($sidecar);
        $context['sidecar_readable'] = $context['sidecar_exists'] && is_readable($sidecar);
        $local = null;
        if ($context['sidecar_exists'] && !$context['sidecar_readable']) {
            return ['path' => null, 'environment' => null, 'reason' => 'api/config.local.php is not readable by PHP (check file permissions)',
                'code' => 'GATEWAY_CONFIG_UNREADABLE', 'configured_path' => '', 'context' => $context];
        }
        if ($context['sidecar_exists']) {
            try {
                $local = (static fn() => require $sidecar)();
            } catch (Throwable $e) {
                $context['sidecar_error'] = get_class($e) . ' at line ' . $e->getLine();
                return ['path' => null, 'environment' => null, 'reason' => 'api/config.local.php could not be loaded (syntax or runtime error)',
                    'code' => 'GATEWAY_CONFIG_ERROR', 'configured_path' => '', 'context' => $context];
            }
            $context['config_source'] = 'api/config.local.php';
            $context['sidecar_returned'] = get_debug_type($local);
        }
        if (is_array($local)) {
            $path = trim((string)($local['backend_path'] ?? ''));
            $environment = trim((string)($local['environment'] ?? ''));
        } elseif ($context['sidecar_exists']) {
            return ['path' => null, 'environment' => null, 'reason' => 'api/config.local.php must "return [...];" an array',
                'code' => 'GATEWAY_CONFIG_NOT_ARRAY', 'configured_path' => '', 'context' => $context];
        }
    }
    $context['configured_path'] = $path;
    $context['gateway_environment'] = $environment;

    $fail = static function (string $code, string $reason) use (&$context, &$path): array {
        return ['path' => null, 'environment' => null, 'reason' => $reason, 'code' => $code, 'configured_path' => $path, 'context' => $context];
    };
    if ($path === '') {
        return $fail('BACKEND_PATH_NOT_CONFIGURED', 'backend path is not configured');
    }
    if (str_contains($path, "\0") || !preg_match('#^(/|[A-Za-z]:[\\\\/])#', $path) || preg_match('#(^|[\\\\/])\.\.([\\\\/]|$)#', $path)) {
        return $fail('BACKEND_PATH_INVALID', 'backend path must be an absolute path without ".." segments');
    }
    if (!in_array($environment, ['staging', 'production'], true)) {
        return $fail('GATEWAY_ENVIRONMENT_INVALID', 'environment must be "staging" or "production"');
    }
    $real = realpath($path);
    $context['backend_realpath'] = $real === false ? null : $real;
    $context['parent_dir_exists'] = is_dir(dirname($path));
    if ($real === false || !is_dir($real)) {
        return $fail('BACKEND_DIR_MISSING', 'backend directory does not exist (or open_basedir blocks access to it)');
    }
    $missing = [];
    foreach (['config/config.php', 'auth/Auth.php', 'generator/SiteGenerator.php'] as $marker) {
        if (!is_file($real . '/' . $marker)) {
            $missing[] = $marker;
        }
    }
    if ($missing) {
        $context['missing_files'] = $missing;
        return $fail('BACKEND_INCOMPLETE', 'backend directory is incomplete');
    }

    // Reject anything inside a web-served directory.
    if (isInsideAny($real, servedDirectories($apiDir))) {
        return $fail('BACKEND_IN_WEB_ROOT', 'backend directory is inside a web-served directory');
    }

    return ['path' => $real, 'environment' => $environment, 'reason' => '', 'code' => '', 'configured_path' => $path, 'context' => $context];
}

$backend = resolveBackend(__DIR__);
if ($backend['path'] === null) {
    // Early failure: the application logger does not exist yet, so use the private boot log.
    logBootFailure($backend['code'], $backend['reason'], $backend['context'], $backend['configured_path'], __DIR__);
    sendJson(['ok' => false, 'error' => 'Server configuration error'], 500);
}
$backendDir = $backend['path'];
$privateLogDir = $backendDir . '/tmp/logs';

try {
    $appConfig = require $backendDir . '/config/config.php';

    // The gateway and the backend must agree on the environment, and a staging backend must name
    // the hosts it may serve.
    $siteEnvironment = (string)($appConfig['site']['environment'] ?? '');
    $allowedHosts = (array)($appConfig['site']['allowed_hosts'] ?? []);
    $sessionSecret = (string)($appConfig['auth']['session_secret'] ?? '');
    $mismatch = $siteEnvironment !== $backend['environment']
        ? ['BACKEND_ENVIRONMENT_MISMATCH', 'site.environment in the backend config does not match the gateway environment']
        : ((in_array($siteEnvironment, ['staging', 'production'], true) && !$allowedHosts)
            ? ['BACKEND_ALLOWED_HOSTS_EMPTY', 'a ' . $siteEnvironment . ' backend must set site.allowed_hosts']
            : (($siteEnvironment === 'production' && (strlen($sessionSecret) < 32 || str_starts_with($sessionSecret, 'REPLACE_')))
                ? ['BACKEND_SESSION_SECRET_INVALID', 'a production backend must set auth.session_secret (at least 32 characters, not the sample placeholder)']
                : null));
    if ($mismatch !== null) {
        logBootFailure($mismatch[0], $mismatch[1], $backend['context'] + [
            'backend_environment' => $siteEnvironment,
            'allowed_hosts_count' => count($allowedHosts),
            'backend_config_local_present' => is_file($backendDir . '/config/config.local.php'),
        ], $backendDir, __DIR__);
        sendJson(['ok' => false, 'error' => 'Server configuration error'], 500);
    }

    // Application-level host guard: the staging API is only served on its own host name, so it can
    // not be reached via https://jyocancook.com/staging/api/ even if a server rule is missing.
    $requestHost = strtolower(rtrim((string)preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')), '.'));
    if ($allowedHosts && !in_array($requestHost, $allowedHosts, true)) {
        sendJson(['ok' => false, 'error' => 'Not found'], 404);
    }

    // Defence in depth behind the .htaccess redirect: never process API calls over plain HTTP.
    $https = (($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string)$_SERVER['HTTPS']) !== 'off')
        || (string)($_SERVER['SERVER_PORT'] ?? '') === '443'
        || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    if (str_starts_with((string)($appConfig['site']['url'] ?? ''), 'https://') && !$https) {
        sendJson(['ok' => false, 'error' => 'HTTPS is required'], 403);
    }

    require_once $backendDir . '/auth/Auth.php';
    require_once $backendDir . '/services/RecipeService.php';
    require_once $backendDir . '/services/ConfigService.php';
    require_once $backendDir . '/services/ImageService.php';
    require_once $backendDir . '/generator/SiteGenerator.php';

    $auth = new Auth();
    $recipeService = new RecipeService();
    $configService = new ConfigService();
    $imageService = new ImageService();

    // Helper to read JSON request body
    function getJsonBody(): array {
        static $cached = null;
        if ($cached !== null) return $cached;
        $raw = file_get_contents('php://input');
        if (!$raw) return $cached = $_POST;
        $data = json_decode($raw, true);
        return $cached = (is_array($data) ? $data : []);
    }

    // Every state-changing request from an authenticated admin must carry the session's CSRF token.
    // Missing or invalid token => 403 (no "accept the cookie alone" fallback).
    function requireCsrf(Auth $auth): void {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN']
            ?? $_POST['csrf_token']
            ?? getJsonBody()['csrf_token']
            ?? null;
        if (!is_string($token) || $token === '' || !$auth->validateCsrf($token)) {
            sendJson(['ok' => false, 'error' => 'Invalid or missing CSRF token'], 403);
        }
    }

    // Regenerate the public site after an admin change. The change itself is already stored in the
    // database; if publishing fails, the generator has rolled back, so the public site is unchanged.
    // That must never be reported as a success.
    function regenerateAfterSave(string $trigger, ?string $logDir): array {
        try {
            return (new SiteGenerator())->generateFullSite($trigger);
        } catch (Throwable $e) {
            $busy = $e instanceof RuntimeException && $e->getCode() === 409;
            $response = [
                'ok' => false,
                'saved' => true,
                'error' => 'Your changes were saved, but the public site could not be updated. '
                    . 'The public site was not changed; use Publish to try again.',
            ];
            if ($busy) {
                $response['error'] .= ' ' . $e->getMessage();
            } else {
                $response['reference'] = logPrivateError($e, $logDir);
            }
            sendJson($response, $busy ? 409 : 500);
        }
    }

    // Parse request path
    $requestUri = $_SERVER['REQUEST_URI'] ?? '/';
    $parsedPath = parse_url($requestUri, PHP_URL_PATH) ?? '/';
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $isSafeMethod = in_array($method, ['GET', 'HEAD', 'OPTIONS'], true);

    // Normalize /api/... path
    $subPath = preg_replace('/^\/api\/?/', '', $parsedPath);
    $subPath = trim((string)$subPath, '/');
    $segments = $subPath !== '' ? explode('/', $subPath) : [];
    $route = $segments[0] ?? '';

    // 1. Auth Login Route (/api/auth/login)
    if ($route === 'auth' && ($segments[1] ?? '') === 'login' && $method === 'POST') {
        $body = getJsonBody();
        $username = (string)($body['username'] ?? $body['login'] ?? '');
        $password = (string)($body['password'] ?? '');

        $result = $auth->login($username, $password);
        if (!$result['ok']) {
            sendJson($result, $result['status'] ?? 401);
        }

        sendJson([
            'ok' => true,
            'user' => [
                'id' => $result['user']['id'],
                'login' => $result['user']['username'],
                'name' => $result['user']['username'],
                'email' => $result['user']['email'],
            ],
            'csrf_token' => $result['csrf_token'],
        ]);
    }

    // 2. Auth Logout Route (/api/auth/logout): POST only, CSRF-protected when a session exists
    if ($route === 'auth' && ($segments[1] ?? '') === 'logout') {
        if ($method !== 'POST') {
            sendJson(['ok' => false, 'error' => 'Method not allowed'], 405);
        }
        if ($auth->isAuthenticated()) {
            requireCsrf($auth);
        }
        $auth->logout();
        sendJson(['ok' => true, 'message' => 'Logged out successfully']);
    }

    // 3. Admin Status Route (/api/admin/status)
    if ($route === 'admin' && ($segments[1] ?? '') === 'status' && $method === 'GET') {
        $user = $auth->getCurrentUser();
        if (!$user) {
            sendJson(['ok' => false, 'auth_required' => true, 'error' => 'Login required'], 401);
        }

        sendJson([
            'ok' => true,
            'user' => [
                'id' => $user['id'],
                'login' => $user['username'],
                'name' => $user['username'],
                'email' => $user['email'],
            ],
            'csrf_token' => $user['csrf_token'],
            'hostingerNative' => true,
        ]);
    }

    // All routes below require administrator session
    if ($route === 'admin') {
        $user = $auth->requireAuth();

        if (!$isSafeMethod) {
            requireCsrf($auth);
        }

        $subType = $segments[1] ?? '';

        // 4. Categories CRUD (/api/admin/categories)
        if ($subType === 'categories') {
            if ($method === 'GET') {
                sendJson(['data' => $configService->getCategories()]);
            }
            if ($method === 'POST') {
                $body = getJsonBody();
                $categories = $body['data'] ?? $body;
                $saved = $configService->saveCategories(is_array($categories) ? $categories : []);

                regenerateAfterSave('admin_categories_update', $privateLogDir);

                sendJson(['ok' => true, 'data' => $saved]);
            }
        }

        // 4b. Sub categories CRUD (/api/admin/subcategories)
        if ($subType === 'subcategories') {
            if ($method === 'GET') {
                sendJson(['data' => $configService->getSubcategories()]);
            }
            if ($method === 'POST') {
                $body = getJsonBody();
                $subcategories = $body['data'] ?? $body;
                $saved = $configService->saveSubcategories(is_array($subcategories) ? $subcategories : []);

                regenerateAfterSave('admin_subcategories_update', $privateLogDir);

                sendJson(['ok' => true, 'data' => $saved]);
            }
        }

        // 4c. Diets CRUD (/api/admin/diets)
        if ($subType === 'diets') {
            if ($method === 'GET') {
                sendJson(['data' => $configService->getDiets()]);
            }
            if ($method === 'POST') {
                $body = getJsonBody();
                $diets = $body['data'] ?? $body;
                $saved = $configService->saveDiets(is_array($diets) ? $diets : []);

                regenerateAfterSave('admin_diets_update', $privateLogDir);

                sendJson(['ok' => true, 'data' => $saved]);
            }
        }

        // 5. Tags CRUD (/api/admin/tags)
        if ($subType === 'tags') {
            if ($method === 'GET') {
                sendJson(['data' => $configService->getTags()]);
            }
            if ($method === 'POST') {
                $body = getJsonBody();
                $tags = $body['data'] ?? $body;
                $saved = $configService->saveTags(is_array($tags) ? $tags : []);

                regenerateAfterSave('admin_tags_update', $privateLogDir);

                sendJson(['ok' => true, 'data' => $saved]);
            }
        }

        // 6. Navigation Menu CRUD (/api/admin/menu)
        if ($subType === 'menu') {
            if ($method === 'GET') {
                sendJson(['data' => $configService->getMenu()]);
            }
            if ($method === 'POST') {
                $body = getJsonBody();
                $menu = $body['data'] ?? $body;
                $saved = $configService->saveMenu(is_array($menu) ? $menu : []);

                regenerateAfterSave('admin_menu_update', $privateLogDir);

                sendJson(['ok' => true, 'data' => $saved]);
            }
        }

        // 7. Image Upload (/api/admin/image)
        if ($subType === 'image' && $method === 'POST') {
            $body = getJsonBody();

            if (!empty($body['content']) && !empty($body['name'])) {
                $uploadResult = $imageService->handleBase64Upload((string)$body['name'], (string)$body['content']);
                sendJson($uploadResult);
            }

            if (!empty($_FILES['photo'])) {
                $file = $_FILES['photo'];
                if ($file['error'] !== UPLOAD_ERR_OK) {
                    sendJson(['ok' => false, 'error' => 'File upload failed'], 400);
                }
                $content = file_get_contents($file['tmp_name']);
                $finfo = new finfo(FILEINFO_MIME_TYPE);
                $mime = $finfo->buffer($content);
                $dataUrl = 'data:' . $mime . ';base64,' . base64_encode($content);
                $uploadResult = $imageService->handleBase64Upload($file['name'], $dataUrl);
                sendJson($uploadResult);
            }

            sendJson(['ok' => false, 'error' => 'No image payload provided'], 400);
        }

        // 7b. Draft preview (/api/admin/preview/{slug}): renders the recipe page, published or not,
        // for the signed-in admin only. Nothing is written to the public site.
        if ($subType === 'preview' && $method === 'GET') {
            $previewSlug = $segments[2] ?? '';
            $recipe = $previewSlug !== '' ? $recipeService->getRecipeBySlug($previewSlug, false) : null;
            if (!$recipe) {
                sendJson(['error' => 'Recipe not found'], 404);
            }
            $renderer = new TemplateRenderer();
            $renderer->setNavMenu($configService->getMenu());
            $html = $renderer->renderRecipePage(
                $recipe,
                $recipeService->getAllRecipes(true),
                $configService->getCategories(),
                true
            );
            http_response_code(200);
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-store, no-cache, must-revalidate');
            header('X-Robots-Tag: noindex, nofollow');
            echo $html;
            exit;
        }

        // 8. Recipes CRUD (/api/admin/recipes[/{slug}])
        if ($subType === 'recipes') {
            $recipeSlug = $segments[2] ?? null;

            // List all recipes
            if (!$recipeSlug && $method === 'GET') {
                sendJson(['data' => $recipeService->getAllRecipes(false)]);
            }

            // Get single recipe
            if ($recipeSlug && $method === 'GET') {
                $recipe = $recipeService->getRecipeBySlug($recipeSlug, false);
                if (!$recipe) {
                    sendJson(['error' => 'Recipe not found'], 404);
                }
                sendJson(['recipe' => $recipe]);
            }

            // Save recipe (Create or Update)
            if ($method === 'POST') {
                $body = getJsonBody();
                $recipeInput = $body['recipe'] ?? $body;
                $saved = $recipeService->saveRecipe($recipeInput, $recipeSlug);

                $genResult = regenerateAfterSave('admin_recipe_save', $privateLogDir);

                sendJson([
                    'ok' => true,
                    'slug' => $saved['slug'],
                    'recipe' => $saved,
                    'published' => $saved['published'],
                    'generation' => $genResult,
                ]);
            }

            // Delete recipe
            if ($recipeSlug && $method === 'DELETE') {
                $deleted = $recipeService->deleteRecipe($recipeSlug);
                if (!$deleted) {
                    sendJson(['error' => 'Recipe not found'], 404);
                }

                $genResult = regenerateAfterSave('admin_recipe_delete', $privateLogDir);

                sendJson(['ok' => true, 'generation' => $genResult]);
            }
        }

        // 9. Full Site Publish Trigger (/api/admin/publish)
        if ($subType === 'publish' && $method === 'POST') {
            $generator = new SiteGenerator();
            $genResult = $generator->generateFullSite('admin_manual_publish');
            sendJson($genResult);
        }
    }

    sendJson(['error' => 'Endpoint not found'], 404);
} catch (InvalidArgumentException $e) {
    // Validation messages are written for the admin user.
    sendJson(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (RuntimeException $e) {
    if ($e->getCode() === 409) {
        sendJson(['ok' => false, 'error' => $e->getMessage()], 409);
    }
    $ref = logPrivateError($e, $privateLogDir);
    sendJson(['ok' => false, 'error' => 'Internal server error', 'reference' => $ref], 500);
} catch (Throwable $e) {
    $ref = logPrivateError($e, $privateLogDir);
    sendJson(['ok' => false, 'error' => 'Internal server error', 'reference' => $ref], 500);
}
