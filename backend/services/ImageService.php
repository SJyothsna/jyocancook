<?php
declare(strict_types=1);

/**
 * JyoCanCook Secure Image Upload & Management Service
 *
 * Raster images only (JPEG, PNG, WebP). SVG is intentionally NOT accepted because it is an
 * XML document that can carry script. The server decides the file extension from the detected
 * content type, never from the client-supplied name or type, and re-encodes the image with GD
 * (when available) so appended payloads, polyglots and metadata are discarded.
 */
require_once __DIR__ . '/PathGuard.php';

class ImageService {
    private string $uploadDir;
    private int $maxBytes;
    private const MAX_PIXELS = 40000000; // 40 megapixels (decompression-bomb guard)
    private const MAX_DIMENSION = 10000;

    private array $allowedMimes = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
    ];

    private array $imageTypeToMime = [
        IMAGETYPE_JPEG => 'image/jpeg',
        IMAGETYPE_PNG  => 'image/png',
        IMAGETYPE_WEBP => 'image/webp',
    ];

    public function __construct(?string $uploadDir = null, int $maxBytes = 4194304) {
        $appConfig = require dirname(__DIR__) . '/config/config.php';
        $this->uploadDir = $uploadDir ?? $appConfig['site']['upload_path'];
        $this->maxBytes = $maxBytes; // 4 MB

        if ($uploadDir === null) {
            // On a server, uploads may only land inside this environment's own web folder.
            PathGuard::assertUploadDir($appConfig['site'], $this->uploadDir, dirname(__DIR__));
        }

        if (!is_dir($this->uploadDir)) {
            mkdir($this->uploadDir, 0755, true);
        }

        $this->secureUploadDirectory();
    }

    /**
     * Prevents PHP or script execution inside upload directory via .htaccess
     */
    public function secureUploadDirectory(): void {
        $htaccessPath = $this->uploadDir . '/.htaccess';
        if (!file_exists($htaccessPath)) {
            $rules = <<<HTACCESS
# Block script execution in upload directory
<FilesMatch "\.(php|phtml|php3|php4|php5|php7|php8|phps|phar|cgi|pl|py|sh|shtml|htaccess)$">
    Order Deny,Allow
    Deny from all
</FilesMatch>
Options -ExecCGI -Indexes
HTACCESS;
            @file_put_contents($htaccessPath, $rules);
        }
    }

    public function handleBase64Upload(string $rawName, string $dataUrl): array {
        if (!str_contains($dataUrl, 'base64,')) {
            throw new InvalidArgumentException('Invalid image payload format');
        }

        $parts = explode('base64,', $dataUrl, 2);
        $base64 = $parts[1] ?? '';
        // Reject oversized payloads before decoding (base64 is ~4/3 of the binary size)
        if (strlen($base64) > (int)ceil($this->maxBytes * 4 / 3) + 16) {
            throw new InvalidArgumentException('Image exceeds maximum allowed size of 4 MB');
        }
        $binary = base64_decode($base64, true);

        if ($binary === false || strlen($binary) === 0) {
            throw new InvalidArgumentException('Failed to decode image data');
        }

        if (strlen($binary) > $this->maxBytes) {
            throw new InvalidArgumentException('Image exceeds maximum allowed size of 4 MB');
        }

        // 1. Content sniffing: the bytes decide the type
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = (string)$finfo->buffer($binary);

        if (!isset($this->allowedMimes[$mime])) {
            throw new InvalidArgumentException('Unsupported image format (allowed: JPG, PNG, WebP)');
        }

        // 2. Structural validation: must parse as a real raster image of the same type
        $imgInfo = @getimagesizefromstring($binary);
        if ($imgInfo === false || ($this->imageTypeToMime[$imgInfo[2]] ?? null) !== $mime) {
            throw new InvalidArgumentException('Corrupted or invalid image file');
        }
        [$width, $height] = $imgInfo;
        if ($width < 1 || $height < 1 || $width > self::MAX_DIMENSION || $height > self::MAX_DIMENSION || $width * $height > self::MAX_PIXELS) {
            throw new InvalidArgumentException('Image dimensions are too large');
        }

        // 3. Re-encode: drops anything that is not pixel data (appended code, metadata)
        $clean = $this->reencode($binary, $mime);
        if ($clean === null) {
            // GD unavailable: fall back to refusing files that embed server-side code or markup
            if (preg_match('/<\?(php|=)|<script|<%|#!\/|<svg|<html/i', $binary)) {
                throw new InvalidArgumentException('Invalid image content');
            }
            $clean = $binary;
        }

        $ext = $this->allowedMimes[$mime];

        $slugName = strtolower(preg_replace('/[^a-z0-9]+/i', '-', pathinfo($rawName, PATHINFO_FILENAME)));
        $slugName = trim($slugName, '-');
        if ($slugName === '') $slugName = 'recipe-photo';
        $slugName = substr($slugName, 0, 60);

        $filename = sprintf('%s-%s.%s', $slugName, bin2hex(random_bytes(4)), $ext);
        $targetPath = $this->uploadDir . '/' . $filename;

        if (file_put_contents($targetPath, $clean) === false) {
            throw new RuntimeException('Failed to write uploaded image to disk');
        }
        @chmod($targetPath, 0644);

        return [
            'ok' => true,
            'filename' => $filename,
            'path' => '/images/recipes/' . $filename,
            'size' => strlen($clean),
            'mime' => $mime,
        ];
    }

    /**
     * Decode and re-encode with GD. Returns null when GD (or the needed codec) is unavailable;
     * throws when the bytes are not a decodable image.
     */
    private function reencode(string $binary, string $mime): ?string {
        $encoders = [
            'image/jpeg' => 'imagejpeg',
            'image/png'  => 'imagepng',
            'image/webp' => 'imagewebp',
        ];
        if (!function_exists('imagecreatefromstring') || !function_exists($encoders[$mime])) {
            return null;
        }

        $img = @imagecreatefromstring($binary);
        if ($img === false) {
            throw new InvalidArgumentException('Corrupted or invalid image file');
        }

        if ($mime !== 'image/jpeg') {
            imagealphablending($img, false);
            imagesavealpha($img, true);
        }

        ob_start();
        $ok = match ($mime) {
            'image/jpeg' => imagejpeg($img, null, 92),
            'image/png'  => imagepng($img, null, 6),
            'image/webp' => imagewebp($img, null, 90),
        };
        $out = (string)ob_get_clean();
        imagedestroy($img);

        if (!$ok || $out === '') {
            return null;
        }
        return $out;
    }
}
