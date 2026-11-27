# Defects to fix

1. [FIXED] Production Admin page: the top navigation showed old labels and order because it was baked into `admin/index.html` at build time. It is now loaded from the saved Navigation Menu (the existing `/api/admin/menu`) when the page opens and after the menu is saved: labels and order follow the menu, hidden items are left out, and no static-page rebuild is needed.
2. [FIXED] Admin page, Recipes tab: a category filter sits next to the Add recipe button, so the list can be narrowed to one category (All categories shows everything).
3. [FIXED] Add recipe: the recipe image field was pre-filled with another recipe's photo (`andhra-chicken-curry.png`). It is now empty for a new recipe; it fills in when a photo is uploaded, and a recipe saved without one uses the placeholder image.
4. [FIXED] Admin page, Navigation menu, Categories, Sub categories and Diets tabs: the order is no longer typed in an "order" number column. Each row has up and down arrows to move it, and the order is saved from the row positions.
5. [FIXED] Add / update recipe: Diet is now a set of tick boxes instead of a drop down, so a recipe can have more than one diet (for example Vegetarian and Vegan). It is listed on every diet page it belongs to, and its card and filters show all of them. Production needs the one-off `ALTER TABLE recipes MODIFY diet VARCHAR(120) NOT NULL DEFAULT 'Vegetarian';` (the migration does it too).
6. [FIXED] Add / update recipe: a recipe saved without a Diet silently defaults to Vegetarian, so a non-veg recipe can end up on the Vegetarian page. At least one Diet must now be chosen.
7. [FIXED] Diets: the admin has a Diets tab where diets (Vegetarian, Non-Vegetarian, Vegan...) are added, renamed and ordered. The recipe Diet dropdown uses that list, and each diet gets its own page at `/category/<diet slug>/`.
8. [FIXED] Admin page, Manage categories: when a category has many sub categories, the category name is not shown fully.
9. [FIXED] Add / update recipe: when adding instructions under a section, I should be able to format them as bullet points, either numbered or dotted.
10. [FIXED] Add recipe / recipe page: "tbsp" should be displayed as "Tbsp" (first letter capital).
11. [FIXED] Add / update recipe: ingredients and sections should be movable up and down.
12. [FIXED] Menu: Vegetarian / Non-Vegetarian pages showed no recipes after those categories were removed in Manage categories. The pages are now always published and list recipes by their Diet.
13. [FIXED] Recipe page: servings is displayed as `2 1/5` instead of `2.5`.
14. [FIXED] Add recipe: when instructions are added under a section, each instruction is entered on a separate line but everything is displayed as one paragraph. The line breaks should be retained.
15. [FIXED] Recipe page: in the recipe title area, there is empty space next to the description. The widths of the title, description and other elements in the recipe title area are not consistent.
16. [FIXED] Recipe page: add "Recipe by" below the recipe title.
17. [FIXED] Recipe page: a tag can repeat the category chip (for example "Breakfast" appears twice on Masala Dosa) because the page renders the category chip and every tag from the data.
18. [FIXED] Recipe page: when printing, the entire page is printed. Only the recipe should print.
19. [FIXED] Add recipe: the measurement "TBSP" should display as "Tbsp", but "Tsp" should display as "tsp" (lowercase).
20. [FIXED] Recipe page: layout change. The photo sits on the left. Beside it, first the "Watch how it's made" video row (it shows the video's own YouTube thumbnail and opens the video in a pop-up), then the description and the story (if any). Text longer than the photo continues below it at full width. The prep time, cook time, servings, difficulty and calories card sits just above the nutrition strip.

21. [FIXED] Recipe page: the separate "Watch how it's made" video row is gone. The recipe photo (same size as before) is shown by default; if the recipe has a video it carries a play button and a "Watch video" label. Clicking it swaps the photo for the YouTube player in the same space (the player only loads at that point). No pop-up any more (Astro page, PHP generator and `global.css`). A recipe without a video shows the plain photo.

## P1 — Performance

- [x] Replace initial YouTube iframe with recipe image and play button
- [x] Automatically compress uploaded images to WebP
- [x] Optimise existing large PNG images
- [x] Generate responsive images using srcset and sizes
- [x] Lazy-load below-the-fold images
- [x] Optimise above-the-fold image loading
- [x] Investigate slow initial rendering and render-blocking resources
- [x] Investigate unused JavaScript and CSS

### What was done

- **YouTube iframe**: the video now starts as the recipe photo with a play button and a "Watch video" label. The YouTube player is only loaded when it is clicked (Astro page and PHP generator).
- **Uploads to WebP**: `ImageService.php` stores uploaded photos as WebP (largest side 1200 px) plus `-480`, `-800` and `-1200` copies. If the server cannot write WebP, the original format is kept as before.
- **Existing large PNGs**: `npm run optimise:images` (`bin/optimise-images.mjs`) makes the same WebP copies for the photos in `public/images` (for example Masala Dosa: 2.7 MB PNG, 37 KB at 480 px). The original PNG stays as the fallback and the social-sharing image.
- **srcset and sizes**: recipe cards, the recipe page, sidebar lists, step photos, home and about pages use `<picture>` with a WebP `srcset` and a `sizes` that matches the layout. A photo with no WebP copies falls back to a plain `<img>`. Pages already published only list copies that exist on disk.
- **Lazy-load / above the fold**: below-the-fold photos are `loading="lazy"`. The recipe photo, the about photo and the first 3 cards on listing pages load straight away with `fetchpriority="high"`, and the recipe photo is also preloaded.
- **Render-blocking**: the Google Fonts `@import` inside `global.css` made the page wait for the CSS and then for the font stylesheet. It is now a `<link>` that loads without blocking, with `preconnect` hints.
- **Unused JS/CSS**: public pages load no external JavaScript (the 39 KB script is only for `/admin/`). `global.css` is one 31 KB file; about 27 of its 150 classes are admin-only and 5 are unused anywhere (`serif`, `section-heading-centered`, `link-right`, `section-title-flourish`, `flourish-icon`). Possible later step: move the admin rules into their own file.
- **Existing photos on the live site**: the WebP copies reach production in the next full package. Until then the pages show the original photos, because they only list copies that exist.

## P3 — Quality

- [x] Fix link colour and contrast accessibility issues
- [x] Investigate Chrome DevTools warnings
- [x] Correct recipe spelling and cooking time inconsistencies
- [x] Retest mobile and desktop PageSpeed scores

### What was done

- **Link colour and contrast**: every text and background pair in the palette was measured. Body text, muted text, the primary red and the error/success colours all reach at least 4.5:1 on the cream, sand and card backgrounds. Two real problems were fixed: the breadcrumb links and the footer links were shown only in a different colour (no underline), which fails WCAG 1.4.1. They are now underlined. The keyboard focus ring on the "Watch how it's made" row was gold (2.8:1 on cream, below the 3:1 needed); it now uses the default dark red ring. The gold ring stays on the video pop-up close button, which sits on a dark background.
- **Chrome DevTools warnings**: Lighthouse (Chrome) found no console errors, no Issues-panel entries and no deprecated APIs on the home and recipe pages. The one finding was a name mismatch on the header logo link (`aria-label` was "JyoCanCook - Home" but the visible text is "JyoCanCook Homemade Recipes"). The label now starts with the visible text in the Astro layout and the PHP generator. While building, `src/pages/recipes/[slug].astro` was missing its `seo` import (`recipeJsonLd`, `breadcrumbJsonLd`, `jsonLdString`, `recipeDescription`), which stopped the build; the import was added.
- **Recipe spelling and times**: "Reicipe" → "Recipe" and "fr 40 mins" → "for 40 mins" (Chicken Kurma, whose 40 minute cook time already matched); "chacolate chip cookie" → "Chocolate chip cookie" (title only, the link `/recipes/chacolate-chip-cookie/` is unchanged); broken accents "SautÃ©" → "Sauté" (Andhra Chicken Curry, Vegetable Pulao) and "Itâ€™s" → "It’s" (Chicken Kurma story). All other recipes' prep, cook and step times agree with each other. Still to tidy by hand in Admin: the placeholder recipes (Chocolate chip cookie, Chicken Biryani, Tea cake, Sweet Pongal) hold test text such as "asas" and "qqq", and Andhra Chicken Curry has test text in its description and story.
- **PageSpeed retest** (Lighthouse on a local production build, not the live site; run again on the live URL after publishing):

  | Page | Device | Performance | Accessibility | Best practices | SEO | LCP |
  | --- | --- | --- | --- | --- | --- | --- |
  | Home | Mobile | 97 | 100 | 100 | 100 | 2.6 s |
  | Home | Desktop | 100 | 100 | 100 | 100 | 0.4 s |
  | Masala Dosa | Mobile | 98 | 100 | 100 | 100 | 2.3 s |
  | Masala Dosa | Desktop | 100 | 100 | 100 | 100 | 0.6 s |

  Layout shift is 0.03 or lower on all four runs and blocking time is 0 ms.
- **Tests**: `npm test` runs 239 tests; 237 pass. The 2 failures are in `tests/php-staging-publish.test.ts` (uploaded photo variants left next to shipped assets) and `tests/production-package.test.ts` (an extra `backend` folder in the package output). Neither touches the files changed here.
