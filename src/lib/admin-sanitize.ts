// Validation for the local-dev admin API (see astro.config.mjs). Production uses the PHP backend.

export const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

export function safeLink(s: string): boolean {
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') && !/[<>'"\n\r]/.test(s);
}

export function validUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeRecipe(r: any) {
  if (!r || typeof r !== 'object') throw Error('Missing recipe');
  const title = String(r.title || '').trim();
  const id = slug(String(r.slug || title));
  if (!title || title.length > 140 || !id) throw Error('Valid recipe title and slug required');
  if (!Array.isArray(r.ingredients) || !Array.isArray(r.steps) || !r.ingredients.length || !r.steps.length) {
    throw Error('At least one ingredient and step are required');
  }
  const img = String(r.image || '/images/recipes/recipe-placeholder.svg');
  if (!safeLink(img) && !validUrl(img)) throw Error('Invalid image URL');
  const steps = r.steps.slice(0, 80).map((s: any) => ({
    title: String(s.title || '').slice(0, 180),
    text: String(s.text || '').slice(0, 4000),
    ...(s.image && safeLink(String(s.image)) ? { image: s.image } : {}),
  }));
  const ingredients = r.ingredients.slice(0, 120).map((i: any) => ({
    amount: i.amount === null || i.amount === '' ? null : Number(i.amount),
    unit: String(i.unit || '').slice(0, 25),
    name: String(i.name || '').slice(0, 180),
    ...(i.section ? { section: String(i.section).slice(0, 100)} : {}),
  }));
  if (ingredients.some((i: any) => i.amount !== null && (!Number.isFinite(i.amount) || i.amount < 0))) {
    throw Error('Invalid ingredient quantity');
  }
  const nut = r.nutrition && typeof r.nutrition === 'object' ? {
    ...(r.nutrition.calories !== undefined && r.nutrition.calories !== '' && !isNaN(Number(r.nutrition.calories)) ? { calories: Math.max(0, Math.min(100000, Math.round(Number(r.nutrition.calories)))) } : {}),
    ...(r.nutrition.carbs !== undefined && r.nutrition.carbs !== '' && !isNaN(Number(r.nutrition.carbs)) ? { carbs: Math.max(0, Math.min(10000, Number(Number(r.nutrition.carbs).toFixed(1)))) } : {}),
    ...(r.nutrition.protein !== undefined && r.nutrition.protein !== '' && !isNaN(Number(r.nutrition.protein)) ? { protein: Math.max(0, Math.min(10000, Number(Number(r.nutrition.protein).toFixed(1)))) } : {}),
    ...(r.nutrition.fat !== undefined && r.nutrition.fat !== '' && !isNaN(Number(r.nutrition.fat)) ? { fat: Math.max(0, Math.min(10000, Number(Number(r.nutrition.fat).toFixed(1)))) } : {}),
    ...(r.nutrition.fiber !== undefined && r.nutrition.fiber !== '' && !isNaN(Number(r.nutrition.fiber)) ? { fiber: Math.max(0, Math.min(10000, Number(Number(r.nutrition.fiber).toFixed(1)))) } : {}),
  } : undefined;
  const nutrition = nut && Object.keys(nut).length > 0 ? nut : undefined;

  // Several sub categories (category slugs); a single legacy `subcategory` value is still accepted.
  const rawSubcategories = Array.isArray(r.subcategories) ? r.subcategories : r.subcategory ? [r.subcategory] : [];
  const subcategories: string[] = [...new Set<string>(rawSubcategories.map((s: any) => slug(String(s))).filter(Boolean))].slice(0, 12);

  // One or more diets (Vegetarian and Vegan, say); a single legacy `diet` value is still accepted.
  const rawDiets = Array.isArray(r.diets) ? r.diets : r.diet ? [r.diet] : [];
  const dietList: string[] = [...new Set<string>(rawDiets.map((d: any) => String(d).replace(/,/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);
  const diets = dietList.length ? dietList : ['Vegetarian'];

  return {
    slug: id,
    title,
    description: String(r.description || '').slice(0, 1000),
    category: slug(String(r.category || '')),
    ...(subcategories.length ? { subcategories } : {}),
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 30).map((t: any) => String(t).slice(0, 60)) : [],
    diets,
    prepTime: Math.max(0, Math.min(10000, Number(r.prepTime) || 0)),
    cookTime: Math.max(0, Math.min(10000, Number(r.cookTime) || 0)),
    servings: Math.max(1, Math.min(100, Number(r.servings) || 4)),
    difficulty: String(r.difficulty || 'Easy').slice(0, 40),
    image: img,
    published: r.published === true,
    featured: r.featured === true,
    ...(r.story ? { story: String(r.story).slice(0, 10000) } : {}),
    ingredients,
    steps,
    tips: Array.isArray(r.tips) ? r.tips.slice(0, 30).map(String) : [],
    serveWith: Array.isArray(r.serveWith) ? r.serveWith.slice(0, 30).map(String) : [],
    ...(r.youtubeUrl && validUrl(String(r.youtubeUrl)) ? { youtubeUrl: r.youtubeUrl } : {}),
    ...(String(r.cuisine || '').trim() ? { cuisine: String(r.cuisine).trim().slice(0, 60) } : {}),
    ...(nutrition ? { nutrition } : {}),
  };
}

export function sanitizeConfig(type: string, data: any) {
  if (!Array.isArray(data) || data.length > 200) throw Error('Expected a list (maximum 200 entries)');
  if (type === 'categories') {
    const result = data.map((x: any) => ({
      slug: slug(String(x.slug || x.name || '')),
      name: String(x.name || '').slice(0, 80),
      description: String(x.description || '').slice(0, 300),
      image: String(
        x.image || x.emoji || '/images/categories/' + slug(String(x.slug || x.name || '')) + '.svg'
      ).slice(0, 300),
      order: Number(x.order) || 0,
      subcategories: [...new Set<string>((Array.isArray(x.subcategories) ? x.subcategories : []).map((s: any) => slug(String(s))).filter(Boolean))],
    }));
    if (result.some((x: any) => !x.slug || !x.name)) throw Error('Category name and slug required');
    if (new Set(result.map((x: any) => x.slug)).size !== result.length) throw Error('Duplicate category slug');
    return result;
  }
  if (type === 'subcategories') {
    const result = data.map((x: any, i: number) => ({
      slug: slug(String(x.slug || x.name || '')),
      name: String(x.name || '').slice(0, 80),
      order: Number(x.order) || i,
    }));
    if (result.some((x: any) => !x.slug || !x.name)) throw Error('Sub category name and slug required');
    if (new Set(result.map((x: any) => x.slug)).size !== result.length) throw Error('Duplicate sub category slug');
    return result;
  }
  if (type === 'diets') {
    const result = data.map((x: any, i: number) => ({
      slug: slug(String(x.slug || x.name || '')).slice(0, 40),
      name: String(x.name || '').trim().slice(0, 40),
      order: Number(x.order) || i,
    }));
    if (!result.length) throw Error('Add at least one diet');
    if (result.some((x: any) => !x.slug || !x.name)) throw Error('Diet name and slug required');
    if (new Set(result.map((x: any) => x.slug)).size !== result.length) throw Error('Duplicate diet slug');
    return result;
  }

  if (type === 'tags') return [...new Set(data.map((x: any) => String(x).trim().slice(0, 60)).filter(Boolean))];
  if (type === 'menu') {
    const result = data.map((x: any) => ({
      label: String(x.label || '').slice(0, 70),
      href: String(x.href || '').toLowerCase(),
      order: Number(x.order) || 0,
      visible: x.visible !== false,
    }));
    if (result.some((x: any) => !x.label || !safeLink(x.href))) {
      throw Error('Menu links must be internal paths starting with /');
    }
    return result;
  }
  throw Error('Unsupported type');
}
