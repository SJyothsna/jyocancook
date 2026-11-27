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
    private const IMAGE_WIDTHS = [480, 800, 1200]; // keep in step with bin/optimise-images.mjs
    private const IMAGE_RATIOS = ['1x1' => [1, 1], '4x3' => [4, 3], '16x9' => [16, 9]]; // keep in step with bin/optimise-images.mjs
    private const WEBP_QUALITY = 80;

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

        // 3. Re-encode as WebP (smaller files, plus small copies for phones). Re-encoding also drops anything
        //    that is not pixel data (appended code, metadata). Without GD WebP support the original format is kept.
        $webp = $this->toWebp($binary);
        if ($webp !== null) {
            $mime = 'image/webp';
            $clean = $webp['main'];
        } else {
            $clean = $this->reencode($binary, $mime);
            if ($clean === null) {
                // GD unavailable: fall back to refusing files that embed server-side code or markup
                if (preg_match('/<\?(php|=)|<script|<%|#!\/|<svg|<html/i', $binary)) {
                    throw new InvalidArgumentException('Invalid image content');
                }
                $clean = $binary;
            }
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

        // Smaller copies (name-480.webp ...). They are optional: a page only lists the ones that exist.
        foreach ($webp['variants'] ?? [] as $variantWidth => $data) {
            $variantPath = $this->uploadDir . '/' . substr($filename, 0, -strlen('.webp')) . "-{$variantWidth}.webp";
            if (@file_put_contents($variantPath, $data) !== false) {
                @chmod($variantPath, 0644);
            }
        }
        // Cropped copies for structured data and social sharing (name-1x1.jpg, name-4x3.jpg, name-16x9.jpg), also optional.
        foreach ($webp['ratios'] ?? [] as $ratio => $data) {
            $ratioPath = $this->uploadDir . '/' . substr($filename, 0, -strlen('.webp')) . "-{$ratio}.jpg";
            if (@file_put_contents($ratioPath, $data) !== false) {
                @chmod($ratioPath, 0644);
            }
        }

        return [
            'ok' => true,
            'filename' => $filename,
            'path' => '/images/recipes/' . $filename,
            'size' => strlen($clean),
            'mime' => $mime,
        ];
    }

    /**
     * WebP version of the image (largest side 1200 px at most), smaller copies for the widths
     * in IMAGE_WIDTHS that fit, and centred 1:1, 4:3 and 16:9 JPEG crops (at most 1200 px wide).
     * Same file names as bin/optimise-images.mjs. Returns null when GD cannot write WebP; throws
     * when the bytes are not a decodable image.
     *
     * @return array{main: string, variants: array<int, string>, ratios: array<string, string>}|null
     */
    private function toWebp(string $binary): ?array {
        if (!function_exists('imagecreatefromstring') || !function_exists('imagewebp') || !function_exists('imagescale')) {
            return null;
        }
        $img = @imagecreatefromstring($binary);
        if ($img === false) {
            throw new InvalidArgumentException('Corrupted or invalid image file');
        }
        if (function_exists('imagepalettetotruecolor')) {
            imagepalettetotruecolor($img);
        }
        imagealphablending($img, false);
        imagesavealpha($img, true);

        $encode = static function ($im): ?string {
            ob_start();
            $ok = imagewebp($im, null, self::WEBP_QUALITY);
            $out = (string)ob_get_clean();
            return ($ok && $out !== '') ? $out : null;
        };
        // Width $w copy of $img; the picture itself when it is not wider than $w.
        $encodeAt = static function (int $w) use ($img, $encode): ?string {
            if ($w >= imagesx($img)) return $encode($img);
            $scaled = imagescale($img, $w, -1);
            if ($scaled === false) return null;
            $out = $encode($scaled);
            imagedestroy($scaled);
            return $out;
        };

        $width = imagesx($img);
        $main = $encodeAt(max(self::IMAGE_WIDTHS));
        if ($main === null) {
            imagedestroy($img);
            return null;
        }
        // Widths up to the original; a picture narrower than the smallest size still gets one copy.
        $widths = array_values(array_filter(self::IMAGE_WIDTHS, static fn(int $w) => $w <= $width)) ?: [self::IMAGE_WIDTHS[0]];
        $variants = [];
        foreach ($widths as $w) {
            $data = $encodeAt($w);
            if ($data !== null) $variants[$w] = $data;
        }
        $ratios = [];
        foreach (self::IMAGE_RATIOS as $name => [$rw, $rh]) {
            $data = $this->ratioJpeg($img, $rw, $rh);
            if ($data !== null) $ratios[$name] = $data;
        }
        imagedestroy($img);
        return ['main' => $main, 'variants' => $variants, 'ratios' => $ratios];
    }

    /** Largest centred crop of $img with ratio $rw:$rh, at most 1200 px wide, as JPEG (transparency becomes white). */
    private function ratioJpeg($img, int $rw, int $rh): ?string {
        if (!function_exists('imagejpeg') || !function_exists('imagecreatetruecolor') || !function_exists('imagecopyresampled')) {
            return null;
        }
        $sw = imagesx($img);
        $sh = imagesy($img);
        $cw = $sw;
        $ch = (int)round($sw * $rh / $rw);
        if ($ch > $sh) {
            $ch = $sh;
            $cw = (int)round($sh * $rw / $rh);
        }
        $ow = $cw;
        $oh = $ch;
        $max = max(self::IMAGE_WIDTHS);
        if ($ow > $max) {
            $oh = (int)round($ch * $max / $cw);
            $ow = $max;
        }
        if ($ow < 1 || $oh < 1 || $cw < 1 || $ch < 1) return null;
        $dst = imagecreatetruecolor($ow, $oh);
        imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
        imagealphablending($dst, true);
        $ok = imagecopyresampled($dst, $img, 0, 0, intdiv($sw - $cw, 2), intdiv($sh - $ch, 2), $ow, $oh, $cw, $ch);
        $out = '';
        if ($ok) {
            ob_start();
            $ok = imagejpeg($dst, null, 82);
            $out = (string)ob_get_clean();
        }
        imagedestroy($dst);
        return ($ok && $out !== '') ? $out : null;
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
