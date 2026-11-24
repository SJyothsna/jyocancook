import { formatQty, parseQty } from '../lib/fractions';
import { slug as makeSlug } from '../lib/admin-sanitize';
import { applyListFormat } from '../lib/recipe-text';

type Item = Record<string, any>;
const el = (id: string) => document.getElementById(id)!;
const content = el('admin-content'),
  message = el('admin-message');
let tab = 'recipes',
  cache: Record<string, any> = {},
  editing: string | null = null,
  csrfToken = '';

const esc = (v: any) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
  );

function notice(s: string, error = false) {
  message.textContent = s;
  message.classList.toggle('error', error);
}

const UNITS = [
  { value: '', label: 'none' },
  { value: 'tsp', label: 'Tsp' },
  { value: 'tbsp', label: 'Tbsp' },
  { value: 'cup', label: 'cup' },
  { value: 'g', label: 'g (grams)' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l (litres)' },
  { value: 'pinch', label: 'pinch' },
  { value: 'to taste', label: 'to taste' },
  { value: 'piece', label: 'piece / no.' },
  { value: 'clove', label: 'clove' },
  { value: 'bunch', label: 'bunch' },
  { value: 'inch', label: 'inch' },
  { value: 'sprig', label: 'sprig' },
];

async function api(path: string, method = 'GET', data?: any) {
  try {
    const res = await fetch('/api/admin/' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      ...(method !== 'GET' ? { body: JSON.stringify(data) } : {}),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (res.status === 404) {
        throw Error(
          'Admin API endpoint (/api/admin/' +
            path +
            ') is not available.',
        );
      }
      throw Error(`Unexpected response (${res.status} ${res.statusText})`);
    }
    const body = await res.json();
    if (!res.ok) throw Error(body.error || 'Unable to save');
    if (body.csrf_token) csrfToken = body.csrf_token;
    return body;
  } catch (err: any) {
    throw Error(err?.message || String(err));
  }
}

async function load() {
  notice('Loading ' + tab + '...');
  try {
    if (tab === 'recipes') {
      const [recipesRes, categoriesRes, tagsRes, subcategoriesRes, dietsRes] = await Promise.all([
        api('recipes'),
        cache.categories ? Promise.resolve(cache.categories) : api('categories').catch(() => ({ data: [] })),
        cache.tags ? Promise.resolve(cache.tags) : api('tags').catch(() => ({ data: [] })),
        cache.subcategories ? Promise.resolve(cache.subcategories) : api('subcategories').catch(() => ({ data: [] })),
        cache.diets ? Promise.resolve(cache.diets) : api('diets').catch(() => ({ data: [] })),
      ]);
      cache.recipes = recipesRes.data;
      cache.categories = categoriesRes;
      cache.tags = tagsRes;
      cache.subcategories = subcategoriesRes;
      cache.diets = dietsRes;
    } else {
      cache[tab] = await api(tab);
      if (tab === 'categories') {
        // The categories tab maps sub categories to each category.
        cache.subcategories = await api('subcategories').catch(() => ({ data: [] }));
      }
    }
    render();
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    notice(
      isLocal
        ? 'Ready (Local Mode). Changes save directly to database & generate static files.'
        : 'Ready (Hostinger Native). Saved recipes generate live static HTML pages immediately.',
    );
  } catch (e: any) {
    notice(String(e?.message || e), true);
    content.classList.add('hidden');
  }
}

function actionButton(label: string, id: string) {
  return `<button class="btn btn-outline" type="button" data-action="${id}">${esc(label)}</button>`;
}

function render() {
  content.classList.remove('hidden');
  if (tab === 'recipes') {
    renderRecipes();
    return;
  }
  renderConfig();
}

// Category dropdown for a row in the recipe list.
function listSelect(field: 'category', r: any) {
  const value = r[field] || '';
  const options: { slug: string; name: string }[] = [...(cache.categories?.data || [])];
  if (value && !options.some((c) => c.slug === value)) options.push({ slug: value, name: value });
  return `<select data-field="${field}" data-slug="${esc(r.slug)}" aria-label="Category: ${esc(
    r.title,
  )}" style="min-width:140px;padding:6px 8px;font-size:var(--fs-sm);">${options
    .map((c) => `<option value="${esc(c.slug)}" ${c.slug === value ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('')}</select>`;
}

// Draft preview: opens the saved recipe page (admin-only, not public) in a new tab.
function previewLink(slug: string, label = 'Preview') {
  return `<a class="btn btn-outline" href="/api/admin/preview/${encodeURIComponent(slug)}" target="_blank" rel="noopener" style="padding:4px 10px;font-size:var(--fs-xs);">${label}</a>`;
}

function renderRecipes() {
  const recipes = cache.recipes || [];
  const current = editing ? recipes.find((r: any) => r.slug === editing) : undefined;
  content.innerHTML = `<div class="section-heading"><h2>Recipes</h2>${actionButton(
    current ? 'Back to list' : 'Add recipe',
    'new',
  )}</div>${
    current || editing === '__new__'
      ? recipeForm(current)
      : `<table class="admin-table"><thead><tr><th>Recipe</th><th>Category</th><th>Published</th><th>Featured</th><th></th></tr></thead><tbody>${recipes
          .map(
            (r: any) =>
              `<tr><td>${esc(r.title)}</td><td>${listSelect('category', r)}</td>${['published', 'featured']
                .map(
                  (f) =>
                    `<td><input type="checkbox" data-field="${f}" data-slug="${esc(r.slug)}" aria-label="${
                      f === 'published' ? 'Published' : 'Featured'
                    }: ${esc(r.title)}" ${r[f] ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;"/></td>`,
                )
                .join('')}<td><button type="button" data-edit="${esc(r.slug)}">Edit</button>${
                  r.published ? '' : ` ${previewLink(r.slug)}`
                }</td></tr>`,
          )
          .join('')}</tbody></table>`
  }`;
  wireActions();
  // Category, Published and Featured save straight from the list.
  content.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach((control) => {
    control.onchange = async () => {
      const recipe = (cache.recipes || []).find((x: any) => x.slug === control.dataset.slug);
      const field = control.dataset.field!;
      if (!recipe) return;
      const isCheckbox = control instanceof HTMLInputElement;
      const value = isCheckbox ? control.checked : control.value;
      const previous = isCheckbox ? !!recipe[field] : recipe[field] || '';
      control.disabled = true;
      try {
        notice('Saving...');
        await api('recipes/' + recipe.slug, 'POST', { recipe: { ...recipe, [field]: value } });
        recipe[field] = value;
        const label = isCheckbox ? '' : control.selectedOptions[0]?.textContent || '';
        notice(
          `${recipe.title}: ${
            field === 'published'
              ? value
                ? 'published'
                : 'moved to drafts'
              : field === 'featured'
                ? value
                  ? 'featured'
                  : 'no longer featured'
                : `category set to ${label}`
          }.`,
        );
      } catch (e) {
        if (isCheckbox) control.checked = !!previous;
        else control.value = String(previous);
        notice(String(e), true);
      } finally {
        control.disabled = false;
      }
    };
  });
  content.querySelectorAll<HTMLElement>('[data-edit]').forEach(
    (x) =>
      (x.onclick = () => {
        editing = x.dataset.edit!;
        render();
      }),
  );
  if (current || editing === '__new__') wireRecipeForm(current);
}

function unitOptionsHtml(selectedUnit: string = '') {
  const norm = (selectedUnit || '').trim().toLowerCase();
  const hasCustom = norm && !UNITS.some((u) => u.value === norm);
  let html = UNITS.map(
    (u) => `<option value="${esc(u.value)}" ${norm === u.value ? 'selected' : ''}>${esc(u.label)}</option>`,
  ).join('');
  if (hasCustom) {
    html += `<option value="${esc(selectedUnit)}" selected>${esc(selectedUnit)}</option>`;
  }
  return html;
}

function ingredientRowHtml(item: { name?: string; amount?: number | null | string; unit?: string } = {}) {
  const amountStr =
    item.amount !== null && item.amount !== undefined && item.amount !== '' ? formatQty(Number(item.amount)) : '';
  return `<div class="ingredient-row">
    <input type="text" class="ing-name" placeholder="Ingredient name (e.g. Mustard seeds)" value="${esc(item.name || '')}" required />
    <input type="text" inputmode="decimal" class="ing-amount" placeholder="Qty" title="Optional. Type 1/2, 1 1/2 or 0.5" aria-label="Quantity (optional)" value="${esc(amountStr)}" />
    <select class="ing-unit">
      ${unitOptionsHtml(item.unit || '')}
    </select>
    <button type="button" class="btn-icon-remove move-up" title="Move ingredient up" aria-label="Move ingredient up">↑</button>
    <button type="button" class="btn-icon-remove move-down" title="Move ingredient down" aria-label="Move ingredient down">↓</button>
    <button type="button" class="btn-icon-remove remove-ing-row" title="Remove ingredient">✕</button>
  </div>`;
}

function ingredientSectionHtml(sec: { title?: string; items?: any[] } = {}) {
  const items = sec.items && sec.items.length ? sec.items : [{}];
  return `<div class="admin-section-box ingredient-section" data-ingredient-section>
    <div class="admin-section-head">
      <input type="text" class="section-title-input" placeholder="Section name (e.g. For Tempering, For Curry, Main Ingredients)" value="${esc(sec.title || '')}" />
      <button type="button" class="btn-icon-remove move-up" title="Move section up" aria-label="Move section up">↑</button>
      <button type="button" class="btn-icon-remove move-down" title="Move section down" aria-label="Move section down">↓</button>
      <button type="button" class="btn-icon-danger remove-section" title="Remove section">✕</button>
    </div>
    <div class="ingredient-rows">
      ${items.map((i) => ingredientRowHtml(i)).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-light add-ing-row">+ Add Ingredient</button>
  </div>`;
}

function stepSectionHtml(step: { title?: string; text?: string; image?: string } = {}) {
  const hasImg = Boolean(step.image);
  return `<div class="step-section-box" data-step-section>
    <div class="step-section-head">
      <input type="text" class="step-title-input" placeholder="Step / Section Title (e.g. Sauté Onions, Tempering, Simmer)" value="${esc(step.title || '')}" required />
      <button type="button" class="btn-icon-remove move-up" title="Move step up" aria-label="Move step up">↑</button>
      <button type="button" class="btn-icon-remove move-down" title="Move step down" aria-label="Move step down">↓</button>
      <button type="button" class="btn-icon-danger remove-step-box" title="Remove step">✕</button>
    </div>
    <div class="step-format-row">
      <button type="button" class="btn btn-light step-format" data-format="ul" title="Turn every line into a bullet point">• Bullets</button>
      <button type="button" class="btn btn-light step-format" data-format="ol" title="Number every line">1. Numbered</button>
      <span class="field-note">One instruction per line. Click again to remove the bullets or numbers.</span>
    </div>
    <textarea class="step-text-input" rows="3" placeholder="Detailed instructions for this step..." required>${esc(step.text || '')}</textarea>
    <div class="step-image-row" style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600;color:var(--muted)">Step photo:</span>
      <input type="text" class="step-image-input" placeholder="/images/recipes/... (optional)" value="${esc(step.image || '')}" style="flex:1;min-width:160px;font-size:13px;padding:6px 10px" />
      <label class="btn btn-outline" style="padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap;margin:0" title="Upload step photo">
        📷 Upload Photo
        <input type="file" class="step-upload-file" accept="image/jpeg,image/png,image/webp" style="display:none"/>
      </label>
      <button type="button" class="btn btn-light clear-step-image" style="padding:4px 8px;font-size:12px;${hasImg ? '' : 'display:none'}" title="Remove photo">Remove</button>
    </div>
    <div class="step-image-preview" style="margin-top:4px;${hasImg ? '' : 'display:none'}">
      <img src="${esc(step.image || '')}" alt="Step preview" style="max-height:80px;max-width:140px;border-radius:var(--radius-sm);object-fit:cover;border:1px solid var(--line)" />
    </div>
  </div>`;
}

function groupIngredientsBySection(ingredients: any[] = []) {
  if (!ingredients.length) {
    return [{ title: '', items: [{ name: '', amount: null, unit: '' }] }];
  }
  const sections: { title: string; items: any[] }[] = [];
  ingredients.forEach((ing) => {
    const title = (ing.section || '').trim();
    const last = sections[sections.length - 1];
    if (last && last.title === title) {
      last.items.push(ing);
    } else {
      sections.push({ title, items: [ing] });
    }
  });
  return sections.length ? sections : [{ title: '', items: [{ name: '', amount: null, unit: '' }] }];
}

// Chips for the sub categories offered by the selected category.
function subcategoryChipsHtml(categorySlug: string, selected: Set<string>) {
  if (!categorySlug) {
    return '<span class="field-note">Choose a category first to see its sub categories.</span>';
  }
  const category = (cache.categories?.data || []).find((c: any) => c.slug === categorySlug);
  const offered = new Set<string>(Array.isArray(category?.subcategories) ? category.subcategories : []);
  const subs: { slug: string; name: string }[] = (cache.subcategories?.data || []).filter((s: any) =>
    offered.has(s.slug),
  );
  if (!subs.length) {
    return '<span class="field-note">This category has no sub categories yet. Configure them on the Categories tab.</span>';
  }
  return subs
    .map((s) => {
      const on = selected.has(s.slug);
      return `<button type="button" class="tag-chip ${on ? 'tag-chip-selected' : ''}" data-subcategory="${esc(s.slug)}" data-label="${esc(s.name)}" aria-pressed="${on}">${on ? '✓ ' : '+ '}${esc(s.name)}</button>`;
    })
    .join('');
}

function recipeForm(r: any) {
  const categories = cache.categories?.data || [];
  const categoryOptions = categories.length ? categories : [];
  const predefinedTags: string[] = cache.tags?.data || [];
  const recipeTags: string[] = Array.isArray(r?.tags) ? r.tags : [];
  const allTagNames: string[] = [...predefinedTags];
  recipeTags.forEach((t: string) => {
    if (t && !allTagNames.some((p) => p.toLowerCase() === t.toLowerCase())) {
      allTagNames.push(t);
    }
  });
  const selectedTagSet = new Set(recipeTags.map((t: string) => String(t).toLowerCase()));
  const selectedSubcategories = new Set<string>(
    Array.isArray(r?.subcategories) ? r.subcategories : r?.subcategory ? [r.subcategory] : [],
  );
  // The Diets tab list. A recipe can have several diets (Vegetarian and Vegan, say); a recipe file with
  // the older single `diet` value still works, and a diet removed from the list stays ticked until unticked.
  const dietNames: string[] = (cache.diets?.data || []).map((d: any) => d.name);
  const selectedDiets: string[] = Array.isArray(r?.diets) ? r.diets : r?.diet ? [r.diet] : [];
  selectedDiets.forEach((d) => {
    if (!dietNames.includes(d)) dietNames.push(d);
  });
  const ingredientSections = groupIngredientsBySection(r?.ingredients);
  const stepsList = r?.steps && r.steps.length ? r.steps : [{ title: '', text: '' }];

  return `<form class="admin-form" id="recipe-form">
    <div class="admin-sticky-actions">
      <button class="btn" type="submit">${r ? 'Save changes' : 'Create recipe'}</button>
    </div>
    <label>Recipe title<input name="title" id="recipe-title" required maxlength="140" value="${esc(r?.title)}" placeholder="e.g. Andhra Chicken Curry"/></label>
    <label>Slug (URL, auto-generated from title)<input name="slug" id="recipe-slug" ${
      r ? 'readonly' : ''
    } placeholder="andhra-chicken-curry" value="${esc(r?.slug)}"/></label>
    <label>Description<textarea name="description" placeholder="A short, inviting description of this dish">${esc(r?.description)}</textarea></label>
    <label>Story / Background (optional)<textarea name="story" rows="4" placeholder="Share the background, memory, or cultural story behind this dish...">${esc(r?.story || '')}</textarea><span class="field-note">Displays as an editorial story box right above the ingredients checklist.</span></label>
    <label>Category<select name="category" id="recipe-category" required><option value="">Choose category</option>${categoryOptions
      .map(
        (c: any) =>
          `<option value="${esc(c.slug)}" ${r?.category === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`,
      )
      .join('')}</select></label>

    <div style="margin-top:12px;margin-bottom:12px;">
      <label style="font-weight:600;margin-bottom:6px;display:block">Sub categories (select all that apply)</label>
      <div id="recipe-subcategory-chips" style="display:flex;flex-wrap:wrap;gap:8px;">${subcategoryChipsHtml(
        r?.category || '',
        selectedSubcategories,
      )}</div>
    </div>

    <div style="margin-top:12px;margin-bottom:12px;">
      <label style="font-weight:600;margin-bottom:6px;display:block">Tags (select from list or add new)</label>
      <div id="recipe-tag-chips" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        ${allTagNames
          .map((tag: string) => {
            const isSelected = selectedTagSet.has(tag.toLowerCase());
            return `<button type="button" class="tag-chip ${isSelected ? 'tag-chip-selected' : ''}" data-tag="${esc(tag)}">${isSelected ? '✓ ' : '+ '}${esc(tag)}</button>`;
          })
          .join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" id="custom-tag-input" placeholder="Type custom tag and click Add..." style="flex:1;max-width:240px;font-size:13px;padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);"/>
        <button type="button" class="btn btn-outline" id="add-custom-tag-btn" style="padding:6px 12px;font-size:13px;">+ Add Tag</button>
      </div>
    </div>

    <fieldset id="recipe-diets" style="border:0;padding:0;margin:12px 0">
      <legend style="font-weight:600;margin-bottom:6px">Diet (select all that apply)</legend>
      <div style="display:flex;flex-wrap:wrap;gap:4px 18px">${dietNames
        .map(
          (d) =>
            `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0;font-weight:400"><input type="checkbox" name="diets" value="${esc(d)}" ${selectedDiets.includes(d) ? 'checked' : ''}/> ${esc(d)}</label>`,
        )
        .join('')}</div>
    </fieldset>
    <label>Recipe image<input name="image" id="recipe-image" value="${esc(
      r?.image || '/images/recipes/andhra-chicken-curry.png',
    )}"/></label>
    <label>Upload new recipe photo (JPG, PNG, WebP; max 4 MB)<input type="file" id="photo" accept="image/jpeg,image/png,image/webp"/></label>
    <button class="btn btn-light" type="button" id="upload-photo">Upload photo</button>
    <div class="field-note">Upload before saving the recipe. The photo is stored on the server; it only appears on a public page once the recipe is published.</div>

    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
      <label>Prep minutes<input type="number" min="0" name="prepTime" value="${esc(r?.prepTime ?? 15)}"/></label>
      <label>Cook minutes<input type="number" min="0" name="cookTime" value="${esc(r?.cookTime ?? 30)}"/></label>
      <label>Servings<input type="number" min="1" name="servings" value="${esc(r?.servings ?? 4)}"/></label>
      <label>Difficulty<select name="difficulty">${['Easy', 'Medium', 'Hard']
        .map((v) => `<option ${r?.difficulty === v ? 'selected' : ''}>${v}</option>`)
        .join('')}</select></label>
    </div>

    <!-- Nutrition Information (Optional) -->
    <div style="margin-top:14px;background:var(--cream);border:1px solid var(--line);border-radius:var(--radius-card);padding:14px 16px;">
      <div class="admin-builder-title" style="margin-bottom:4px">Nutrition Information (optional)</div>
      <div class="field-note" style="margin-bottom:10px">Optional nutrient values (Calories, Carbs, Protein, Fat, Fiber). Displays on recipe page and enhances Google Recipe badges.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px">
        <label style="font-size:12px">Calories (kcal)<input type="number" min="0" step="1" name="nutrition_calories" placeholder="e.g. 320" value="${esc(r?.nutrition?.calories ?? '')}"/></label>
        <label style="font-size:12px">Carbs (g)<input type="number" min="0" step="0.1" name="nutrition_carbs" placeholder="e.g. 24" value="${esc(r?.nutrition?.carbs ?? '')}"/></label>
        <label style="font-size:12px">Protein (g)<input type="number" min="0" step="0.1" name="nutrition_protein" placeholder="e.g. 28" value="${esc(r?.nutrition?.protein ?? '')}"/></label>
        <label style="font-size:12px">Fiber (g)<input type="number" min="0" step="0.1" name="nutrition_fiber" placeholder="e.g. 4" value="${esc(r?.nutrition?.fiber ?? '')}"/></label>
        <label style="font-size:12px">Fat (g)<input type="number" min="0" step="0.1" name="nutrition_fat" placeholder="e.g. 12" value="${esc(r?.nutrition?.fat ?? '')}"/></label>
      </div>
    </div>

    <!-- Structured Ingredients Section -->
    <div style="margin-top:12px">
      <div class="admin-builder-title">Ingredients by Section</div>
      <div class="field-note" style="margin-bottom:8px">Organize ingredients into sections (e.g. "For Tempering", "For Curry", "For Marination"). Each row has ingredient name, quantity, and unit. Quantity and unit are optional; type a quantity as 1/2, 1 1/2 or 0.5.</div>
      <div id="ingredient-sections" class="admin-section-container">
        ${ingredientSections.map((sec) => ingredientSectionHtml(sec)).join('')}
      </div>
      <div style="margin-top:10px">
        <button type="button" class="btn btn-outline" id="add-ing-section">+ Add Ingredient Section</button>
      </div>
    </div>

    <!-- Structured Instructions Section -->
    <div style="margin-top:16px">
      <div class="admin-builder-title">Instructions &amp; Step Sections</div>
      <div class="field-note" style="margin-bottom:8px">Organize recipe steps into titled sections (e.g. "Sauté Onions", "Tempering", "Cook Chicken").</div>
      <div id="step-sections" class="admin-section-container">
        ${stepsList.map((step: any) => stepSectionHtml(step)).join('')}
      </div>
      <div style="margin-top:10px">
        <button type="button" class="btn btn-outline" id="add-step-section">+ Add Instruction Section / Step</button>
      </div>
    </div>

    <label style="margin-top:12px">Cooking tips (one per line)<textarea name="tips" rows="3" placeholder="e.g. Adjust spice to taste.">${esc(r?.tips?.join('\n'))}</textarea></label>
    <label>Serve with (comma-separated)<input name="serveWith" placeholder="e.g. Steamed Rice, Roti, Sambar" value="${esc(r?.serveWith?.join(', '))}"/></label>
    <label>YouTube URL (optional)<input name="youtubeUrl" type="url" placeholder="https://youtube.com/watch?v=..." value="${esc(r?.youtubeUrl)}"/></label>
    <div class="field-note" style="margin-top:12px;">New recipes are saved as drafts. Tick Published on the recipe list to make one live. Use the Featured checkbox there to feature it.</div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
      <button class="btn" type="submit">${r ? 'Save changes' : 'Create recipe'}</button>
      ${r && !r.published ? previewLink(r.slug, 'Preview draft (last saved version)') : ''}
      ${r ? '<button class="btn btn-outline" type="button" id="delete-recipe">Delete recipe</button>' : ''}
    </div>
  </form>`;
}

function lines(s: string) {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function formData(f: HTMLFormElement, existing?: any) {
  const d = new FormData(f);
  const text = (k: string) => String(d.get(k) || '').trim();

  // Extract structured ingredients with section names
  const ingredients: { name: string; amount: number | null; unit: string; section?: string }[] = [];
  f.querySelectorAll<HTMLElement>('[data-ingredient-section]').forEach((secEl) => {
    const secTitle = (secEl.querySelector<HTMLInputElement>('.section-title-input')?.value || '').trim();
    secEl.querySelectorAll<HTMLElement>('.ingredient-row').forEach((rowEl) => {
      const name = (rowEl.querySelector<HTMLInputElement>('.ing-name')?.value || '').trim();
      const amountRaw = (rowEl.querySelector<HTMLInputElement>('.ing-amount')?.value || '').trim();
      const unit = (rowEl.querySelector<HTMLSelectElement>('.ing-unit')?.value || '').trim();
      if (name) {
        ingredients.push({
          name,
          amount: parseQty(amountRaw),
          unit,
          ...(secTitle ? { section: secTitle } : {}),
        });
      }
    });
  });

  // Extract structured step sections
  const steps: { title: string; text: string; image?: string }[] = [];
  f.querySelectorAll<HTMLElement>('[data-step-section]').forEach((stepEl) => {
    const title = (stepEl.querySelector<HTMLInputElement>('.step-title-input')?.value || '').trim();
    const text = (stepEl.querySelector<HTMLTextAreaElement>('.step-text-input')?.value || '').trim();
    const image = (stepEl.querySelector<HTMLInputElement>('.step-image-input')?.value || '').trim();
    if (title || text) {
      steps.push({
        title: title || 'Step',
        text,
        ...(image ? { image } : {}),
      });
    }
  });

  // Extract optional nutrition details
  const numOrNull = (k: string) => {
    const val = text(k);
    return val !== '' && !isNaN(Number(val)) ? Number(val) : undefined;
  };

  const nutritionRaw = {
    calories: numOrNull('nutrition_calories'),
    carbs: numOrNull('nutrition_carbs'),
    protein: numOrNull('nutrition_protein'),
    fat: numOrNull('nutrition_fat'),
    fiber: numOrNull('nutrition_fiber'),
  };

  const nutrition = Object.values(nutritionRaw).some((v) => v !== undefined)
    ? Object.fromEntries(Object.entries(nutritionRaw).filter(([_, v]) => v !== undefined))
    : undefined;

  return {
    title: text('title'),
    slug: text('slug'),
    description: text('description'),
    category: text('category'),
    subcategories: Array.from(f.querySelectorAll<HTMLElement>('#recipe-subcategory-chips .tag-chip-selected'))
      .map((chip) => chip.getAttribute('data-subcategory') || '')
      .filter(Boolean),
    tags: Array.from(f.querySelectorAll<HTMLElement>('#recipe-tag-chips .tag-chip-selected'))
      .map((chip) => chip.getAttribute('data-tag')?.trim() || '')
      .filter(Boolean),
    story: text('story') || undefined,
    diets: Array.from(f.querySelectorAll<HTMLInputElement>('#recipe-diets input:checked')).map((i) => i.value),
    prepTime: Number(text('prepTime')),
    cookTime: Number(text('cookTime')),
    servings: Number(text('servings')),
    difficulty: text('difficulty'),
    image: text('image'),
    // Published/Featured are changed from the recipe list; keep the current values when editing.
    published: existing ? !!existing.published : false,
    featured: existing ? !!existing.featured : false,
    ingredients,
    steps,
    ...(nutrition ? { nutrition } : {}),
    tips: lines(text('tips')),
    serveWith: text('serveWith')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    youtubeUrl: text('youtubeUrl'),
  };
}

function wireRecipeForm(r: any) {
  const form = el('recipe-form') as HTMLFormElement;

  // Title to Slug auto-generation for new recipes
  const titleInput = el('recipe-title') as HTMLInputElement;
  const slugInput = el('recipe-slug') as HTMLInputElement;
  if (titleInput && slugInput && !r) {
    let userModifiedSlug = Boolean(slugInput.value.trim());
    slugInput.addEventListener('input', () => {
      userModifiedSlug = slugInput.value.trim().length > 0;
    });
    titleInput.addEventListener('input', () => {
      if (!userModifiedSlug) {
        slugInput.value = titleInput.value
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      }
    });
  }

  // Multi-select Sub category chips interaction
  const subcategoryChips = el('recipe-subcategory-chips');
  subcategoryChips.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.tag-chip');
    if (!chip) return;
    const on = !chip.classList.contains('tag-chip-selected');
    chip.classList.toggle('tag-chip-selected', on);
    chip.setAttribute('aria-pressed', String(on));
    chip.textContent = (on ? '✓ ' : '+ ') + (chip.getAttribute('data-label') || '');
  });
  // Changing the category swaps the chips to that category's sub categories.
  const categorySelect = el('recipe-category') as HTMLSelectElement;
  categorySelect.addEventListener('change', () => {
    const selected = new Set(
      Array.from(subcategoryChips.querySelectorAll<HTMLElement>('.tag-chip-selected')).map(
        (chip) => chip.getAttribute('data-subcategory') || '',
      ),
    );
    subcategoryChips.innerHTML = subcategoryChipsHtml(categorySelect.value, selected);
  });

  // Multi-select Tag Chips interaction
  const tagChipsContainer = el('recipe-tag-chips');
  if (tagChipsContainer) {
    tagChipsContainer.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.tag-chip');
      if (!chip) return;
      const tagName = chip.getAttribute('data-tag') || '';
      const isSelected = chip.classList.contains('tag-chip-selected');
      if (isSelected) {
        chip.classList.remove('tag-chip-selected');
        chip.textContent = '+ ' + tagName;
      } else {
        chip.classList.add('tag-chip-selected');
        chip.textContent = '✓ ' + tagName;
      }
    });
  }

  // Add Custom Tag button
  const customTagInput = el('custom-tag-input') as HTMLInputElement;
  const addCustomTagBtn = el('add-custom-tag-btn');
  if (customTagInput && addCustomTagBtn && tagChipsContainer) {
    const addCustomTag = () => {
      const val = customTagInput.value.trim();
      if (!val) return;
      const existing = tagChipsContainer.querySelector<HTMLButtonElement>(`[data-tag="${val}"]`);
      if (existing) {
        if (!existing.classList.contains('tag-chip-selected')) {
          existing.classList.add('tag-chip-selected');
          existing.textContent = '✓ ' + val;
        }
      } else {
        const newChip = document.createElement('button');
        newChip.type = 'button';
        newChip.className = 'tag-chip tag-chip-selected';
        newChip.setAttribute('data-tag', val);
        newChip.textContent = '✓ ' + val;
        tagChipsContainer.appendChild(newChip);
      }
      customTagInput.value = '';
    };

    addCustomTagBtn.onclick = addCustomTag;
    customTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomTag();
      }
    });
  }

  // Add Ingredient Section button
  const addIngSecBtn = el('add-ing-section');
  if (addIngSecBtn) {
    addIngSecBtn.onclick = () => {
      const container = el('ingredient-sections');
      container.insertAdjacentHTML('beforeend', ingredientSectionHtml());
    };
  }

  // Add Step Section button
  const addStepSecBtn = el('add-step-section');
  if (addStepSecBtn) {
    addStepSecBtn.onclick = () => {
      const container = el('step-sections');
      container.insertAdjacentHTML('beforeend', stepSectionHtml());
    };
  }

  // Event delegation for dynamic ingredient rows and section removals
  form.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Move an ingredient, ingredient section or instruction section up or down
    const moveBtn = target.closest<HTMLElement>('.move-up, .move-down');
    if (moveBtn) {
      const item = moveBtn.closest<HTMLElement>('.ingredient-row, [data-ingredient-section], [data-step-section]');
      const up = moveBtn.classList.contains('move-up');
      const neighbour = up ? item?.previousElementSibling : item?.nextElementSibling;
      if (item && neighbour) {
        if (up) neighbour.before(item);
        else neighbour.after(item);
        moveBtn.focus();
      }
    }

    // Turn every instruction line into a bullet point or a numbered step
    const formatBtn = target.closest<HTMLElement>('.step-format');
    if (formatBtn) {
      const area = formatBtn.closest('[data-step-section]')?.querySelector<HTMLTextAreaElement>('.step-text-input');
      if (area) {
        area.value = applyListFormat(area.value, formatBtn.dataset.format === 'ol' ? 'ol' : 'ul');
        area.focus();
      }
    }

    // Add row to an ingredient section
    if (target.classList.contains('add-ing-row')) {
      const secBox = target.closest<HTMLElement>('[data-ingredient-section]');
      const rowsBox = secBox?.querySelector<HTMLElement>('.ingredient-rows');
      if (rowsBox) {
        rowsBox.insertAdjacentHTML('beforeend', ingredientRowHtml());
      }
    }

    // Remove single ingredient row
    if (target.classList.contains('remove-ing-row')) {
      const row = target.closest<HTMLElement>('.ingredient-row');
      const rowsBox = row?.parentElement;
      if (rowsBox && rowsBox.querySelectorAll('.ingredient-row').length > 1) {
        row?.remove();
      } else if (row) {
        // Clear fields instead of removing the last remaining row
        row.querySelectorAll('input').forEach((inp) => (inp.value = ''));
        const sel = row.querySelector('select');
        if (sel) sel.value = '';
      }
    }

    // Remove whole ingredient section
    if (target.classList.contains('remove-section')) {
      const secBox = target.closest<HTMLElement>('[data-ingredient-section]');
      const container = el('ingredient-sections');
      if (container && container.querySelectorAll('[data-ingredient-section]').length > 1) {
        secBox?.remove();
      } else if (secBox) {
        const titleInput = secBox.querySelector<HTMLInputElement>('.section-title-input');
        if (titleInput) titleInput.value = '';
      }
    }

    // Remove step box
    if (target.classList.contains('remove-step-box')) {
      const stepBox = target.closest<HTMLElement>('[data-step-section]');
      const container = el('step-sections');
      if (container && container.querySelectorAll('[data-step-section]').length > 1) {
        stepBox?.remove();
      } else if (stepBox) {
        stepBox.querySelectorAll('input, textarea').forEach((inp: any) => (inp.value = ''));
        const previewBox = stepBox.querySelector<HTMLElement>('.step-image-preview');
        if (previewBox) previewBox.style.display = 'none';
        const clearBtn = stepBox.querySelector<HTMLElement>('.clear-step-image');
        if (clearBtn) clearBtn.style.display = 'none';
      }
    }

    // Clear step image
    if (target.classList.contains('clear-step-image')) {
      const stepBox = target.closest<HTMLElement>('[data-step-section]');
      if (stepBox) {
        const imgInput = stepBox.querySelector<HTMLInputElement>('.step-image-input');
        if (imgInput) imgInput.value = '';
        const previewBox = stepBox.querySelector<HTMLElement>('.step-image-preview');
        if (previewBox) previewBox.style.display = 'none';
        target.style.display = 'none';
      }
    }
  });

  // Step photo upload handler
  form.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('step-upload-file')) {
      const file = target.files?.[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        notice('Step photo must be smaller than 4 MB.', true);
        return;
      }
      try {
        notice('Uploading step photo...');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await api('image', 'POST', { name: 'step-' + file.name, type: file.type, content: data });
        const stepBox = target.closest<HTMLElement>('[data-step-section]');
        if (stepBox) {
          const imgInput = stepBox.querySelector<HTMLInputElement>('.step-image-input');
          if (imgInput) imgInput.value = result.path;
          const previewBox = stepBox.querySelector<HTMLElement>('.step-image-preview');
          const previewImg = previewBox?.querySelector<HTMLImageElement>('img');
          if (previewBox && previewImg) {
            previewImg.src = result.path;
            previewBox.style.display = 'block';
          }
          const clearBtn = stepBox.querySelector<HTMLElement>('.clear-step-image');
          if (clearBtn) clearBtn.style.display = 'inline-block';
        }
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        notice(isLocal ? 'Step photo saved locally. Save the recipe next.' : 'Step photo uploaded. Save the recipe next.');
      } catch (err) {
        notice(String(err), true);
      }
    }
  });

  // Step image URL manual input handler
  form.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('step-image-input')) {
      const stepBox = target.closest<HTMLElement>('[data-step-section]');
      if (stepBox) {
        const val = target.value.trim();
        const previewBox = stepBox.querySelector<HTMLElement>('.step-image-preview');
        const previewImg = previewBox?.querySelector<HTMLImageElement>('img');
        const clearBtn = stepBox.querySelector<HTMLElement>('.clear-step-image');
        if (val && previewBox && previewImg) {
          previewImg.src = val;
          previewBox.style.display = 'block';
          if (clearBtn) clearBtn.style.display = 'inline-block';
        } else if (previewBox) {
          previewBox.style.display = 'none';
          if (clearBtn) clearBtn.style.display = 'none';
        }
      }
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const value = formData(form, r);
    if (!value.category) {
      notice('Choose a category first.', true);
      return;
    }
    if (!value.diets.length) {
      notice('Choose at least one diet.', true);
      return;
    }
    if (!value.ingredients.length) {
      notice('Please add at least one ingredient.', true);
      return;
    }
    if (!value.steps.length) {
      notice('Please add at least one instruction step.', true);
      return;
    }
    const slug = (value.slug || value.title)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    value.slug = slug;
    if (!slug) {
      notice('Use an English-letter slug for the recipe URL.', true);
      return;
    }
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    try {
      notice(isLocal ? 'Saving recipe locally...' : 'Saving recipe...');
      await api('recipes/' + slug, 'POST', { recipe: value, sha: r?._sha });
      editing = null;
      await load();
      if (isLocal) {
        notice(
          value.published
            ? `Recipe published locally! View live at /recipes/${slug}/`
            : `Recipe saved as draft locally (hidden from public listings).`,
        );
      } else {
        notice(
          value.published
            ? `Saved and published. The page is live at /recipes/${slug}/`
            : 'Draft saved. It is not visible on the public site.',
        );
      }
    } catch (e) {
      notice(String(e), true);
    }
  };

  el('upload-photo').onclick = async () => {
    const file = (el('photo') as HTMLInputElement).files?.[0];
    if (!file) {
      notice('Choose a photo first.', true);
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      notice('Photo must be smaller than 4 MB.', true);
      return;
    }
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    try {
      notice('Uploading photo...');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await api('image', 'POST', { name: file.name, type: file.type, content: data });
      (el('recipe-image') as HTMLInputElement).value = result.path;
      notice(isLocal ? 'Photo saved locally to public/images/recipes/. Save the recipe next.' : 'Photo uploaded. Save the recipe next.');
    } catch (e) {
      notice(String(e), true);
    }
  };

  if (r) {
    const delBtn = el('delete-recipe');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!confirm(`Delete ${r.title}? This cannot be undone.`)) return;
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        try {
          await api('recipes/' + r.slug, 'DELETE', { sha: r._sha });
          editing = null;
          await load();
          notice(isLocal ? 'Recipe removed locally.' : 'Recipe removed and its public page deleted.');
        } catch (e) {
          notice(String(e), true);
        }
      };
    }
  }
}

function renderConfig() {
  const entry = cache[tab],
    list = entry?.data || [];
  const isTags = tab === 'tags';
  // Rows with an order are shown in that order; the arrows then move a row and the new position is saved.
  if (!isTags) list.sort((a: Item, b: Item) => Number(a.order ?? 0) - Number(b.order ?? 0));
  const columns =
    tab === 'categories'
      ? ['name', 'slug', 'description', 'image', 'order', 'subcategories']
      : tab === 'subcategories' || tab === 'diets'
        ? ['name', 'slug', 'order']
        : tab === 'menu'
          ? ['label', 'href', 'order', 'visible']
          : ['tag'];
  const tabLabel = tab === 'subcategories' ? 'sub categories' : tab;
  content.innerHTML = `<h2>Manage ${esc(tabLabel)}</h2><p class="field-note">${
    tab === 'categories'
      ? 'Category image/icon path or upload. Slugs become URLs (e.g. /category/breakfast/). Tick the sub categories each category offers; recipes in that category choose from them.'
      : tab === 'subcategories'
        ? 'Create the shared list of sub categories here, then map them to categories on the Categories tab. Leave the slug empty to create it from the name.'
        : tab === 'diets'
          ? 'The diets a recipe can have, such as Vegetarian, Non-Vegetarian or Vegan. Each diet gets a page at /category/vegan/ (using its slug); add it to the Navigation Menu to link to it. Renaming a diet renames it on its recipes, and a diet that recipes still use cannot be removed.'
          : tab === 'menu'
          ? 'Menu href values must start with /, for example /category/curries/.'
          : 'Enter one tag per line.'
  }</p><form id="config-form" class="admin-form">${
    isTags
      ? `<label>Tags (one per line)<textarea name="tags" rows="12">${esc(list.join('\n'))}</textarea></label>`
      : `<div style="overflow-x:auto"><table class="admin-table"><thead><tr>${columns
          .map((x) => `<th>${esc(x)}</th>`)
          .join('')}<th></th></tr></thead><tbody id="config-rows">${list
          .map((row: any) => configRow(row, columns))
          .join('')}</tbody></table></div><div>${actionButton('Add row', 'add-row')}</div>`
  }<button type="submit" class="btn">Save ${esc(tabLabel)}</button></form>`;
  content.querySelectorAll('[data-action="add-row"]').forEach((b) =>
    b.addEventListener('click', () => {
      el('config-rows').insertAdjacentHTML('beforeend', configRow({}, columns));
      wireRemove();
      wireCategoryUploads();
    }),
  );
  wireRemove();
  wireCategoryUploads();
  wireSlugAutofill();
  wireRowMoves();
  (el('config-form') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const form = el('config-form') as HTMLFormElement;
    const data = isTags
      ? lines((form.elements.namedItem('tags') as HTMLTextAreaElement).value)
      : [...form.querySelectorAll<HTMLTableRowElement>('#config-rows tr')].map((tr, index) => {
          const o: Item = {};
          if (columns.includes('order')) o.order = index + 1;
          tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-key], select[data-key]').forEach((field) => {
            const k = field.dataset.key!;
            o[k] =
              field instanceof HTMLInputElement && field.type === 'checkbox'
                ? field.checked
                : field.type === 'number'
                  ? Number(field.value)
                  : field.value.trim();
          });
          if (tr.querySelector('.cat-subs')) {
            o.subcategories = [...tr.querySelectorAll<HTMLInputElement>('.cat-subs input:checked')].map(
              (i) => i.dataset.sub || '',
            );
          }
          return o;
        });
    try {
      notice('Saving...');
      await api(tab, 'POST', { sha: entry.sha, data });
      await load();
      notice('Saved and published. The public site is updated.');
    } catch (e) {
      notice(String(e), true);
    }
  };
}

function configRow(row: Item, columns: string[]) {
  return `<tr>${columns
    .map((k) => {
      if (k === 'visible') {
        return `<td><input data-key="visible" type="checkbox" ${row[k] !== false ? 'checked' : ''} aria-label="visible" /></td>`;
      }
      if (k === 'order') {
        return `<td style="white-space:nowrap"><button type="button" class="btn-icon-remove move-up" title="Move up" aria-label="Move row up">↑</button> <button type="button" class="btn-icon-remove move-down" title="Move down" aria-label="Move row down">↓</button></td>`;
      }
      if (k === 'subcategories') {
        const chosen: string[] = Array.isArray(row.subcategories) ? row.subcategories : [];
        const subs: { slug: string; name: string }[] = cache.subcategories?.data || [];
        return `<td><div class="cat-subs" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:4px 14px;min-width:260px">${
          subs.length
            ? subs
                .map(
                  (s) =>
                    `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0;white-space:nowrap;font-weight:400"><input type="checkbox" data-sub="${esc(s.slug)}" ${chosen.includes(s.slug) ? 'checked' : ''}/> ${esc(s.name)}</label>`,
                )
                .join('')
            : '<span class="field-note">Create sub categories first.</span>'
        }</div></td>`;
      }
      if (k === 'image') {
        return `<td><div style="display:flex;align-items:center;gap:6px">
          <input data-key="image" value="${esc(row.image || row.emoji || '')}" placeholder="/images/categories/..." aria-label="image" style="max-width:160px"/>
          <label class="btn btn-outline" style="padding:4px 8px;font-size:12px;cursor:pointer;white-space:nowrap;margin:0" title="Upload category icon/image">
            Upload
            <input type="file" class="cat-upload-file" accept="image/jpeg,image/png,image/webp" style="display:none"/>
          </label>
        </div></td>`;
      }
      // The name column keeps a readable width however wide the sub categories column gets.
      const width = k === 'name' ? 'min-width:200px;max-width:260px' : `max-width:${k === 'description' ? 220 : 140}px`;
      // A new row's slug follows its name until the slug is typed by hand; saved slugs are never rewritten.
      const auto = k === 'slug' && !row.slug ? ' data-auto="1" placeholder="from name"' : '';
      return `<td><input data-key="${k}" value="${esc(row[k] ?? '')}" aria-label="${k}" style="${width}"${auto}/></td>`;
    })
    .join('')}<td><button type="button" class="remove-row">Remove</button></td></tr>`;
}

// Typing a name fills the slug of a new row (categories, sub categories, diets).
function wireSlugAutofill() {
  document.getElementById('config-rows')?.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const slugInput = input.closest('tr')?.querySelector<HTMLInputElement>('input[data-key="slug"]');
    if (!slugInput) return;
    if (input === slugInput) {
      slugInput.dataset.auto = slugInput.value.trim() ? '0' : '1';
    } else if (input.dataset.key === 'name' && slugInput.dataset.auto === '1') {
      slugInput.value = makeSlug(input.value);
    }
  });
}

// The ↑/↓ arrows move a row of the config table; the saved order follows the row positions.
function wireRowMoves() {
  document.getElementById('config-rows')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.move-up, .move-down');
    const tr = btn?.closest('tr');
    if (!btn || !tr) return;
    if (btn.classList.contains('move-up')) {
      if (tr.previousElementSibling) tr.parentElement!.insertBefore(tr, tr.previousElementSibling);
    } else if (tr.nextElementSibling) {
      tr.parentElement!.insertBefore(tr.nextElementSibling, tr);
    }
    btn.focus();
  });
}

function wireRemove() {
  content.querySelectorAll<HTMLButtonElement>('.remove-row').forEach((b) => (b.onclick = () => b.closest('tr')?.remove()));
}

function wireCategoryUploads() {
  content.querySelectorAll<HTMLInputElement>('.cat-upload-file').forEach((input) => {
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        notice('Image must be smaller than 4 MB.', true);
        return;
      }
      try {
        notice('Uploading category icon...');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await api('image', 'POST', { name: 'cat-' + file.name, type: file.type, content: data });
        const textInput = input.closest('tr')?.querySelector<HTMLInputElement>('input[data-key="image"]');
        if (textInput) textInput.value = result.path;
        notice('Category icon uploaded. Click Save to publish.');
      } catch (err) {
        notice(String(err), true);
      }
    };
  });
}

function wireActions() {
  content.querySelectorAll<HTMLElement>('[data-action="new"]').forEach(
    (b) =>
      (b.onclick = async () => {
        editing = editing ? 'null' : '__new__';
        if (editing === 'null') editing = null;
        if (!cache.categories) {
          try {
            cache.categories = await api('categories');
          } catch {}
        }
        render();
      }),
  );
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  button.onclick = async () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('selected'));
    button.classList.add('selected');
    tab = button.dataset.tab!;
    editing = null;
    if (tab === 'recipes' && !cache.categories) {
      try {
        cache.categories = await api('categories');
      } catch {}
    }
    await load();
  };
}

function renderLoginForm() {
  content.classList.remove('hidden');
  content.innerHTML = `
    <div style="max-width:420px;margin:24px auto;padding:28px 24px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:0 2px 12px rgba(0,0,0,0.04);">
      <div style="text-align:center;margin-bottom:20px;">
        <h2 style="font-family:var(--font-sans);font-size:1.4rem;margin:0 0 6px;color:var(--primary);">Admin Login</h2>
        <p class="muted" style="font-size:13px;margin:0;">Enter your JyoCanCook administrator credentials</p>
      </div>
      <form id="admin-login-form" style="display:flex;flex-direction:column;gap:14px;">
        <label style="font-size:13px;font-weight:600;display:flex;flex-direction:column;gap:6px;">
          Username or Email
          <input type="text" id="login-username" required placeholder="jyocancook-admin" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:14px;"/>
        </label>
        <label style="font-size:13px;font-weight:600;display:flex;flex-direction:column;gap:6px;">
          Password
          <input type="password" id="login-password" required placeholder="••••••••" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:14px;"/>
        </label>
        <button class="btn" type="submit" style="margin-top:8px;padding:10px;font-size:14px;font-weight:600;">Sign In →</button>
      </form>
    </div>
  `;

  const loginForm = document.getElementById('admin-login-form') as HTMLFormElement;
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const username = (document.getElementById('login-username') as HTMLInputElement)?.value.trim();
      const password = (document.getElementById('login-password') as HTMLInputElement)?.value;
      if (!username || !password) {
        notice('Please enter username and password', true);
        return;
      }
      try {
        notice('Signing in...');
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw Error(data.error || 'Invalid credentials');
        }
        if (data.csrf_token) csrfToken = data.csrf_token;
        const userEl = document.getElementById('admin-user-info');
        if (userEl && data.user) {
          userEl.textContent = `Logged in as @${data.user.login || data.user.name}`;
        }
        await load();
      } catch (err: any) {
        notice(String(err?.message || err), true);
      }
    };
  }
}

// Logout is a state-changing request: send it as POST with the CSRF token (not a plain link).
const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: '{}',
      });
    } finally {
      location.href = '/admin/';
    }
  });
}

// Rebuild All Static Pages button handler
const rebuildBtn = document.getElementById('btn-rebuild-site');
if (rebuildBtn) {
  rebuildBtn.onclick = async () => {
    if (!confirm('Rebuild and publish all static pages and search indexes now?')) return;
    try {
      notice('Regenerating all static HTML pages...');
      const res = await api('publish', 'POST', {});
      const count = res.stats?.pages_generated ?? '';
      notice(`Successfully regenerated ${count} static pages! Site is up to date.`);
    } catch (e: any) {
      notice('Generation error: ' + String(e?.message || e), true);
    }
  };
}

(async () => {
  try {
    const status = await api('status');
    if (status.csrf_token) csrfToken = status.csrf_token;
    const userEl = document.getElementById('admin-user-info');
    if (userEl && status.user) {
      userEl.textContent = `Logged in as @${status.user.login || status.user.id}`;
    }
    cache.categories = await api('categories');
    await load();
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('401') || msg.includes('Login required') || msg.includes('Authentication required')) {
      notice('Please log in with your administrator password.');
      renderLoginForm();
      return;
    }
    notice('Admin access is not ready: ' + msg, true);
  }
})();
