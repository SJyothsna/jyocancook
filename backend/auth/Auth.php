<?php
declare(strict_types=1);

/**
 * JyoCanCook Secure Authentication & Session Manager
 * Features:
 * - Secure Session Handling (HttpOnly, Secure, SameSite, Lifetime)
 * - Password Verification (BCrypt / Argon2ID)
 * - CSRF Token Generation & Validation
 * - Brute-Force Rate Limiting (IP-based)
 * - Session Fixation Prevention
 */

require_once dirname(__DIR__) . '/config/database.php';

class Auth {
    private PDO $pdo;
    private array $config;

    public function __construct(?PDO $pdo = null) {
        $this->pdo = $pdo ?? Database::getConnection();
        $appConfig = require dirname(__DIR__) . '/config/config.php';
        $this->config = $appConfig['auth'];
        $this->startSession();
    }

    private function startSession(): void {
        if (session_status() === PHP_SESSION_NONE) {
            $isHttps = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on')
                || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

            session_set_cookie_params([
                'lifetime' => $this->config['session_lifetime'],
                'path' => '/',
                'domain' => '',
                'secure' => $isHttps,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);

            session_name($this->config['session_name']);
            session_start();
        }
    }

    /**
     * Client IP used for rate limiting.
     * Only REMOTE_ADDR (the TCP peer) is trusted by default. Forwarded headers
     * (CF-Connecting-IP / X-Forwarded-For) are honoured ONLY when REMOTE_ADDR is inside
     * a configured trusted proxy CIDR, so a client cannot choose its own rate-limit identity.
     */
    public function getClientIp(): string {
        $remote = (string)($_SERVER['REMOTE_ADDR'] ?? '');
        if (!filter_var($remote, FILTER_VALIDATE_IP)) {
            return '0.0.0.0'; // conservative fallback: all unknown peers share one bucket
        }

        $trusted = $this->config['trusted_proxies'] ?? [];
        if (!$trusted || !$this->ipInRanges($remote, $trusted)) {
            return $remote;
        }

        $cf = trim((string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
        if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP)) {
            return $cf;
        }

        // Walk X-Forwarded-For from the right, skipping our own trusted proxies;
        // the first untrusted address is the closest client we can vouch for.
        $xff = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
        if ($xff !== '') {
            foreach (array_reverse(array_map('trim', explode(',', $xff))) as $candidate) {
                if (!filter_var($candidate, FILTER_VALIDATE_IP)) {
                    break;
                }
                if (!$this->ipInRanges($candidate, $trusted)) {
                    return $candidate;
                }
            }
        }

        return $remote;
    }

    private function ipInRanges(string $ip, array $ranges): bool {
        $ipBin = @inet_pton($ip);
        if ($ipBin === false) {
            return false;
        }
        foreach ($ranges as $range) {
            $range = trim((string)$range);
            [$net, $bits] = array_pad(explode('/', $range, 2), 2, null);
            $netBin = @inet_pton((string)$net);
            if ($netBin === false || strlen($netBin) !== strlen($ipBin)) {
                continue;
            }
            $maxBits = strlen($netBin) * 8;
            $bits = $bits === null || $bits === '' ? $maxBits : max(0, min($maxBits, (int)$bits));
            $fullBytes = intdiv($bits, 8);
            if ($fullBytes > 0 && substr($ipBin, 0, $fullBytes) !== substr($netBin, 0, $fullBytes)) {
                continue;
            }
            $rem = $bits % 8;
            if ($rem === 0) {
                return true;
            }
            $mask = (0xFF << (8 - $rem)) & 0xFF;
            if ((ord($ipBin[$fullBytes]) & $mask) === (ord($netBin[$fullBytes]) & $mask)) {
                return true;
            }
        }
        return false;
    }

    private function windowCutoff(): string {
        $window = (int)$this->config['rate_limit_lockout_seconds'];
        return gmdate('Y-m-d H:i:s', time() - $window);
    }

    private function countFailures(string $key): int {
        $stmt = $this->pdo->prepare("
            SELECT COUNT(*) FROM `login_attempts`
            WHERE `ip_address` = :key AND `attempted_at` > :cutoff
        ");
        $stmt->execute([':key' => $key, ':cutoff' => $this->windowCutoff()]);
        return (int)$stmt->fetchColumn();
    }

    /**
     * Rate-limit keys share the existing `login_attempts.ip_address` column (VARCHAR(45)):
     * a plain IP for per-client limiting, or "a:<40 hex>" for per-account limiting.
     */
    private function accountKey(string $identity): string {
        return 'a:' . substr(hash('sha256', strtolower($identity)), 0, 40);
    }

    public function isRateLimited(?string $accountKey = null): bool {
        $maxAttempts = (int)$this->config['rate_limit_max_attempts'];
        if ($this->countFailures($this->getClientIp()) >= $maxAttempts) {
            return true;
        }
        if ($accountKey !== null) {
            return $this->countFailures($accountKey) >= (int)($this->config['rate_limit_account_max_attempts'] ?? 20);
        }
        return false;
    }

    public function recordLoginAttempt(bool $success, ?string $accountKey = null): void {
        $keys = array_filter([$this->getClientIp(), $accountKey]);
        if ($success) {
            // Clear recent failed attempts upon successful login
            $stmt = $this->pdo->prepare("DELETE FROM `login_attempts` WHERE `ip_address` = :key");
            foreach ($keys as $key) {
                $stmt->execute([':key' => $key]);
            }
            return;
        }

        $stmt = $this->pdo->prepare("INSERT INTO `login_attempts` (`ip_address`, `attempted_at`) VALUES (:key, :at)");
        $now = gmdate('Y-m-d H:i:s');
        foreach ($keys as $key) {
            $stmt->execute([':key' => $key, ':at' => $now]);
        }
        // Opportunistic cleanup of rows older than two windows
        $this->pdo->prepare("DELETE FROM `login_attempts` WHERE `attempted_at` < :old")
            ->execute([':old' => gmdate('Y-m-d H:i:s', time() - 2 * (int)$this->config['rate_limit_lockout_seconds'])]);
    }

    public function login(string $usernameOrEmail, string $password): array {
        $tooMany = [
            'ok' => false,
            'error' => 'Too many failed login attempts. Please wait 15 minutes before trying again.',
            'status' => 429,
        ];

        if ($this->isRateLimited()) {
            return $tooMany;
        }

        $usernameOrEmail = trim($usernameOrEmail);
        if ($usernameOrEmail === '' || $password === '') {
            return ['ok' => false, 'error' => 'Username/Email and password are required', 'status' => 400];
        }

        // Separate parameters: MySQL native prepares reject one named parameter used twice.
        $stmt = $this->pdo->prepare("
            SELECT `id`, `username`, `email`, `password_hash`
            FROM `admins`
            WHERE `username` = :username OR `email` = :email
            LIMIT 1
        ");
        $stmt->execute([':username' => $usernameOrEmail, ':email' => $usernameOrEmail]);
        $user = $stmt->fetch();

        // Existing accounts are limited by account id (so username/email variants share one
        // counter); unknown identifiers by the normalised text typed.
        $accountKey = $this->accountKey($user ? 'id:' . $user['id'] : 'name:' . $usernameOrEmail);
        if ($this->isRateLimited($accountKey)) {
            return $tooMany;
        }

        if (!$user || !password_verify($password, $user['password_hash'])) {
            $this->recordLoginAttempt(false, $accountKey);
            return ['ok' => false, 'error' => 'Invalid username or password', 'status' => 401];
        }

        // Login success: regenerate session ID to prevent fixation
        session_regenerate_id(true);

        $_SESSION['session_scope'] = $this->sessionScope();
        $_SESSION['admin_logged_in'] = true;
        $_SESSION['admin_user_id'] = $user['id'];
        $_SESSION['admin_username'] = $user['username'];
        $_SESSION['admin_email'] = $user['email'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        $_SESSION['logged_in_at'] = time();

        $this->recordLoginAttempt(true, $accountKey);

        return [
            'ok' => true,
            'user' => [
                'id' => (string)$user['id'],
                'username' => $user['username'],
                'email' => $user['email'],
            ],
            'csrf_token' => $_SESSION['csrf_token'],
        ];
    }

    public function logout(): void {
        $_SESSION = [];
        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params["path"],
                $params["domain"],
                $params["secure"],
                $params["httponly"]
            );
        }
        session_destroy();
    }

    /** Which site a session belongs to (staging and production share one PHP session store). */
    private function sessionScope(): string {
        return (string)$this->config['session_name'];
    }

    public function isAuthenticated(): bool {
        if (empty($_SESSION['admin_logged_in']) || empty($_SESSION['admin_user_id'])) {
            return false;
        }
        // A session created by another site is never accepted. Production requires its own marker;
        // staging also accepts sessions created before the marker existed.
        $marker = $_SESSION['session_scope'] ?? null;
        return $marker !== null
            ? $marker === $this->sessionScope()
            : $this->sessionScope() !== 'jyo_prod_admin_session';
    }

    public function getCurrentUser(): ?array {
        if (!$this->isAuthenticated()) {
            return null;
        }

        return [
            'id' => (string)$_SESSION['admin_user_id'],
            'username' => $_SESSION['admin_username'] ?? 'admin',
            'email' => $_SESSION['admin_email'] ?? '',
            'csrf_token' => $this->getCsrfToken(),
        ];
    }

    public function getCsrfToken(): string {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    public function validateCsrf(?string $token): bool {
        if (empty($_SESSION['csrf_token']) || empty($token)) {
            return false;
        }
        return hash_equals($_SESSION['csrf_token'], $token);
    }

    public function requireAuth(): ?array {
        $user = $this->getCurrentUser();
        if (!$user) {
            http_response_code(401);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['ok' => false, 'error' => 'Authentication required', 'auth_required' => true]);
            exit;
        }
        return $user;
    }
}
