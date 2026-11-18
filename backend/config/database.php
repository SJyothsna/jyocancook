<?php
declare(strict_types=1);

/**
 * JyoCanCook Database Connection Manager (PDO)
 */

class Database {
    private static ?PDO $instance = null;

    public static function getConnection(?array $config = null): PDO {
        if (self::$instance === null) {
            if ($config === null) {
                $appConfig = require __DIR__ . '/config.php';
                $config = $appConfig['db'];
                // Production must never run against the staging database (staging data and tables
                // would be read and written by the live site). Staging databases are named *staging*.
                if (($appConfig['site']['environment'] ?? '') === 'production' && stripos((string)$config['name'], 'staging') !== false) {
                    throw new RuntimeException('Refusing to start: the production environment is configured with a staging database name.');
                }
            }

            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=%s',
                $config['host'],
                $config['port'] ?? 3306,
                $config['name'],
                $config['charset'] ?? 'utf8mb4'
            );

            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"
            ];

            try {
                self::$instance = new PDO($dsn, $config['user'], $config['pass'], $options);
            } catch (PDOException $e) {
                error_log('[JyoCanCook DB Error] ' . $e->getMessage());
                throw new RuntimeException('Database connection failed. Please verify credentials in backend/config/config.local.php or environment variables.');
            }
        }

        return self::$instance;
    }

    public static function resetConnection(): void {
        self::$instance = null;
    }
}
