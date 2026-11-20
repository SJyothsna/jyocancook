<?php
declare(strict_types=1);

/**
 * JyoCanCook Static Template Renderer
 * Recreates the JyoCanCook warm burgundy-and-cream design system,
 * responsive layouts, SVG icons, Schema.org JSON-LD, and meta tags.
 */

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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
          </form>

          <div class="top-links">
            <a href="/recipes/" class="top-link">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
              <span>My Recipes</span>
            </a>
          </div>
        </div>
      </div>

      <div class="nav-shell">
        <nav class="container nav" aria-label="Main navigation">
          {$this->renderNavLinks($activeNav)}
        </nav>
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
  </body>
</html>
HTML;
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

        $html = '';
        foreach ($links as $link) {
            $href = $link['href'];
            $label = $link['label'];
            $isActive = ($href === '/' && $activeNav === '/') || ($href !== '/' && str_starts_with($activeNav, $href));
            $activeClass = $isActive ? ' class="active"' : '';

            $iconSvg = $href === '/'
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:4px;"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
                : '';

            $html .= "<a href=\"{$this->esc($href)}\"{$activeClass}>{$iconSvg}<span>{$this->esc($label)}</span></a>\n";
        }

        return $html;
    }

    public function renderRecipeCard(array $recipe): string {
        $url = '/recipes/' . $recipe['slug'] . '/';
        $totalTime = ($recipe['prepTime'] ?? 0) + ($recipe['cookTime'] ?? 0);
        $dietHtml = !empty($recipe['diet']) ? ' • ' . $this->esc($recipe['diet']) : '';
        $categoryName = $recipe['category_name'] ?? ucfirst($recipe['category'] ?? '');

        return <<<HTML
<a class="recipe-card" href="{$this->esc($url)}">
  <div class="recipe-card-media">
    <img src="{$this->esc($recipe['image'])}" alt="{$this->esc($recipe['title'])}" loading="lazy" />
    <div class="recipe-time-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>{$totalTime} min</span>
    </div>
  </div>
  <div class="recipe-card-content">
    <div class="recipe-card-header">
      <h3>{$this->esc($recipe['title'])}</h3>
      <button type="button" class="recipe-fav-btn" aria-label="Save {$this->esc($recipe['title'])} to favourites">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
      </button>
    </div>
    <div class="recipe-card-meta">
      <span>{$this->esc($categoryName)}</span>
      <span>{$dietHtml}</span>
    </div>
  </div>
</a>
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
            if (($r['diet'] ?? '') === ($recipe['diet'] ?? '')) $score += 1;
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
            $mediaHtml = "<img class=\"recipe-main-image\" src=\"{$this->esc($recipe['image'])}\" alt=\"{$this->esc($recipe['title'])}\" />";
        }

        // Calories pill inside meta strip
        $caloriesPill = '';
        if (isset($recipe['nutrition']['calories'])) {
            $caloriesPill = <<<HTML
<div class="meta-item">
  <span class="meta-icon">⚡</span>
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
  <span class="nutrition-label">Nutrition:</span>
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
                $unitPart = !empty($i['unit']) ? ' ' . $this->esc($i['unit']) : '';
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

            $stepsHtml .= <<<HTML
<div class="step">
  <div class="step-num">{$num}</div>
  <div class="step-body">
    <div class="step-content">
      <h3>{$this->esc($s['title'])}</h3>
      <p>{$this->esc($s['text'])}</p>
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
<div class="panel panel-warm" style="margin-bottom:0">
  <h2>💡 Pro Tips</h2>
  <ul>{$tipsLi}</ul>
</div>
HTML;
            }

            $serveBlock = '';
            if (!empty($serveWith)) {
                $serveStr = implode(' · ', array_map([$this, 'esc'], $serveWith));
                $serveBlock = <<<HTML
<div class="panel" style="margin-bottom:0">
  <h2>🍽️ Serve with</h2>
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
<div class="container">
  <div class="breadcrumb">
    <a href="/">Home</a> › <a href="/category/{$this->esc($categorySlug)}/">{$this->esc($categoryName)}</a> › {$this->esc($recipe['title'])}
  </div>
  <div class="recipe-title">
    <h1>{$this->esc($recipe['title'])}</h1>
    <p class="muted intro">{$this->esc($recipe['description'])}</p>
    <div class="tags">
      {$tagsHtml}
    </div>
    <div class="recipe-actions">
      <button id="save" class="btn btn-outline" type="button">♡ Save</button>
      <button id="share" class="btn btn-outline" type="button">↗ Share</button>
      <button class="btn btn-outline" type="button" onclick="window.print()">▣ Print</button>
    </div>
  </div>

  <div class="recipe-layout">
    <div>
      {$mediaHtml}

      <div class="meta-strip">
        <div class="meta-item">
          <span class="meta-icon">◷</span>
          <div class="meta-content">
            <span class="meta-label">Prep Time</span>
            <strong class="meta-value">{$this->esc((string)($recipe['prepTime'] ?? 15))} min</strong>
          </div>
        </div>
        <div class="meta-item">
          <span class="meta-icon">♨</span>
          <div class="meta-content">
            <span class="meta-label">Cook Time</span>
            <strong class="meta-value">{$this->esc((string)($recipe['cookTime'] ?? 30))} min</strong>
          </div>
        </div>
        <div class="meta-item">
          <span class="meta-icon">♧</span>
          <div class="meta-content">
            <span class="meta-label">Servings</span>
            <strong class="meta-value">{$this->esc((string)($recipe['servings'] ?? 4))}</strong>
          </div>
        </div>
        <div class="meta-item">
          <span class="meta-icon">☆</span>
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
        <h2>How to make {$this->esc($recipe['title'])}</h2>
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
      if (output) output.textContent = formatQty(base * scale);
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
    if (saveBtn) {
      saveBtn.textContent = saved.indexOf(slug) !== -1 ? '♥ Saved' : '♡ Save';
      saveBtn.onclick = function() {
        var arr = JSON.parse(localStorage.getItem('jyo-saved') || '[]');
        var idx = arr.indexOf(slug);
        if (idx !== -1) {
          arr.splice(idx, 1);
        } else {
          arr.push(slug);
        }
        localStorage.setItem('jyo-saved', JSON.stringify(arr));
        saveBtn.textContent = arr.indexOf(slug) !== -1 ? '♥ Saved' : '♡ Save';
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
  <section class="section subcat-section">
    <div class="section-heading-centered">
      <div class="section-title-flourish">
        <h2 class="section-title">Browse by Subcategory</h2>
      </div>
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:6px;"><path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2"/><path d="M14 2v20"/><path d="M4 2v20"/><path d="M4 2v6a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2"/></svg>
        <span>Explore Recipes →</span>
      </a>
    </div>
    <aside class="hero-about panel panel-warm">
      <div class="hero-about-inner">
        <div class="about-photo-wrap"><img class="about-photo" src="/images/about/about-me.jpg" alt="Portrait of the author of JyoCanCook" /></div>
        <div class="about-text">
          <h2>About me</h2>
          <p>Cooking is my passion, and I believe great taste doesn't need complicated recipes. Through JyoCanCook, I share simple, authentic recipes inspired by our elders, keeping the flavours of home alive for the younger generation to enjoy and cherish.</p>
          <p><em>Simple to cook. Rich in flavour. Rooted in tradition.</em></p>
          <a class="link" href="/about/">Read more →</a>
        </div>
      </div>
    </aside>
  </section>
</div>

{$subcategoriesHtml}<div class="container">
  <section class="section">
    <div class="section-heading-centered">
      <div class="section-title-flourish">
        <h2 class="section-title">Latest Recipes</h2>
      </div>
      <a class="link link-right" href="/recipes/">View All Recipes →</a>
    </div>

    <div class="cards">
      {$cardsHtml}
    </div>
  </section>

  <section class="section" style="padding-top: 0;">
    <div class="panel panel-warm" style="text-align: center; padding: 44px 24px;">
      <h2>Cooking brings us together</h2>
      <p class="muted" style="max-width: 600px; margin: 0 auto 20px;">
        Explore favourite recipes, discover traditional flavours and make memories around the family table.
      </p>
      <a class="btn" href="/recipes/">Discover Recipes</a>
    </div>
  </section>
</div>
HTML;

        return $this->renderLayout('Authentic Homemade Indian Recipes', 'Discover authentic Indian dishes, everyday meals and family favourites at JyoCanCook.', '/', $content);
    }

    public function renderRecipesIndexPage(array $recipes, array $categories, array $tags, array $subcategories = []): string {
        $subNames = $this->subcategoryNames($subcategories);
        $catMap = $this->categorySubMap($categories);

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

            $cardsHtml .= "<div data-title=\"{$this->esc($tLower)}\" data-ingredients=\"{$this->esc($ingNames)}\" data-subcategory=\"{$this->esc($subSlug)}\">{$card}</div>\n";
        }

        $subChips = "<button type=\"button\" class=\"tag-chip tag-chip-selected\" data-subcategory=\"\" aria-pressed=\"true\">All</button>\n";
        foreach ($usedSubcategories as $slug => $name) {
            $subChips .= "<button type=\"button\" class=\"tag-chip\" data-subcategory=\"{$this->esc((string)$slug)}\" aria-pressed=\"false\">{$this->esc($name)}</button>\n";
        }
        $subChips = "<div id=\"subcategory-chips\" style=\"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px\" role=\"group\" aria-label=\"Filter by subcategory\">\n{$subChips}</div>";

        $count = count($recipes);

        $content = <<<HTML
<div class="container section">
  <span class="eyebrow">Recipe collection</span>
  <h1>Find your next favourite</h1>
  <p class="muted">Browse our recipes or filter by subcategory and name.</p>
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
    var items = Array.prototype.slice.call(document.querySelectorAll('#recipe-list > div'));
    var countEl = document.querySelector('#recipe-count');
    var emptyEl = document.querySelector('#filter-empty');
    var activeSub = '';

    function filter() {
      var q = (text ? text.value : '').toLowerCase().trim();
      var n = 0;

      items.forEach(function(el) {
        var t = el.getAttribute('data-title') || '';
        var ing = el.getAttribute('data-ingredients') || '';
        var s = (el.getAttribute('data-subcategory') || '').split(',');

        var ok = (!q || (t + ' ' + ing).indexOf(q) !== -1)
          && (!activeSub || s.indexOf(activeSub) !== -1);

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

    if (text) text.addEventListener('input', filter);

    var initialSub = new URLSearchParams(window.location.search).get('subcategory');
    if (initialSub) {
      var match = chips.filter(function(c) { return c.getAttribute('data-subcategory') === initialSub; })[0];
      if (match) match.click();
    }
  })();
</script>
HTML;

        return $this->renderLayout('All Recipes', 'Browse all authentic homemade Indian recipes at JyoCanCook.', '/recipes/', $content);
    }

    public function renderCategoryPage(array $category, array $recipes, array $categories = [], array $subcategories = []): string {
        $subNames = $this->subcategoryNames($subcategories);
        $catMap = $this->categorySubMap($categories);

        $canonicalPath = '/category/' . $category['slug'] . '/';
        $iconHtml = !empty($category['image'])
            ? "<img src=\"{$this->esc($category['image'])}\" alt=\"\" style=\"width:20px;height:20px;object-fit:contain\" />"
            : '';

        $cardsHtml = '';
        foreach ($recipes as $r) {
            $sub = $this->esc(implode(',', $this->recipeSubSlugs($r, $subNames, $catMap)));
            $cardsHtml .= "<div data-subcategory=\"{$sub}\">" . $this->renderRecipeCard($r) . "</div>\n";
        }

        $gridHtml = !empty($cardsHtml)
            ? "<div class=\"cards\" id=\"category-list\">{$cardsHtml}</div>"
            : '<div class="empty">More recipes are coming soon in this category.</div>';

        // Subcategory chips: this category's own subcategories that are used by this page's recipes.
        $subChips = '';
        foreach ($subNames as $slug => $name) {
            if (!in_array((string)$slug, $catMap[(string)($category['slug'] ?? '')] ?? [], true)) continue;
            $used = array_filter($recipes, fn($r) => in_array((string)$slug, $this->recipeSubSlugs($r, $subNames, $catMap), true));
            if (!$used) continue;
            $subChips .= "<button type=\"button\" class=\"tag-chip\" data-subcategory=\"{$this->esc((string)$slug)}\" aria-pressed=\"false\">{$this->esc($name)}</button>\n";
        }
        $subcategoryNav = $subChips === '' ? '' : "<div id=\"subcategory-chips\" style=\"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px\" role=\"group\" aria-label=\"Filter by subcategory\">\n"
            . "<button type=\"button\" class=\"tag-chip tag-chip-selected\" data-subcategory=\"\" aria-pressed=\"true\">All</button>\n"
            . $subChips . "</div>\n";
        $filterScript = $subChips === '' ? '' : <<<HTML
<script>
  (function() {
    var chips = Array.prototype.slice.call(document.querySelectorAll('#subcategory-chips .tag-chip'));
    var items = Array.prototype.slice.call(document.querySelectorAll('#category-list > div'));
    var active = '';
    chips.forEach(function(chip) {
      chip.addEventListener('click', function() {
        var value = chip.getAttribute('data-subcategory') || '';
        active = value !== '' && active === value ? '' : value;
        chips.forEach(function(c) {
          var on = (c.getAttribute('data-subcategory') || '') === active;
          c.classList.toggle('tag-chip-selected', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        items.forEach(function(el) {
          var subs = (el.getAttribute('data-subcategory') || '').split(',');
          el.classList.toggle('hidden', active !== '' && subs.indexOf(active) === -1);
        });
      });
    });
  })();
</script>
HTML;

        $content = <<<HTML
<div class="container section">
  <span class="eyebrow" style="display:inline-flex;align-items:center;gap:6px">
    {$iconHtml}
    <span>Recipe category</span>
  </span>
  <h1>{$this->esc($category['name'])}</h1>
  <p class="muted">{$this->esc($category['description'])}</p>
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
              (r.diet ? '<span> • ' + r.diet + '</span>' : '') +
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
<div class="container section">
  <span class="eyebrow">About me</span>
  <div class="about-layout">
    <img class="about-photo" src="/images/about/about-me.jpg" alt="Portrait of the author of JyoCanCook" />
    <div class="about-text">
      <h1>Simple cooking, unforgettable flavours.</h1>
      <p>Cooking is my passion, and I believe that delicious food doesn't have to be complicated. My love for cooking comes from the simple, authentic recipes passed down by our elders — recipes filled with flavour, tradition, and memories.</p>
      <p>Through JyoCanCook, I want to make these treasured recipes easy for anyone to prepare, especially the younger generation, so they can enjoy the flavours we grew up with and keep the taste of home alive for generations to come.</p>
      <p><em>Simple to cook. Rich in flavour. Rooted in tradition.</em></p>
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
