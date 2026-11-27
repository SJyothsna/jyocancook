#!/usr/bin/env node
/**
 * Creates WebP copies of the PNG/JPG images in public/images, in the widths the pages ask for,
 * and centre-cropped JPEG copies in the three ratios search engines and social sites ask for.
 *
 *   public/images/recipes/masala-dosa.png  ->  masala-dosa-480.webp, masala-dosa-800.webp, masala-dosa-1200.webp
 *                                              masala-dosa-1x1.jpg, masala-dosa-4x3.jpg, masala-dosa-16x9.jpg
 *
 * The original file is left alone (it stays the <img src> fallback).
 * Pages list the WebP files in a srcset. Only sizes up to the original width are made.
 * The ratio copies (at most 1200 px wide) go into the Recipe structured data (1:1, 4:3, 16:9), and the 16:9
 * one is the social-sharing image.
 * The same naming rules are used by src/lib/responsive-image.ts, src/lib/seo.ts, backend/generator/TemplateRenderer.php
 * and backend/services/ImageService.php (uploads).
 *
 * Run:  npm run optimise:images        (safe to repeat; files that are up to date are skipped)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const WIDTHS = [480, 800, 1200];
export const RATIOS = { '1x1': [1, 1], '4x3': [4, 3], '16x9': [16, 9] };
const QUALITY = 80;
const JPEG_QUALITY = 82;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = path.join(root, 'public/images');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    // The ratio copies are JPEGs too; they are results, not sources.
    else if (/\.(png|jpe?g)$/i.test(entry.name) && !/-(1x1|4x3|16x9)\.jpg$/i.test(entry.name)) yield full;
  }
}

function variantPath(file, width) {
  return file.replace(/\.[^.]+$/, `-${width}.webp`);
}

function ratioPath(file, ratio) {
  return file.replace(/\.[^.]+$/, `-${ratio}.jpg`);
}

/** Largest centred crop with the wanted ratio, at most 1200 px wide (never enlarged). */
export function cropSize(width, height, [rw, rh]) {
  // The largest crop of the picture with the wanted ratio ...
  let w = width;
  let h = Math.round((width * rh) / rw);
  if (h > height) {
    h = height;
    w = Math.round((height * rw) / rh);
  }
  // ... scaled down to at most 1200 px wide.
  const max = WIDTHS[WIDTHS.length - 1];
  if (w > max) {
    h = Math.round((h * max) / w);
    w = max;
  }
  return { w, h };
}

export async function optimiseFile(file) {
  const meta = await sharp(file).metadata();
  const sourceTime = fs.statSync(file).mtimeMs;
  // Sizes up to the original width; a source narrower than the smallest size still gets one copy.
  let widths = WIDTHS.filter((w) => w <= (meta.width ?? 0));
  if (widths.length === 0) widths = [WIDTHS[0]];

  const made = [];
  for (const width of widths) {
    const out = variantPath(file, width);
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= sourceTime) continue;
    await sharp(file)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5 })
      .toFile(out);
    made.push(path.basename(out));
  }

  for (const [ratio, dims] of Object.entries(RATIOS)) {
    const out = ratioPath(file, ratio);
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= sourceTime) continue;
    const { w, h } = cropSize(meta.width ?? 0, meta.height ?? 0, dims);
    if (w < 1 || h < 1) continue;
    await sharp(file)
      .rotate()
      .resize({ width: w, height: h, fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(out);
    made.push(path.basename(out));
  }
  return made;
}

async function main() {
  // The logo is a small fixed-size image used at 48-64px; it does not need variants.
  let files = 0;
  let created = 0;
  for (const file of walk(imagesDir)) {
    if (path.basename(file) === 'logo.png') continue;
    files += 1;
    const made = await optimiseFile(file);
    created += made.length;
    if (made.length) console.log(`${path.relative(root, file)} -> ${made.join(', ')}`);
  }
  console.log(`Checked ${files} image(s), created ${created} WebP file(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
