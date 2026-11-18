<?php
declare(strict_types=1);

/**
 * JyoCanCook initial admin account creator (CLI only).
 *
 * Usage (over SSH, from the directory that contains backend/):
 *   php backend/db/create-admin.php
 *
 * The password is typed interactively (hidden) and is never stored in a file,
 * shell history, or environment variable. Only a bcrypt hash is written to the
 * `admins` table. The script refuses to run if an admin already exists.
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Forbidden');
}

require_once dirname(__DIR__) . '/config/database.php';

function promptLine(string $label): string {
    echo $label;
    $line = fgets(STDIN);
    return $line === false ? '' : trim($line);
}

function promptHidden(string $label): string {
    echo $label;
    $hasStty = stripos(PHP_OS, 'WIN') !== 0;
    if ($hasStty) {
        shell_exec('stty -echo');
    }
    $line = fgets(STDIN);
    if ($hasStty) {
        shell_exec('stty echo');
    }
    echo "\n";
    return $line === false ? '' : rtrim($line, "\r\n");
}

function fail(string $message): never {
    fwrite(STDERR, "Error: {$message}\n");
    exit(1);
}

try {
    // Do NOT connect yet: Hostinger's MySQL closes idle connections after 20 seconds (wait_timeout),
    // and the prompts below take longer than that. The connection is opened only after the last
    // answer, and the "admin already exists" check runs on that same fresh connection.
    $username = promptLine('Admin username (3-60 chars, letters/digits/._-): ');
    if (!preg_match('/^[A-Za-z0-9._-]{3,60}$/', $username)) {
        fail('Invalid username.');
    }

    $email = promptLine('Admin email: ');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
        fail('Invalid email address.');
    }

    $password = promptHidden('Password (min 14 chars): ');
    if (strlen($password) < 14) {
        fail('Password must be at least 14 characters.');
    }
    $confirm = promptHidden('Confirm password: ');
    if (!hash_equals($password, $confirm)) {
        fail('Passwords do not match.');
    }

    // Hash first (slow on purpose), then connect and use the connection immediately.
    $hash = password_hash($password, PASSWORD_DEFAULT, ['cost' => 12]);

    $pdo = Database::getConnection();
    if ((int)$pdo->query('SELECT COUNT(*) FROM `admins`')->fetchColumn() > 0) {
        fail('An admin account already exists. To reset it, delete the row from the `admins` table in phpMyAdmin and run this script again.');
    }

    $stmt = $pdo->prepare('INSERT INTO `admins` (`username`, `email`, `password_hash`) VALUES (:u, :e, :h)');
    $stmt->execute([
        ':u' => $username,
        ':e' => $email,
        ':h' => $hash,
    ]);

    echo "Admin account '{$username}' created. You can now sign in at /admin/.\n";
} catch (Throwable $e) {
    fail($e->getMessage());
}
