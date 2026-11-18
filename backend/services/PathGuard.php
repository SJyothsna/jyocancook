<?php
declare(strict_types=1);

/**
 * Filesystem guards that keep staging and production isolated from each other and keep
 * private backend code out of any directory a web server can serve.
 */
final class PathGuard {
    /** True when $path equals $root or lies inside it. */
    public static function isWithin(string $path, string $root): bool {
        $p = rtrim(str_replace('\\', '/', $path), '/');
        $r = rtrim(str_replace('\\', '/', $root), '/');
        return $p === $r || str_starts_with($p . '/', $r . '/');
    }

    /**
     * Every directory that a web server may expose for the given document roots: the document
     * roots themselves plus any ancestor named public_html (the staging document root sits inside
     * the main domain's public_html, so both are public).
     *
     * @param string[] $docRoots
     * @return string[] real paths
     */
    public static function publicRoots(array $docRoots): array {
        $roots = [];
        foreach ($docRoots as $dir) {
            $real = $dir !== '' ? realpath($dir) : false;
            if ($real === false) {
                continue;
            }
            $roots[$real] = true;
            $d = $real;
            while (true) {
                if (basename($d) === 'public_html') {
                    $roots[$d] = true;
                }
                $parent = dirname($d);
                if ($parent === $d) {
                    break;
                }
                $d = $parent;
            }
        }
        return array_keys($roots);
    }

    /** True when $realPath is inside any web-exposed directory derived from $docRoots. */
    public static function isPubliclyServed(string $realPath, array $docRoots): bool {
        foreach (self::publicRoots($docRoots) as $root) {
            if (self::isWithin($realPath, $root)) {
                return true;
            }
        }
        return false;
    }

    /** realpath() for a path that may not exist yet: resolves the nearest existing ancestor. */
    public static function resolveFuture(string $path): ?string {
        $path = rtrim(str_replace('\\', '/', $path), '/');
        if ($path === '' || preg_match('#(^|/)\.\.(/|$)#', $path)) {
            return null;
        }
        $tail = [];
        $probe = $path;
        while ($probe !== '' && !file_exists($probe)) {
            array_unshift($tail, basename($probe));
            $next = dirname($probe);
            if ($next === $probe) {
                return null;
            }
            $probe = $next;
        }
        $real = $probe !== '' ? realpath($probe) : false;
        if ($real === false) {
            return null;
        }
        return rtrim(str_replace('\\', '/', $real), '/') . ($tail ? '/' . implode('/', $tail) : '');
    }

    /**
     * Validates the directory the static publisher is allowed to write to and returns its real path.
     *
     *  - staging:     must be an existing, writable ".../public_html/staging"
     *  - production:  must be an existing, writable ".../public_html"
     *  - development: local CLI use only, no layout restrictions
     * The private backend directory may never overlap the publish target.
     */
    public static function assertPublishTarget(array $site, string $backendDir): string {
        $env = (string)($site['environment'] ?? 'development');
        $configured = rtrim((string)($site['public_path'] ?? ''), '/\\');

        if ($env === 'development') {
            return $configured;
        }
        if ($env !== 'staging' && $env !== 'production') {
            throw new RuntimeException('Unknown site.environment (use staging or production)');
        }

        $real = $configured !== '' ? realpath($configured) : false;
        if ($real === false || !is_dir($real) || !is_writable($real)) {
            throw new RuntimeException("site.public_path is missing or not writable for the {$env} environment");
        }

        $layoutOk = $env === 'staging'
            ? basename($real) === 'staging' && basename(dirname($real)) === 'public_html'
            : basename($real) === 'public_html';
        if (!$layoutOk) {
            throw new RuntimeException("site.public_path does not match the expected {$env} layout");
        }

        $backendReal = realpath($backendDir);
        if ($backendReal !== false && (self::isWithin($backendReal, $real) || self::isWithin($real, $backendReal))) {
            throw new RuntimeException('The private backend and the publish target must not overlap');
        }

        return $real;
    }

    /** Uploads must land inside the publish target of the same environment. */
    public static function assertUploadDir(array $site, string $uploadDir, string $backendDir): void {
        if (($site['environment'] ?? 'development') === 'development') {
            return;
        }
        $target = self::assertPublishTarget($site, $backendDir);
        $upload = self::resolveFuture($uploadDir);
        if ($upload === null || !self::isWithin($upload, str_replace('\\', '/', $target))) {
            throw new RuntimeException('site.upload_path must be inside site.public_path');
        }
        // The staging site lives inside the production web root: production may not write into it.
        if (($site['environment'] ?? '') === 'production' && self::isWithin($upload, str_replace('\\', '/', $target) . '/staging')) {
            throw new RuntimeException('site.upload_path must not be inside the staging site');
        }
    }
}
