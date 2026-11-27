// SEO helpers: meta descriptions, social-sharing images and the schema.org JSON-LD blocks.
// The same rules are repeated in backend/generator/TemplateRenderer.php (the pages published from the admin).
import fs from 'node:fs';
import path from 'node:path';
import type { Recipe } from './data';

export const SITE_NAME = 'JyoCanCook';
export const DEFAULT_OG_IMAGE = '/images/recipes/andhra-chicken-curry.png';

/** Ratios of the recipe image copies (x-1x1.jpg, x-4x3.jpg, x-16x9.jpg) made by bin/optimise-images.mjs and ImageService. */
export const IMAGE_RATIOS = ['1x1', '4x3', '16x9'] as const;

const MIN_DESCRIPTION = 50;
const MAX_DESCRIPTION = 155;

/** Meta descriptions are best between about 50 and 155 characters: shorter ones get the fallback added, longer ones are cut. */
export function metaDescription(text: string | undefined | null, fallback = ''): string {
  let clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length < MIN_DESCRIPTION && fallback) clean = `${clean} ${fallback}`.trim();
  if (clean.length <= MAX_DESCRIPTION) return clean;
  const head = clean.slice(0, MAX_DESCRIPTION);
  // Prefer ending on a full sentence, otherwise on a whole word.
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentenceEnd >= 60) return head.slice(0, sentenceEnd + 1);
  const wordEnd = head.slice(0, MAX_DESCRIPTION - 1).lastIndexOf(' ');
  return `${head.slice(0, wordEnd > 0 ? wordEnd : MAX_DESCRIPTION - 1).replace(/[\s,;:.\-]+$/, '')}…`;
}

/** The recipe's own description; a short one is lengthened with the recipe's facts (a few recipes have only a word or none). */
export function recipeDescription(recipe: Pick<Recipe, 'title' | 'description' | 'prepTime' | 'cookTime' | 'servings'>): string {
  const own = String(recipe.description ?? '').replace(/\s+/g, ' ').trim();
  if (own.length >= MIN_DESCRIPTION) return own;
  const total = (Number(recipe.prepTime) || 0) + (Number(recipe.cookTime) || 0);
  const facts = `${recipe.title} recipe from ${SITE_NAME}.${total > 0 ? ` Ready in ${total} minutes` : ''}${total > 0 ? ' and serves' : ' Serves'} ${recipe.servings}.`;
  return `${own} ${facts}`.trim();
}

/** The 1:1, 4:3 and 16:9 copies that exist for a local /images/... photo, e.g. [{ ratio: '16x9', src: '/images/recipes/x-16x9.jpg' }]. */
export function imageVariants(src: string, root: string = path.join(process.cwd(), 'public')): { ratio: string; src: string }[] {
  if (src.includes('..') || !/^\/images\/[^?#]+\.(png|jpe?g|webp)$/i.test(src)) return [];
  const base = src.replace(/\.[^.]+$/, '');
  return IMAGE_RATIOS.filter((r) => fs.existsSync(path.join(root, `${base}-${r}.jpg`))).map((r) => ({
    ratio: r,
    src: `${base}-${r}.jpg`,
  }));
}

/** Image for social sharing: the 16:9 copy (a small JPEG) when there is one, otherwise the photo itself. */
export function ogImagePath(src: string, root?: string): string {
  return imageVariants(src, root).find((v) => v.ratio === '16x9')?.src ?? src;
}

const abs = (siteUrl: string, p: string) => (/^https?:\/\//i.test(p) ? p : new URL(p, siteUrl).toString());

/** The 11 character YouTube id of a (nocookie) embed URL, or '' when it is not a valid one. */
export function youtubeIdFromEmbed(embedUrl: string | null | undefined): string {
  const id = embedUrl ? (embedUrl.split('/embed/')[1] ?? '').split(/[?#]/)[0] : '';
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
}

/** Anchor of a step on the recipe page: step 1 is #step-1. */
export const stepAnchor = (n: number) => `step-${n}`;

/** Comma separated keywords from the recipe's tags (no blanks, no repeats). */
export function keywordsFromTags(tags: string[] | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags ?? []) {
    const v = String(t).trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.join(', ');
}

type RecipeLdOptions = {
  siteUrl: string;
  canonicalUrl: string;
  categoryName: string;
  /** youtube-nocookie.com/embed/<id> URL of the recipe's video, when it has one. */
  embedUrl?: string | null;
  root?: string;
};

/** VideoObject for the recipe's YouTube video. Needs a valid video id and an upload date (the recipe's publish date). */
export function videoJsonLd(recipe: Recipe, embedUrl: string | null | undefined) {
  const id = youtubeIdFromEmbed(embedUrl);
  const uploaded = recipe.publishedAt && !Number.isNaN(Date.parse(recipe.publishedAt)) ? recipe.publishedAt : '';
  if (!id || !uploaded) return null;
  return {
    '@type': 'VideoObject',
    name: `How to make ${recipe.title}`,
    description: recipeDescription(recipe),
    thumbnailUrl: [`https://i.ytimg.com/vi/${id}/hqdefault.jpg`],
    uploadDate: uploaded,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
  };
}

export function recipeJsonLd(recipe: Recipe, o: RecipeLdOptions) {
  const variants = imageVariants(recipe.image, o.root).map((v) => abs(o.siteUrl, v.src));
  const keywords = keywordsFromTags(recipe.tags);
  const video = videoJsonLd(recipe, o.embedUrl);
  const cuisine = String(recipe.cuisine ?? '').trim();
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title,
    description: recipeDescription(recipe),
    author: { '@type': 'Person', name: SITE_NAME, url: `${o.siteUrl.replace(/\/$/, '')}/` },
    image: variants.length ? variants : [abs(o.siteUrl, recipe.image)],
    recipeYield: String(recipe.servings),
    prepTime: `PT${recipe.prepTime}M`,
    cookTime: `PT${recipe.cookTime}M`,
    recipeCategory: o.categoryName,
    ...(cuisine ? { recipeCuisine: cuisine } : {}),
    ...(keywords ? { keywords } : {}),
    recipeIngredient: recipe.ingredients.map((x) =>
      [x.amount, x.unit, x.name].filter((v) => v !== null && v !== '').join(' '),
    ),
    recipeInstructions: recipe.steps.map((s, i) => ({
      '@type': 'HowToStep',
      name: s.title,
      text: s.text,
      url: `${o.canonicalUrl}#${stepAnchor(i + 1)}`,
      ...(s.image ? { image: abs(o.siteUrl, s.image) } : {}),
    })),
    ...(recipe.nutrition
      ? {
          nutrition: {
            '@type': 'NutritionInformation',
            ...(recipe.nutrition.calories !== undefined ? { calories: `${recipe.nutrition.calories} calories` } : {}),
            ...(recipe.nutrition.carbs !== undefined ? { carbohydrateContent: `${recipe.nutrition.carbs} g` } : {}),
            ...(recipe.nutrition.protein !== undefined ? { proteinContent: `${recipe.nutrition.protein} g` } : {}),
            ...(recipe.nutrition.fat !== undefined ? { fatContent: `${recipe.nutrition.fat} g` } : {}),
            ...(recipe.nutrition.fiber !== undefined ? { fiberContent: `${recipe.nutrition.fiber} g` } : {}),
          },
        }
      : {}),
    ...(video ? { video } : {}),
  };
}

/** BreadcrumbList that matches the visible breadcrumb: Home > Category > Recipe. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** WebSite with the site search, for the home page. */
export function websiteJsonLd(siteUrl: string) {
  const site = siteUrl.replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${site}/`,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site}/search/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** JSON for a <script type="application/ld+json"> block ("<" is escaped so the data can never close the tag). */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
