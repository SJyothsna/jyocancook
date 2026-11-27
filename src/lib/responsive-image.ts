// Responsive WebP copies of recipe photos. The files are made by bin/optimise-images.mjs (and, for
// uploads, by backend/services/ImageService.php): /images/recipes/x.png -> x-480.webp, x-800.webp, x-1200.webp.
// The same rules are repeated in backend/generator/TemplateRenderer.php.
import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_WIDTHS = [480, 800, 1200];

/** Returns the srcset for a local /images/... file, or null when no WebP copies exist (e.g. an SVG). */
export function webpSrcset(src: string, root: string = path.join(process.cwd(), 'public')): string | null {
  if (src.includes('..') || !/^\/images\/[^?#]+\.(png|jpe?g|webp)$/i.test(src)) return null;
  const base = src.replace(/\.[^.]+$/, '');
  const found = IMAGE_WIDTHS.filter((w) => fs.existsSync(path.join(root, `${base}-${w}.webp`)));
  return found.length ? found.map((w) => `${base}-${w}.webp ${w}w`).join(', ') : null;
}
