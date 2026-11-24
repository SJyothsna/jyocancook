<?php
declare(strict_types=1);

/**
 * JyoCanCook Static Template Renderer
 * Recreates the JyoCanCook warm burgundy-and-cream design system,
 * responsive layouts, SVG icons, Schema.org JSON-LD, and meta tags.
 */

require_once dirname(__DIR__) . '/services/RecipeService.php';

class TemplateRenderer {
    private string $siteUrl;
    private string $siteName;
    private string $tagline;
    private array $navLinks = [];

    public function __construct(?array $config = null) {
        if ($config === null) {
            $appConfig = require dirname(__DIR__) . '/config/config.php';
            $config = $appConfig['site'];
        }
        $this->siteUrl = rtrim($config['url'], '/');
        $this->siteName = $config['name'] ?? 'JyoCanCook';
        $this->tagline = $config['tagline'] ?? 'Homemade Recipes';
    }

    /** 0.5 -> "1/2", 1.5 -> "1 1/2", 2 -> "2". Same rules as src/lib/fractions.ts. */
    public static function formatQty(?float $n): string {
        if ($n === null) return '';
        $whole = (int)floor($n);
        $frac = $n - $whole;
        if ($frac < 0.02) return (string)$whole;
        if ($frac > 0.98) return (string)($whole + 1);
        $fractions = [[1 / 8, "\u{215B}"], [1 / 4, "\u{00BC}"], [1 / 3, "\u{2153}"], [3 / 8, "\u{215C}"], [1 / 2, "\u{00BD}"], [5 / 8, "\u{215D}"], [2 / 3, "\u{2154}"], [3 / 4, "\u{00BE}"], [7 / 8, "\u{215E}"]];
        foreach ($fractions as [$v, $label]) {
            if (abs($frac - $v) < 0.02) return ($whole ? $whole . ' ' : '') . $label;
        }
        return rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
    }

    /** "tbsp" -> "Tbsp", "tsp" -> "Tsp"; other units are shown as typed. Same rules as src/lib/recipe-text.ts. */
    public static function unitLabel(string $unit): string {
        $labels = ['tsp' => 'Tsp', 'tbsp' => 'Tbsp'];
        return $labels[strtolower(trim($unit))] ?? $unit;
    }

    /**
     * Instruction text is plain lines: "- " / "• " lines become a bullet list, "1. " lines a numbered
     * list, anything else normal text (line breaks kept). Same rules as src/lib/recipe-text.ts.
     */
    public function renderStepText(string $text): string {
        $blocks = [];
        foreach (preg_split('/\R/u', $text) ?: [] as $raw) {
            if (trim($raw) === '') continue;
            if (preg_match('/^\s*[-*\x{2022}]\s+(.*)$/u', $raw, $m)) {
                $type = 'ul';
                $line = trim($m[1]);
            } elseif (preg_match('/^\s*\d+[.)]\s+(.*)$/u', $raw, $m)) {
                $type = 'ol';
                $line = trim($m[1]);
            } else {
                $type = 'p';
                $line = trim($raw);
            }
            $last = count($blocks) - 1;
            if ($last >= 0 && $blocks[$last]['type'] === $type) {
                $blocks[$last]['lines'][] = $line;
            } else {
                $blocks[] = ['type' => $type, 'lines' => [$line]];
            }
        }
        $html = '';
        foreach ($blocks as $b) {
            if ($b['type'] === 'p') {
                $html .= '<p>' . $this->esc(implode("\n", $b['lines'])) . '</p>';
            } else {
                $items = implode('', array_map(fn($l) => '<li>' . $this->esc($l) . '</li>', $b['lines']));
                $html .= "<{$b['type']}>{$items}</{$b['type']}>";
            }
        }
        return $html;
    }

    public static function esc(?string $v): string {
        return htmlspecialchars((string)($v ?? ''), ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }

    public function renderLayout(string $title, string $description, string $canonicalPath, string $content, array $options = []): string {
        $canonical = $this->siteUrl . $canonicalPath;
        $ogImage = !empty($options['image'])
            ? (str_starts_with($options['image'], 'http') ? $options['image'] : $this->siteUrl . $options['image'])
            : $this->siteUrl . '/images/recipes/andhra-chicken-curry.png';
        $noindex = !empty($options['noindex']);
        $headExtra = $options['head'] ?? '';
        $activeNav = $options['active_nav'] ?? $canonicalPath;

        $pageTitle = $title . ' | ' . $this->siteName;

        return <<<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="{$this->esc($description)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="canonical" href="{$this->esc($canonical)}" />
    <link rel="stylesheet" href="/styles/global.css" />
    {$this->renderRobots($noindex)}
    <meta property="og:title" content="{$this->esc($pageTitle)}" />
    <meta property="og:description" content="{$this->esc($description)}" />
    <meta property="og:image" content="{$this->esc($ogImage)}" />
    <meta property="og:url" content="{$this->esc($canonical)}" />
    <meta property="og:type" content="website" />
    <title>{$this->esc($pageTitle)}</title>
    {$headExtra}
  </head>
  <body>
    <header>
      <div class="topbar">
        <div class="container topline">
          <a class="logo" href="/" aria-label="JyoCanCook - Home">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFF8F1"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M7 3c0 1.5 1.5 1.5 1.5 3" />
              <path d="M12 3c0 1.5 1.5 1.5 1.5 3" />
              <path d="M17 3c0 1.5 1.5 1.5 1.5 3" />
              <path d="M3 10h18" />
              <path d="M4 10c0 5 3.6 9 8 9s8-4 8-9" />
              <path d="M8 19h8" />
            </svg>
            <div class="logo-text">
              <span>{$this->esc($this->siteName)}</span>
              <small>{$this->esc($this->tagline)}</small>
            </div>
          </a>

          <form class="top-search" action="/search/" method="get" role="search">
            <input
              aria-label="Search recipes, ingredients, or tags"
              name="q"
              placeholder="Search recipes, ingredients, or tags..."
              required
            />
            <button type="submit" aria-label="Search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
          </form>

        </div>
      </div>

      <div class="nav-shell">
        <div class="container">
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
            <span>Browse categories</span>
            {$this->icon('menu')}
          </button>
          <nav class="nav" id="site-nav" aria-label="Main navigation">
            {$this->renderNavLinks($activeNav)}
          </nav>
        </div>
      </div>
    </header>

    <main>
      {$content}
    </main>

    <footer class="footer">
      <div class="container footer-inner">
        <div>
          <span class="logo">{$this->esc($this->siteName)}</span>
          <p class="muted">Made with love, shared with joy. Discover authentic Indian dishes.</p>
        </div>
        <div>
          <a href="/recipes/">All Recipes</a> · <a href="/about/">About</a> · <a href="/search/">Search</a>
        </div>
        <small class="muted">© {$this->esc((string)date('Y'))} {$this->esc($this->siteName)}. All rights reserved.</small>
      </div>
    </footer>
    <script>
      (function () {
        var t = document.querySelector('.nav-toggle'), n = document.getElementById('site-nav');
        if (!t || !n) return;
        t.addEventListener('click', function () {
          var open = n.classList.toggle('open');
          t.setAttribute('aria-expanded', String(open));
        });
      })();
    </script>
  </body>
</html>
HTML;
    }

    /** Inline Lucide-style SVG icons, matching the @lucide/astro icons used by the Astro pages. */
    private function icon(string $name, string $class = ''): string {
        static $paths = [
            'menu' => '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
            'clock' => '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
            'flame' => '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
            'users' => '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
            'star' => '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
            'zap' => '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
            'heart' => '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
            'arrow-up-right' => '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
            'printer' => '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
            'utensils' => '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
            'lightbulb' => '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
        ];
        $cls = $class !== '' ? ' class="' . $class . '"' : '';
        return '<svg' . $cls . ' width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . ($paths[$name] ?? '') . '</svg>';
    }

    /** "Homemade Sambar Recipe with Toor Dal and Vegetables" -> "Homemade Sambar". Same rules as the Astro page. */
    private function shortTitle(string $title): string {
        $t = preg_replace('/\s*\([^)]*\)/u', '', $title) ?? $title;
        $t = preg_split('/\s+recipe\b/iu', $t)[0] ?? $t;
        $t = preg_split('/\s+with\s+/iu', $t)[0] ?? $t;
        $t = trim($t);
        return $t !== '' ? $t : $title;
    }

    private function renderRobots(bool $noindex): string {
        return $noindex ? '<meta name="robots" content="noindex,nofollow" />' : '';
    }

    /**
     * Sets the header navigation from the admin "Navigation Menu" (rows of label/href/order/visible).
     * Hidden rows are dropped and the rest are ordered. If nothing is left, the built-in links are used.
     */
    public function setNavMenu(array $menu): void {
        $visible = array_values(array_filter($menu, static fn($i) => !empty($i['visible'])));
        usort($visible, static fn($a, $b) => (int)($a['order'] ?? 0) <=> (int)($b['order'] ?? 0));
        $this->navLinks = array_map(
            static fn($i) => ['href' => (string)$i['href'], 'label' => (string)$i['label']],
            $visible
        );
    }

    /** Subcategory slug => display name, in the configured order. Rows come from ConfigService::getSubcategories(). */
    private function subcategoryNames(array $subcategories): array {
        $names = [];
        foreach ($subcategories as $s) {
            $names[(string)$s['slug']] = (string)$s['name'];
        }
        return $names;
    }

    /** Category slug => the subcategory slugs that category offers (the `subcategories` list of each category). */
    private function categorySubMap(array $categories): array {
        $map = [];
        foreach ($categories as $c) {
            $map[(string)($c['slug'] ?? '')] = array_map('strval', (array)($c['subcategories'] ?? []));
        }
        return $map;
    }

    /** A recipe's subcategories that are defined and offered by its own category (stale or legacy values are ignored). */
    private function recipeSubSlugs(array $recipe, array $subNames, array $catMap): array {
        $offered = $catMap[(string)($recipe['category'] ?? '')] ?? [];
        return array_values(array_filter(
            array_map('strval', $recipe['subcategories'] ?? []),
            static fn($s) => isset($subNames[$s]) && in_array($s, $offered, true)
        ));
    }

    private function renderNavLinks(string $activeNav): string {
        $links = $this->navLinks ?: [
            ['href' => '/', 'label' => 'Home'],
            ['href' => '/recipes/', 'label' => 'Recipes'],
            ['href' => '/category/breakfast/', 'label' => 'Breakfast'],
            ['href' => '/category/rice-biryani/', 'label' => 'Rice & Biryani'],
            ['href' => '/category/curries/', 'label' => 'Curries'],
            ['href' => '/category/chutneys/', 'label' => 'Chutneys'],
            ['href' => '/category/snacks/', 'label' => 'Snacks'],
            ['href' => '/category/sweets/', 'label' => 'Sweets'],
            ['href' => '/category/vegetarian/', 'label' => 'Vegetarian'],
            ['href' => '/category/non-vegetarian/', 'label' => 'Non-Vegetarian'],
        ];

        $matches = static fn(string $href): bool => ($href === '/' && $activeNav === '/') || ($href !== '/' && str_starts_with($activeNav, $href));
        $hasMatch = false;
        foreach ($links as $link) {
            if ($matches($link['href'])) { $hasMatch = true; break; }
        }
        // Category and tag pages without a nav link of their own highlight "Recipes".
        $fallbackRecipes = !$hasMatch && (str_starts_with($activeNav, '/category/') || str_starts_with($activeNav, '/tag/'));

        $html = '';
        foreach ($links as $link) {
            $href = $link['href'];
            $label = $link['label'];
            $isActive = $hasMatch ? $matches($href) : ($fallbackRecipes && $href === '/recipes/');
            $activeClass = $isActive ? ' class="active" aria-current="page"' : '';

            $html .= "<a href=\"{$this->esc($href)}\"{$activeClass}><span>{$this->esc($label)}</span></a>\n";
        }

        return $html;
    }

    /** The diet slugs of a recipe, comma-separated for a data-diet attribute. */
    private function dietSlugList(array $recipe): string {
        return implode(',', array_map(static fn($d) => RecipeService::slugify((string)$d), $recipe['diets'] ?? []));
    }

    public function renderRecipeCard(array $recipe): string {
        $url = '/recipes/' . $recipe['slug'] . '/';
        $totalTime = ($recipe['prepTime'] ?? 0) + ($recipe['cookTime'] ?? 0);
        $dietHtml = !empty($recipe['diets']) ? ' · ' . $this->esc(implode(', ', $recipe['diets'])) : '';
        $categoryName = $recipe['category_name'] ?? ucfirst($recipe['category'] ?? '');

        return <<<HTML
<article class="recipe-card">
  <div class="recipe-card-media">
    <img src="{$this->esc($recipe['image'])}" alt="{$this->esc($recipe['title'])}" width="600" height="400" loading="lazy" decoding="async" />
    <div class="recipe-time-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>{$totalTime} min</span>
    </div>
  </div>
  <div class="recipe-card-content">
    <div class="recipe-card-header">
      <h3><a class="recipe-card-link" href="{$this->esc($url)}" title="{$this->esc($recipe['title'])}">{$this->esc($recipe['title'])}</a></h3>
    </div>
    <div class="recipe-card-meta">
      <span>{$this->esc($categoryName)}</span>
      <span>{$dietHtml}</span>
    </div>
  </div>
</article>
HTML;
    }

    public function renderRecipePage(array $recipe, array $allRecipes, array $categories, bool $preview = false): string {
        $canonicalPath = '/recipes/' . $recipe['slug'] . '/';
        $categorySlug = $recipe['category'] ?? 'curries';
        $categoryName = $recipe['category_name'] ?? ucfirst($categorySlug);

        // YouTube Embed helper
        $youtubeEmbedUrl = $this->getYouTubeEmbedUrl($recipe['youtubeUrl'] ?? null);

        // Calculate Similar Recipes
        $recipeTagSet = array_map('strtolower', $recipe['tags'] ?? []);
        $scored = [];
        foreach ($allRecipes as $r) {
            if ($r['slug'] === $recipe['slug']) continue;
            $score = 0;
            if (($r['category'] ?? '') === $categorySlug) $score += 3;
            if (array_intersect($r['diets'] ?? [], $recipe['diets'] ?? [])) $score += 1;
            $rTags = array_map('strtolower', $r['tags'] ?? []);
            foreach ($rTags as $t) {
                if (in_array($t, $recipeTagSet, true)) $score += 2;
            }
            $scored[] = ['recipe' => $r, 'score' => $score];
        }
        usort($scored, fn($a, $b) => $b['score'] <=> $a['score']);

        $similarRecipes = array_map(fn($item) => $item['recipe'], array_slice(array_filter($scored, fn($item) => $item['score'] > 0), 0, 3));
        $similarSlugs = array_map(fn($r) => $r['slug'], $similarRecipes);

        $latestRecipes = array_values(array_filter($allRecipes, function ($r) use ($recipe, $similarSlugs) {
            return $r['slug'] !== $recipe['slug'] && !in_array($r['slug'], $similarSlugs, true);
        }));
        $latestRecipes = array_slice($latestRecipes, 0, 3);

        // Group Ingredients by Section
        $ingredientSections = [];
        foreach ($recipe['ingredients'] as $ing) {
            $secTitle = trim((string)($ing['section'] ?? ''));
            $lastIdx = count($ingredientSections) - 1;
            if ($lastIdx >= 0 && ($ingredientSections[$lastIdx]['title'] ?? '') === $secTitle) {
                $ingredientSections[$lastIdx]['items'][] = $ing;
            } else {
                $ingredientSections[] = [
                    'title' => $secTitle !== '' ? $secTitle : null,
                    'items' => [$ing],
                ];
            }
        }

        // Schema.org JSON-LD structured data
        $schemaIngredients = [];
        foreach ($recipe['ingredients'] as $i) {
            $schemaIngredients[] = trim(sprintf('%s %s %s', $i['amount'] ?? '', $i['unit'] ?? '', $i['name'] ?? ''));
        }

        $schemaSteps = [];
        foreach ($recipe['steps'] as $s) {
            $stepObj = [
                '@type' => 'HowToStep',
                'name' => $s['title'],
                'text' => $s['text'],
            ];
            if (!empty($s['image'])) {
                $stepObj['image'] = str_starts_with($s['image'], 'http') ? $s['image'] : $this->siteUrl . $s['image'];
            }
            $schemaSteps[] = $stepObj;
        }

        $schema = [
            '@context' => 'https://schema.org',
            '@type' => 'Recipe',
            'name' => $recipe['title'],
            'description' => $recipe['description'],
            'image' => [str_starts_with($recipe['image'], 'http') ? $recipe['image'] : $this->siteUrl . $recipe['image']],
            'recipeYield' => (string)($recipe['servings'] ?? 4),
            'prepTime' => 'PT' . ($recipe['prepTime'] ?? 15) . 'M',
            'cookTime' => 'PT' . ($recipe['cookTime'] ?? 30) . 'M',
            'recipeCategory' => $categoryName,
            'keywords' => implode(', ', $recipe['tags'] ?? []),
            'recipeIngredient' => $schemaIngredients,
            'recipeInstructions' => $schemaSteps,
        ];

        if (!empty($recipe['nutrition'])) {
            $n = $recipe['nutrition'];
            $schema['nutrition'] = [
                '@type' => 'NutritionInformation',
            ];
            if (isset($n['calories'])) $schema['nutrition']['calories'] = $n['calories'] . ' calories';
            if (isset($n['carbs'])) $schema['nutrition']['carbohydrateContent'] = $n['carbs'] . ' g';
            if (isset($n['protein'])) $schema['nutrition']['proteinContent'] = $n['protein'] . ' g';
            if (isset($n['fat'])) $schema['nutrition']['fatContent'] = $n['fat'] . ' g';
            if (isset($n['fiber'])) $schema['nutrition']['fiberContent'] = $n['fiber'] . ' g';
        }

        $jsonLd = '<script type="application/ld+json">' . json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>';

        // Tags HTML
        $tagsHtml = "<a class=\"pill\" href=\"/category/{$this->esc($categorySlug)}/\">{$this->esc($categoryName)}</a>\n";
        foreach ($recipe['tags'] as $tag) {
            // The category chip is always shown, so a tag that repeats the category is left out.
            $tagKey = mb_strtolower(trim((string)$tag));
            if ($tagKey === mb_strtolower(trim((string)$categoryName)) || $tagKey === mb_strtolower((string)$categorySlug)) {
                continue;
            }
            $tagSlug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $tag));
            $tagsHtml .= "<a class=\"pill\" href=\"/tag/{$this->esc($tagSlug)}/\">{$this->esc($tag)}</a>\n";
        }

        // Media HTML (YouTube or Image)
        if ($youtubeEmbedUrl) {
            $mediaHtml = <<<HTML
<div class="recipe-main-media video-container">
  <iframe
    src="{$this->esc($youtubeEmbedUrl)}"
    title="How to make {$this->esc($recipe['title'])}"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    loading="lazy"
  ></iframe>
</div>
HTML;
        } else {
            $mediaHtml = "<img class=\"recipe-main-image\" src=\"{$this->esc($recipe['image'])}\" alt=\"{$this->esc($recipe['title'])}\" width=\"800\" height=\"600\" />";
        }

        // Calories pill inside meta strip
        $caloriesPill = '';
        if (isset($recipe['nutrition']['calories'])) {
            $caloriesPill = <<<HTML
<div class="meta-item">
  {$this->icon('zap', 'meta-icon')}
  <div class="meta-content">
    <span class="meta-label">Calories</span>
    <strong class="meta-value">{$this->esc((string)$recipe['nutrition']['calories'])} kcal</strong>
  </div>
</div>
HTML;
        }

        // Nutrition Strip HTML (Order: Carbs, Protein, Fiber, Fat)
        $nutritionHtml = '';
        if (!empty($recipe['nutrition'])) {
            $n = $recipe['nutrition'];
            $pills = '';
            if (isset($n['carbs'])) {
                $pills .= "<div class=\"nutrition-pill\"><span class=\"nut-name\">Carbs</span><strong class=\"nut-val\">{$this->esc((string)$n['carbs'])}g</strong></div>\n";
            }
            if (isset($n['protein'])) {
                $pills .= "<div class=\"nutrition-pill\"><span class=\"nut-name\">Protein</span><strong class=\"nut-val\">{$this->esc((string)$n['protein'])}g</strong></div>\n";
            }
            if (isset($n['fiber'])) {
                $pills .= "<div class=\"nutrition-pill\"><span class=\"nut-name\">Fiber</span><strong class=\"nut-val\">{$this->esc((string)$n['fiber'])}g</strong></div>\n";
            }
            if (isset($n['fat'])) {
                $pills .= "<div class=\"nutrition-pill\"><span class=\"nut-name\">Fat</span><strong class=\"nut-val\">{$this->esc((string)$n['fat'])}g</strong></div>\n";
            }

            if ($pills !== '') {
                $nutritionHtml = <<<HTML
<div class="nutrition-strip">
  <span class="nutrition-label">Nutrition</span>
  <div class="nutrition-items">
    {$pills}
  </div>
</div>
HTML;
            }
        }

        // Story Panel HTML
        $storyHtml = '';
        if (!empty($recipe['story'])) {
            $storyHtml = <<<HTML
<div class="recipe-story-panel">
  <div class="recipe-story-badge">Story &amp; Background</div>
  <p class="recipe-story-text">{$this->esc($recipe['story'])}</p>
</div>
HTML;
        }

        // Ingredients HTML
        $ingredientsHtml = '';
        foreach ($ingredientSections as $sec) {
            $secTitleHtml = !empty($sec['title']) ? "<h3 class=\"ingredient-section-title\">{$this->esc($sec['title'])}</h3>\n" : '';
            $itemsHtml = '';
            foreach ($sec['items'] as $i) {
                $unitPart = !empty($i['unit']) ? ' ' . $this->esc(self::unitLabel((string)$i['unit'])) : '';
                $qtyText = self::formatQty(isset($i['amount']) && $i['amount'] !== '' ? (float)$i['amount'] : null);
                $itemsHtml .= <<<HTML
<label class="ingredient">
  <input type="checkbox" />
  <span>
    <span class="qty" data-amount="{$this->esc((string)($i['amount'] ?? ''))}">{$qtyText}</span>{$unitPart} {$this->esc($i['name'])}
  </span>
</label>
HTML;
            }
            $ingredientsHtml .= <<<HTML
<div class="ingredient-section-group">
  {$secTitleHtml}
  <div class="ingredient-grid">
    {$itemsHtml}
  </div>
</div>
HTML;
        }

        // Steps HTML with side-by-side images
        $stepsHtml = '';
        foreach ($recipe['steps'] as $idx => $s) {
            $num = $idx + 1;
            $imgHtml = !empty($s['image'])
                ? "<div class=\"step-image-wrap\"><img class=\"step-image\" src=\"{$this->esc($s['image'])}\" alt=\"{$this->esc($s['title'])}\" loading=\"lazy\" /></div>"
                : '';

            // A step titled "Optional: ..." keeps its wording and gets an "Optional" label.
            $stepTitle = (string)$s['title'];
            $optionalHtml = '';
            if (preg_match('/^\s*optional\s*[:\-\x{2013}\x{2014}]\s*(.+)$/iu', $stepTitle, $om)) {
                $stepTitle = trim($om[1]);
                $optionalHtml = '<span class="step-optional">Optional</span>';
            }

            $stepsHtml .= <<<HTML
<div class="step">
  <div class="step-num">{$num}</div>
  <div class="step-body">
    <div class="step-content">
      <h3>{$this->esc($stepTitle)}{$optionalHtml}</h3>
      {$this->renderStepText((string)$s['text'])}
    </div>
    {$imgHtml}
  </div>
</div>
HTML;
        }

        // Pro Tips & Serve With
        $postStepsHtml = '';
        $tips = $recipe['tips'] ?? [];
        $serveWith = $recipe['serveWith'] ?? [];
        if (!empty($tips) || !empty($serveWith)) {
            $tipsBlock = '';
            if (!empty($tips)) {
                $tipsLi = implode('', array_map(fn($t) => "<li>{$this->esc($t)}</li>", $tips));
                $tipsBlock = <<<HTML
<div class="panel panel-warm">
  <h2>{$this->icon('lightbulb')}Pro Tips</h2>
  <ul>{$tipsLi}</ul>
</div>
HTML;
            }

            $serveBlock = '';
            if (!empty($serveWith)) {
                $serveStr = implode(' · ', array_map([$this, 'esc'], $serveWith));
                $serveBlock = <<<HTML
<div class="panel">
  <h2>{$this->icon('utensils')}Serve with</h2>
  <p>{$serveStr}</p>
</div>
HTML;
            }

            $postStepsHtml = <<<HTML
<div class="post-steps-grid">
  {$tipsBlock}
  {$serveBlock}
</div>
HTML;
        }

        // Sidebar HTML: "You Might Also Like" followed by "Latest Recipes"
        $sidebarSimilarHtml = '';
        if (!empty($similarRecipes)) {
            $items = '';
            foreach ($similarRecipes as $sr) {
                $tt = ($sr['prepTime'] ?? 0) + ($sr['cookTime'] ?? 0);
                $cName = $sr['category_name'] ?? ucfirst($sr['category'] ?? '');
                $items .= <<<HTML
<a class="sidebar-recipe-item" href="/recipes/{$this->esc($sr['slug'])}/">
  <img class="sidebar-recipe-thumb" src="{$this->esc($sr['image'])}" alt="{$this->esc($sr['title'])}" loading="lazy" />
  <div class="sidebar-recipe-info">
    <h3>{$this->esc($sr['title'])}</h3>
    <div class="sidebar-recipe-meta">
      <span>{$this->esc($cName)}</span>
      <span>•</span>
      <span>{$tt} min</span>
    </div>
  </div>
</a>
HTML;
            }
            $sidebarSimilarHtml = <<<HTML
<div class="panel">
  <h2>You Might Also Like</h2>
  <div class="sidebar-recipe-list">
    {$items}
  </div>
</div>
HTML;
        }

        $sidebarLatestHtml = '';
        if (!empty($latestRecipes)) {
            $items = '';
            foreach ($latestRecipes as $lr) {
                $tt = ($lr['prepTime'] ?? 0) + ($lr['cookTime'] ?? 0);
                $cName = $lr['category_name'] ?? ucfirst($lr['category'] ?? '');
                $items .= <<<HTML
<a class="sidebar-recipe-item" href="/recipes/{$this->esc($lr['slug'])}/">
  <img class="sidebar-recipe-thumb" src="{$this->esc($lr['image'])}" alt="{$this->esc($lr['title'])}" loading="lazy" />
  <div class="sidebar-recipe-info">
    <h3>{$this->esc($lr['title'])}</h3>
    <div class="sidebar-recipe-meta">
      <span>{$this->esc($cName)}</span>
      <span>•</span>
      <span>{$tt} min</span>
    </div>
  </div>
</a>
HTML;
            }
            $sidebarLatestHtml = <<<HTML
<div class="panel">
  <h2>Latest Recipes</h2>
  <div class="sidebar-recipe-list">
    {$items}
  </div>
</div>
HTML;
        }

        $bodyContent = <<<HTML
<div class="container recipe-page">
  <div class="breadcrumb">
    <a href="/">Home</a> › <a href="/category/{$this->esc($categorySlug)}/">{$this->esc($categoryName)}</a> › {$this->esc($recipe['title'])}
  </div>
  <div class="recipe-title">
    <h1>{$this->esc($recipe['title'])}</h1>
    <p class="recipe-by">Recipe by <strong>JyoCanCook</strong></p>

    <p class="intro">{$this->esc($recipe['description'])}</p>
    <div class="tags">
      {$tagsHtml}
    </div>
    <div class="recipe-actions">
      <button id="save" class="btn btn-outline" type="button" aria-pressed="false">{$this->icon('heart')}<span id="save-label">Save</span></button>
      <button id="share" class="btn btn-outline" type="button">{$this->icon('arrow-up-right')}Share</button>
      <button class="btn btn-outline" type="button" onclick="window.print()">{$this->icon('printer')}Print</button>
    </div>
  </div>

  <div class="recipe-layout">
    <div>
      {$mediaHtml}

      <div class="meta-strip">
        <div class="meta-item">
          {$this->icon('clock', 'meta-icon')}
          <div class="meta-content">
            <span class="meta-label">Prep Time</span>
            <strong class="meta-value">{$this->esc((string)($recipe['prepTime'] ?? 15))} min</strong>
          </div>
        </div>
        <div class="meta-item">
          {$this->icon('flame', 'meta-icon')}
          <div class="meta-content">
            <span class="meta-label">Cook Time</span>
            <strong class="meta-value">{$this->esc((string)($recipe['cookTime'] ?? 30))} min</strong>
          </div>
        </div>
        <div class="meta-item">
          {$this->icon('users', 'meta-icon')}
          <div class="meta-content">
            <span class="meta-label">Servings</span>
            <strong class="meta-value">{$this->esc((string)($recipe['servings'] ?? 4))}</strong>
          </div>
        </div>
        <div class="meta-item">
          {$this->icon('star', 'meta-icon')}
          <div class="meta-content">
            <span class="meta-label">Difficulty</span>
            <strong class="meta-value">{$this->esc($recipe['difficulty'] ?? 'Easy')}</strong>
          </div>
        </div>
        {$caloriesPill}
      </div>

      {$nutritionHtml}

      {$storyHtml}

      <div class="panel">
        <div class="ingredients-head">
          <h2>Ingredients</h2>
          <div class="serving-controls">
            Servings: <strong id="servings">{$this->esc((string)($recipe['servings'] ?? 4))}</strong>
            <div class="scale-group" role="group" aria-label="Scale recipe">
              <button type="button" class="scale-btn" data-scale="0.5" aria-pressed="false">0.5x</button>
              <button type="button" class="scale-btn active" data-scale="1" aria-pressed="true">1x</button>
              <button type="button" class="scale-btn" data-scale="2" aria-pressed="false">2x</button>
            </div>
          </div>
        </div>
        <div id="ingredients">
          {$ingredientsHtml}
        </div>
      </div>

      <section class="steps">
        <h2>How to Make {$this->esc($this->shortTitle((string)$recipe['title']))}</h2>
        {$stepsHtml}
      </section>

      {$postStepsHtml}
    </div>

    <aside>
      {$sidebarSimilarHtml}
      {$sidebarLatestHtml}
    </aside>
  </div>
</div>

<script>
  (function() {
    var base = {$recipe['servings']};
    var slug = '{$this->esc($recipe['slug'])}';
    var output = document.querySelector('#servings');
    // Servings are shown as decimals (2.5), unlike ingredient quantities which use fractions.
    function formatServings(n) { return String(Number(n.toFixed(2))); }
    function formatQty(n) {
      var whole = Math.floor(n), frac = n - whole;
      if (frac < 0.02) return String(whole);
      if (frac > 0.98) return String(whole + 1);
      var f = [[1/8, '\u215B'], [1/4, '\u00BC'], [1/3, '\u2153'], [3/8, '\u215C'], [1/2, '\u00BD'], [5/8, '\u215D'], [2/3, '\u2154'], [3/4, '\u00BE'], [7/8, '\u215E']];
      for (var k = 0; k < f.length; k++) {
        if (Math.abs(frac - f[k][0]) < 0.02) return (whole ? whole + ' ' : '') + f[k][1];
      }
      return String(Number(n.toFixed(2)));
    }
    function setScale(scale) {
      if (output) output.textContent = formatServings(base * scale);
      document.querySelectorAll('.qty').forEach(function(el) {
        var raw = el.getAttribute('data-amount');
        if (!raw || isNaN(Number(raw))) {
          el.textContent = '';
          return;
        }
        el.textContent = formatQty(Number(raw) * scale);
      });
      document.querySelectorAll('.scale-btn').forEach(function(btn) {
        var on = Number(btn.getAttribute('data-scale')) === scale;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    }
    document.querySelectorAll('.scale-btn').forEach(function(btn) {
      btn.onclick = function() { setScale(Number(btn.getAttribute('data-scale'))); };
    });

    var saved = JSON.parse(localStorage.getItem('jyo-saved') || '[]');
    var saveBtn = document.querySelector('#save');
    var saveLabel = document.querySelector('#save-label');
    function showSaved(isSaved) {
      saveBtn.setAttribute('aria-pressed', String(isSaved));
      saveLabel.textContent = isSaved ? 'Saved' : 'Save';
    }
    if (saveBtn && saveLabel) {
      showSaved(saved.indexOf(slug) !== -1);
      saveBtn.onclick = function() {
        var arr = JSON.parse(localStorage.getItem('jyo-saved') || '[]');
        var idx = arr.indexOf(slug);
        if (idx !== -1) {
          arr.splice(idx, 1);
        } else {
          arr.push(slug);
        }
        localStorage.setItem('jyo-saved', JSON.stringify(arr));
        showSaved(arr.indexOf(slug) !== -1);
      };
    }

    var shareBtn = document.querySelector('#share');
    if (shareBtn) {
      shareBtn.onclick = function() {
        if (navigator.share) {
          navigator.share({ title: document.title, url: location.href });
        } else {
          navigator.clipboard.writeText(location.href);
          alert('Recipe link copied to clipboard!');
        }
      };
    }
  })();
</script>
HTML;

        if ($preview) {
            $status = !empty($recipe['published']) ? 'This recipe is already published.' : 'Draft: not visible to the public yet.';
            $bodyContent = '<div style="background:#fff3cd;color:#664d03;border-bottom:1px solid #ffecb5;padding:10px 16px;text-align:center;font-weight:600;">'
                . 'Preview only. ' . $this->esc($status) . ' Close this tab and tick Published in the admin recipe list to make it live.</div>'
                . $bodyContent;
        }

        return $this->renderLayout(
            $recipe['title'],
            $recipe['description'],
            $canonicalPath,
            $bodyContent,
            ['head' => $jsonLd, 'image' => $recipe['image'], 'active_nav' => '/recipes/', 'noindex' => $preview]
        );
    }

    public function renderHomePage(array $recipes, array $categories = [], array $subcategories = []): string {
        // Newest published first; recipes without a date keep their title order after the dated ones.
        usort($recipes, fn($a, $b) => strcmp((string)($b['publishedAt'] ?? ''), (string)($a['publishedAt'] ?? '')));
        $latest = array_slice($recipes, 0, 8);

        $cardsHtml = '';
        foreach ($latest as $r) {
            $cardsHtml .= $this->renderRecipeCard($r) . "\n";
        }

        // One compact box per subcategory in use: the newest recipe's photo and the recipe count.
        $subNames = $this->subcategoryNames($subcategories);
        $catMap = $this->categorySubMap($categories);
        $subcategoryBoxes = '';
        foreach ($subNames as $slug => $name) {
            $items = array_values(array_filter($recipes, fn($r) => in_array((string)$slug, $this->recipeSubSlugs($r, $subNames, $catMap), true)));
            if (!$items) continue;
            $count = count($items);
            $label = $count === 1 ? 'recipe' : 'recipes';
            $subcategoryBoxes .= "<a class=\"subcat-box\" href=\"/recipes/?subcategory={$this->esc((string)$slug)}\">"
                . "<img class=\"subcat-thumb\" src=\"{$this->esc($items[0]['image'] ?? '')}\" alt=\"\" loading=\"lazy\" />"
                . "<span class=\"subcat-text\"><span class=\"subcat-name\">{$this->esc($name)}</span>"
                . "<span class=\"subcat-count\">{$count} {$label}</span></span></a>\n";
        }
        $subcategoriesHtml = $subcategoryBoxes === '' ? '' : <<<HTML
<div class="container">
  <section class="home-section subcat-section" aria-labelledby="subcat-title">
    <div class="section-head">
      <h2 class="section-title" id="subcat-title">Browse by Subcategory</h2>
    </div>
    <nav class="subcat-grid" aria-label="Browse by subcategory">
      {$subcategoryBoxes}
    </nav>
  </section>
</div>

HTML;

        $content = <<<HTML
<div class="container">
  <section class="hero">
    <div class="hero-copy">
      <h1>Homemade Recipes, Made Simple</h1>
      <p>Discover authentic Indian dishes, everyday meals and family favourites.</p>
      <a class="btn" href="/recipes/">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2"/><path d="M14 2v20"/><path d="M4 2v20"/><path d="M4 2v6a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2"/></svg>
        <span>Explore Recipes</span>
      </a>
    </div>
    <aside class="hero-about panel panel-warm" aria-labelledby="about-card-title">
      <div class="hero-about-inner">
        <div class="about-photo-wrap"><img class="about-photo" src="/images/about/about-me.jpg" alt="Portrait of the author of JyoCanCook" width="1446" height="1087" /></div>
        <div class="about-text">
          <h2 id="about-card-title">About Me</h2>
          <p>Cooking is my passion, and I believe great taste doesn't need complicated recipes. Through JyoCanCook, I share simple, authentic recipes inspired by our elders, keeping the flavours of home alive for the younger generation to enjoy and cherish.</p>
          <p class="about-tagline">Simple to cook. Rich in flavour. Rooted in tradition.</p>
          <a class="link" href="/about/">Read more →</a>
        </div>
      </div>
    </aside>
  </section>
</div>

{$subcategoriesHtml}<div class="container">
  <section class="home-section" aria-labelledby="latest-title">
    <div class="section-head">
      <h2 class="section-title" id="latest-title">Latest Recipes</h2>
      <a class="link" href="/recipes/">View All Recipes →</a>
    </div>

    <div class="cards">
      {$cardsHtml}
    </div>
  </section>

  <section class="home-section" aria-labelledby="cta-title">
    <div class="cta-panel">
      <h2 id="cta-title">Cooking brings us together</h2>
      <p>
        Explore favourite recipes, discover traditional flavours and make memories around the family table.
      </p>
      <a class="btn" href="/recipes/">Discover Recipes</a>
    </div>
  </section>
</div>
HTML;

        return $this->renderLayout('Authentic Homemade Indian Recipes', 'Discover authentic Indian dishes, everyday meals and family favourites at JyoCanCook.', '/', $content);
    }

    public function renderRecipesIndexPage(array $recipes, array $categories, array $tags, array $subcategories = [], array $diets = []): string {
        $subNames = $this->subcategoryNames($subcategories);
        $catMap = $this->categorySubMap($categories);

        // Diet chips: the configured diets (in the Diets tab order) that have at least one recipe here.
        $usedDiets = [];
        foreach ($recipes as $r) {
            foreach ($r['diets'] ?? [] as $dietName) {
                $usedDiets[RecipeService::slugify((string)$dietName)] = (string)$dietName;
            }
        }
        $dietChips = '';
        foreach ($diets as $d) {
            if (!isset($usedDiets[$d['slug']])) continue;
            $dietChips .= "<button type=\"button\" class=\"tag-chip\" data-diet=\"{$this->esc((string)$d['slug'])}\" aria-pressed=\"false\">{$this->esc((string)$d['name'])}</button>\n";
        }

        $cardsHtml = '';
        $usedSubcategories = [];
        foreach ($recipes as $r) {
            $tLower = strtolower($r['title']);
            $ingNames = strtolower(implode(' ', array_column($r['ingredients'] ?? [], 'name')));
            $subSlugs = $this->recipeSubSlugs($r, $subNames, $catMap);
            foreach ($subSlugs as $subSlug) {
                $usedSubcategories[$subSlug] = $subNames[$subSlug] ?? $subSlug;
            }
            $subSlug = implode(',', $subSlugs);
            $card = $this->renderRecipeCard($r);

            $dietSlug = $this->dietSlugList($r);
            $cardsHtml .= "<div data-title=\"{$this->esc($tLower)}\" data-ingredients=\"{$this->esc($ingNames)}\" data-subcategory=\"{$this->esc($subSlug)}\" data-diet=\"{$this->esc($dietSlug)}\">{$card}</div>\n";
        }

        $subChips = "<button type=\"button\" class=\"tag-chip tag-chip-selected\" data-subcategory=\"\" aria-pressed=\"true\">All</button>\n";
        foreach ($usedSubcategories as $slug => $name) {
            $subChips .= "<button type=\"button\" class=\"tag-chip\" data-subcategory=\"{$this->esc((string)$slug)}\" aria-pressed=\"false\">{$this->esc($name)}</button>\n";
        }
        $subChips = "<div id=\"subcategory-chips\" style=\"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px\" role=\"group\" aria-label=\"Filter by subcategory\">\n{$subChips}</div>";
        if ($dietChips !== '') {
            // Diet and sub category filters combine: a recipe must match both.
            $dietChips = "<button type=\"button\" class=\"tag-chip tag-chip-selected\" data-diet=\"\" aria-pressed=\"true\">All diets</button>\n" . $dietChips;
            $subChips = "<div id=\"diet-chips\" style=\"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px\" role=\"group\" aria-label=\"Filter by diet\">\n{$dietChips}</div>\n" . $subChips;
        }

        $count = count($recipes);

        $content = <<<HTML
<div class="container section">
  <span class="eyebrow">Recipe collection</span>
  <h1>Find your next favourite</h1>
  <p class="muted">Browse our recipes or filter by diet, subcategory and name.</p>
  <div class="filterbar">
    <input id="filter-text" placeholder="Filter recipes by name or ingredient..." aria-label="Filter recipes" />
  </div>
  {$subChips}
  <div class="cards" id="recipe-list">
    {$cardsHtml}
  </div>
  <p class="empty hidden" id="filter-empty">No recipes match your filters.</p>
  <p class="muted" style="margin-top:20px"><span id="recipe-count">{$count}</span> recipes shown</p>
</div>

<script>
  (function() {
    var text = document.querySelector('#filter-text');
    var chips = Array.prototype.slice.call(document.querySelectorAll('#subcategory-chips .tag-chip'));
    var dietChips = Array.prototype.slice.call(document.querySelectorAll('#diet-chips .tag-chip'));
    var items = Array.prototype.slice.call(document.querySelectorAll('#recipe-list > div'));
    var countEl = document.querySelector('#recipe-count');
    var emptyEl = document.querySelector('#filter-empty');
    var activeSub = '';
    var activeDiet = '';

    function filter() {
      var q = (text ? text.value : '').toLowerCase().trim();
      var n = 0;

      items.forEach(function(el) {
        var t = el.getAttribute('data-title') || '';
        var ing = el.getAttribute('data-ingredients') || '';
        var s = (el.getAttribute('data-subcategory') || '').split(',');

        var ok = (!q || (t + ' ' + ing).indexOf(q) !== -1)
          && (!activeSub || s.indexOf(activeSub) !== -1)
          && (!activeDiet || (el.getAttribute('data-diet') || '').split(',').indexOf(activeDiet) !== -1);

        el.classList.toggle('hidden', !ok);
        if (ok) n++;
      });

      if (countEl) countEl.textContent = String(n);
      if (emptyEl) emptyEl.classList.toggle('hidden', n > 0);
    }

    chips.forEach(function(chip) {
      chip.addEventListener('click', function() {
        var value = chip.getAttribute('data-subcategory') || '';
        activeSub = value !== '' && activeSub === value ? '' : value;
        chips.forEach(function(c) {
          var on = (c.getAttribute('data-subcategory') || '') === activeSub;
          c.classList.toggle('tag-chip-selected', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        filter();
      });
    });

    dietChips.forEach(function(chip) {
      chip.addEventListener('click', function() {
        var value = chip.getAttribute('data-diet') || '';
        activeDiet = value !== '' && activeDiet === value ? '' : value;
        dietChips.forEach(function(c) {
          var on = (c.getAttribute('data-diet') || '') === activeDiet;
          c.classList.toggle('tag-chip-selected', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        filter();
      });
    });

    if (text) text.addEventListener('input', filter);

    var params = new URLSearchParams(window.location.search);
    var initialSub = params.get('subcategory');
    if (initialSub) {
      var match = chips.filter(function(c) { return c.getAttribute('data-subcategory') === initialSub; })[0];
      if (match) match.click();
    }
    var initialDiet = params.get('diet');
    if (initialDiet) {
      var dietMatch = dietChips.filter(function(c) { return c.getAttribute('data-diet') === initialDiet; })[0];
      if (dietMatch) dietMatch.click();
    }
  })();
</script>
HTML;

        return $this->renderLayout('All Recipes', 'Browse all authentic homemade Indian recipes at JyoCanCook.', '/recipes/', $content);
    }

    public function renderCategoryPage(array $category, array $recipes, array $categories = [], array $subcategories = [], array $dietSlugs = ['vegetarian', 'non-vegetarian'], array $diets = []): string {
        $subNames = $this->subcategoryNames($subcategories);
        $catMap = $this->categorySubMap($categories);

        $canonicalPath = '/category/' . $category['slug'] . '/';
        $iconHtml = !empty($category['image'])
            ? "<img src=\"{$this->esc($category['image'])}\" alt=\"\" width=\"16\" height=\"16\" />"
            : '';

        // The diet pages (Vegetarian / Non-Vegetarian) cut across categories, so they filter by
        // category; every other category page filters by its own subcategories.
        $byCategory = in_array((string)($category['slug'] ?? ''), $dietSlugs, true);

        $cardsHtml = '';
        $usedDiets = [];
        foreach ($recipes as $r) {
            $sub = $this->esc($byCategory ? (string)($r['category'] ?? '') : implode(',', $this->recipeSubSlugs($r, $subNames, $catMap)));
            $dietSlug = $this->dietSlugList($r);
            foreach ($r['diets'] ?? [] as $dietName) {
                $usedDiets[RecipeService::slugify((string)$dietName)] = true;
            }
            $cardsHtml .= "<div data-subcategory=\"{$sub}\" data-diet=\"{$this->esc($dietSlug)}\">" . $this->renderRecipeCard($r) . "</div>\n";
        }

        $total = count($recipes);
        $countLabel = $total . ' ' . ($total === 1 ? 'recipe' : 'recipes');
        $gridHtml = !empty($cardsHtml)
            ? "<p class=\"result-count\" id=\"result-count\" aria-live=\"polite\">{$countLabel}</p>\n<div class=\"cards\" id=\"category-list\">{$cardsHtml}</div>"
            : '<div class="empty-state"><h2>No recipes available yet.</h2><p>Explore other categories to find something delicious.</p><a class="btn" href="/recipes/">All Recipes</a></div>';

        // Filter chips: this category's own subcategories used by this page's recipes, or on the
        // diet pages the categories used by this page's recipes.
        $subChips = '';
        if ($byCategory) {
            foreach ($categories as $c) {
                $cSlug = (string)($c['slug'] ?? '');
                if (in_array($cSlug, $dietSlugs, true)) continue;
                if (!array_filter($recipes, fn($r) => ($r['category'] ?? '') === $cSlug)) continue;
                $subChips .= "<button type=\"button\" class=\"tag-chip\" data-subcategory=\"{$this->esc($cSlug)}\" aria-pressed=\"false\">{$this->esc((string)$c['name'])}</button>\n";
            }
        } else {
            foreach ($subNames as $slug => $name) {
                if (!in_array((string)$slug, $catMap[(string)($category['slug'] ?? '')] ?? [], true)) continue;
                $used = array_filter($recipes, fn($r) => in_array((string)$slug, $this->recipeSubSlugs($r, $subNames, $catMap), true));
                if (!$used) continue;
                $subChips .= "<button type=\"button\" class=\"tag-chip\" data-subcategory=\"{$this->esc((string)$slug)}\" aria-pressed=\"false\">{$this->esc($name)}</button>\n";
            }
        }
        // Diet chips (All diets, Vegetarian, Vegan...) on the regular category pages; the diet pages
        // themselves are already one diet.
        $dietChips = '';
        if (!$byCategory) {
            foreach ($diets as $d) {
                if (!isset($usedDiets[$d['slug']])) continue;
                $dietChips .= "<button type=\"button\" class=\"tag-chip\" data-diet=\"{$this->esc((string)$d['slug'])}\" aria-pressed=\"false\">{$this->esc((string)$d['name'])}</button>\n";
            }
        }
        $filterLabel = $byCategory ? 'Filter by category' : 'Filter by subcategory';
        $dietNav = $dietChips === '' ? '' : "<div id=\"diet-chips\" class=\"filter-chips\" role=\"group\" aria-label=\"Filter by diet\">\n"
            . "<button type=\"button\" class=\"tag-chip tag-chip-selected\" data-diet=\"\" aria-pressed=\"true\">All diets</button>\n"
            . $dietChips . "</div>\n";
        $subcategoryNav = $dietNav . ($subChips === '' ? '' : "<div id=\"subcategory-chips\" class=\"filter-chips\" role=\"group\" aria-label=\"{$filterLabel}\">\n"
            . "<button type=\"button\" class=\"tag-chip tag-chip-selected\" data-subcategory=\"\" aria-pressed=\"true\">All</button>\n"
            . $subChips . "</div>\n");
        $filterScript = $subcategoryNav === '' ? '' : <<<HTML
<script>
  (function() {
    var items = Array.prototype.slice.call(document.querySelectorAll('#category-list > div'));
    var countEl = document.getElementById('result-count');
    // Two filter groups (diet, sub category). Several chips of a group can be selected and a recipe
    // matches a group when it has any selected value; it must match every group that has a selection.
    // "All" clears its group.
    var groups = [
      { attr: 'data-diet', chips: Array.prototype.slice.call(document.querySelectorAll('#diet-chips .tag-chip')), active: [] },
      { attr: 'data-subcategory', chips: Array.prototype.slice.call(document.querySelectorAll('#subcategory-chips .tag-chip')), active: [] }
    ];

    function apply() {
      var visible = 0;
      items.forEach(function(el) {
        var hide = groups.some(function(g) {
          if (g.active.length === 0) return false;
          var values = (el.getAttribute(g.attr) || '').split(',');
          return !g.active.some(function(v) { return values.indexOf(v) !== -1; });
        });
        el.classList.toggle('hidden', hide);
        if (!hide) visible += 1;
      });
      if (countEl) countEl.textContent = visible + (visible === 1 ? ' recipe' : ' recipes');
    }

    groups.forEach(function(g) {
      g.chips.forEach(function(chip) {
        chip.addEventListener('click', function() {
          var value = chip.getAttribute(g.attr) || '';
          if (value === '') {
            g.active = [];
          } else if (g.active.indexOf(value) === -1) {
            g.active.push(value);
          } else {
            g.active = g.active.filter(function(v) { return v !== value; });
          }
          g.chips.forEach(function(c) {
            var v = c.getAttribute(g.attr) || '';
            var on = v === '' ? g.active.length === 0 : g.active.indexOf(v) !== -1;
            c.classList.toggle('tag-chip-selected', on);
            c.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          apply();
        });
      });
    });
  })();
</script>
HTML;

        $descriptionHtml = !empty($category['description'])
            ? '<p class="page-lead">' . $this->esc($category['description']) . '</p>'
            : '';

        $content = <<<HTML
<div class="container section listing-page">
  <span class="eyebrow">
    {$iconHtml}
    <span>Recipe category</span>
  </span>
  <h1 class="page-title">{$this->esc($category['name'])}</h1>
  {$descriptionHtml}
  {$subcategoryNav}{$gridHtml}
</div>
{$filterScript}
HTML;

        return $this->renderLayout(
            $category['name'],
            $category['description'] ?: 'Browse recipes in ' . $category['name'],
            $canonicalPath,
            $content,
            ['active_nav' => $canonicalPath]
        );
    }

    public function renderTagPage(string $tagName, array $recipes): string {
        $tagSlug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $tagName));
        $canonicalPath = '/tag/' . $tagSlug . '/';

        $cardsHtml = '';
        foreach ($recipes as $r) {
            $cardsHtml .= $this->renderRecipeCard($r) . "\n";
        }

        $gridHtml = !empty($cardsHtml)
            ? "<div class=\"cards\">{$cardsHtml}</div>"
            : '<div class="empty">No published recipes use this tag yet.</div>';

        $content = <<<HTML
<div class="container section">
  <span class="eyebrow">Explore by tag</span>
  <h1>#{$this->esc($tagName)}</h1>
  {$gridHtml}
</div>
HTML;

        return $this->renderLayout('Recipes tagged ' . $tagName, 'Browse recipes tagged ' . $tagName . ' at JyoCanCook.', $canonicalPath, $content);
    }

    public function renderSearchPage(): string {
        $content = <<<HTML
<div class="container section">
  <span class="eyebrow">Find something delicious</span>
  <h1>Search recipes</h1>
  <form id="search-form" class="search-field" style="max-width:680px">
    <input id="search-term" placeholder="Try chicken, garlic, rice, dosa..." aria-label="Search recipes" />
    <button class="btn">Search</button>
  </form>
  <p class="muted" id="search-status" style="margin-top:20px">Search by recipe name, ingredient or cooking method.</p>
  <div id="results" class="cards"></div>
</div>

<script>
  (function() {
    var input = document.querySelector('#search-term');
    var results = document.querySelector('#results');
    var status = document.querySelector('#search-status');
    var form = document.querySelector('#search-form');
    var searchIndex = null;

    var initialQuery = new URLSearchParams(location.search).get('q') || '';
    if (input) input.value = initialQuery;

    async function loadIndex() {
      if (searchIndex !== null) return searchIndex;
      try {
        var res = await fetch('/search-index.json');
        searchIndex = await res.json();
        return searchIndex;
      } catch (e) {
        console.error('Failed to load search index:', e);
        return [];
      }
    }

    async function run(q) {
      q = q.trim().toLowerCase();
      if (!q) {
        if (results) results.innerHTML = '';
        if (status) status.textContent = 'Enter something to search for.';
        return;
      }

      if (status) status.textContent = 'Searching...';
      var index = await loadIndex();
      var terms = q.split(/\s+/).filter(Boolean);

      var matches = index.filter(function(item) {
        var searchBlob = (item.title + ' ' + item.description + ' ' + item.category + ' ' + (item.tags || []).join(' ') + ' ' + (item.ingredients || []).join(' ')).toLowerCase();
        return terms.every(function(t) { return searchBlob.indexOf(t) !== -1; });
      });

      if (!results) return;
      results.innerHTML = '';

      if (matches.length === 0) {
        if (status) status.textContent = 'No recipes found for “' + q + '”. Try another ingredient or keyword.';
        return;
      }

      matches.forEach(function(r) {
        var totalTime = (r.prepTime || 0) + (r.cookTime || 0);
        var card = document.createElement('a');
        card.className = 'recipe-card';
        card.href = r.url;

        card.innerHTML =
          '<div class="recipe-card-media">' +
            '<img src="' + r.image + '" alt="' + r.title + '" loading="lazy" />' +
            '<div class="recipe-time-badge"><span>' + totalTime + ' min</span></div>' +
          '</div>' +
          '<div class="recipe-card-content">' +
            '<div class="recipe-card-header">' +
              '<h3>' + r.title + '</h3>' +
            '</div>' +
            '<p class="muted" style="font-size:0.85rem;margin:4px 0 8px;">' + (r.description || '') + '</p>' +
            '<div class="recipe-card-meta">' +
              '<span>' + r.category + '</span>' +
              (r.diets && r.diets.length ? '<span> • ' + r.diets.join(', ') + '</span>' : '') +
            '</div>' +
          '</div>';

        results.appendChild(card);
      });

      if (status) status.textContent = matches.length + ' result(s) for “' + q + '”';
    }

    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var q = input ? input.value : '';
        history.replaceState({}, '', q ? '/search/?q=' + encodeURIComponent(q) : '/search/');
        run(q);
      });
    }

    if (initialQuery) {
      run(initialQuery);
    }
  })();
</script>
HTML;

        return $this->renderLayout('Search Recipes', 'Search authentic homemade Indian recipes by name, ingredient, or tag at JyoCanCook.', '/search/', $content);
    }

    public function renderAboutPage(): string {
        $content = <<<HTML
<div class="container section about-page">
  <div class="about-layout">
    <img class="about-photo" src="/images/about/about-me.jpg" alt="Portrait of the author of JyoCanCook" width="1446" height="1087" />
    <div class="about-text">
      <span class="eyebrow">About Me</span>
      <h1 class="page-title">Simple cooking, unforgettable flavours.</h1>
      <p>Cooking is my passion, and I believe that delicious food doesn't have to be complicated. My love for cooking comes from the simple, authentic recipes passed down by our elders — recipes filled with flavour, tradition, and memories.</p>
      <p>Through JyoCanCook, I want to make these treasured recipes easy for anyone to prepare, especially the younger generation, so they can enjoy the flavours we grew up with and keep the taste of home alive for generations to come.</p>
      <p class="about-tagline">Simple to cook. Rich in flavour. Rooted in tradition.</p>
    </div>
  </div>
</div>
HTML;

        return $this->renderLayout('About JyoCanCook', 'Discover the story, tradition, and passion behind JyoCanCook homemade recipes.', '/about/', $content);
    }

    public function render404Page(): string {
        $content = <<<HTML
<div class="container section" style="text-align:center;padding:80px 20px;">
  <span class="eyebrow">404 Error</span>
  <h1 style="font-size:3rem;margin:12px 0;">Recipe Not Found</h1>
  <p class="muted" style="max-width:500px;margin:0 auto 24px;">The page or recipe you are looking for might have been moved or is no longer available.</p>
  <a class="btn" href="/">Return to Homepage →</a>
</div>
HTML;

        return $this->renderLayout('Page Not Found', 'The requested page was not found on JyoCanCook.', '/404.html', $content, ['noindex' => true]);
    }

    private function getYouTubeEmbedUrl(?string $url): ?string {
        if (!$url) return null;
        try {
            $parsed = parse_url($url);
            $host = $parsed['host'] ?? '';
            $path = $parsed['path'] ?? '';

            if (str_contains($host, 'youtu.be')) {
                $id = trim($path, '/');
                return $id !== '' ? 'https://www.youtube-nocookie.com/embed/' . $id : null;
            }

            if (str_contains($host, 'youtube.com')) {
                if (str_starts_with($path, '/embed/')) {
                    return 'https://www.youtube-nocookie.com' . $path;
                }
                if (str_starts_with($path, '/shorts/')) {
                    $id = str_replace('/shorts/', '', $path);
                    return $id !== '' ? 'https://www.youtube-nocookie.com/embed/' . $id : null;
                }
                parse_str($parsed['query'] ?? '', $query);
                if (!empty($query['v'])) {
                    return 'https://www.youtube-nocookie.com/embed/' . $query['v'];
                }
            }
        } catch (Throwable) {}
        return null;
    }
}
