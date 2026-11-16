type Item = Record<string, any>;
const el = (id: string) => document.getElementById(id)!;
const content = el('admin-content'),
  message = el('admin-message');
let tab = 'recipes',
  cache: Record<string, any> = {},
  editing: string | null = null;

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
  { value: 'tsp', label: 'tsp' },
  { value: 'tbsp', label: 'tbsp' },
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
      headers: { 'content-type': 'application/json' },
      ...(method !== 'GET' ? { body: JSON.stringify(data) } : {}),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (res.status === 404) {
        throw Error(
          'Admin API endpoint (/api/admin/' +
            path +
            ') is not available in static mode without Cloudflare Worker.',
        );
      }
      throw Error(`Unexpected response (${res.status} ${res.statusText})`);
    }
    const body = await res.json();
    if (!res.ok) throw Error(body.error || 'Unable to save');
    return body;
  } catch (err: any) {
    throw Error(err?.message || String(err));
  }
}

async function load() {
  notice('Loading ' + tab + '...');
  try {
    if (tab === 'recipes') {
      cache.recipes = (await api('recipes')).data;
    } else {
      cache[tab] = await api(tab);
    }
    render();
    notice('Ready. Changes publish through GitHub and your Cloudflare deployment pipeline.');
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

function renderRecipes() {
  const recipes = cache.recipes || [];
  const current = editing ? recipes.find((r: any) => r.slug === editing) : undefined;
  content.innerHTML = `<div class="section-heading"><h2>Recipes</h2>${actionButton(
    current ? 'Back to list' : 'Add recipe',
    'new',
  )}</div>${
    current || editing === '__new__'
      ? recipeForm(current)
      : `<table class="admin-table"><thead><tr><th>Recipe</th><th>Category</th><th>Status</th><th></th></tr></thead><tbody>${recipes
          .map(
            (r: any) =>
              `<tr><td>${esc(r.title)}</td><td>${esc(r.category)}</td><td>${
                r.published ? 'Published' : 'Draft'
              }</td><td><button type="button" data-edit="${esc(r.slug)}">Edit</button></td></tr>`,
          )
          .join('')}</tbody></table>`
  }`;
  wireActions();
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
  const amountStr = item.amount !== null && item.amount !== undefined && item.amount !== '' ? String(item.amount) : '';
  return `<div class="ingredient-row">
    <input type="text" class="ing-name" placeholder="Ingredient name (e.g. Mustard seeds)" value="${esc(item.name || '')}" required />
    <input type="number" step="any" min="0" class="ing-amount" placeholder="Qty" value="${esc(amountStr)}" />
    <select class="ing-unit">
      ${unitOptionsHtml(item.unit || '')}
    </select>
    <button type="button" class="btn-icon-remove remove-ing-row" title="Remove ingredient">✕</button>
  </div>`;
}

function ingredientSectionHtml(sec: { title?: string; items?: any[] } = {}) {
  const items = sec.items && sec.items.length ? sec.items : [{}];
  return `<div class="admin-section-box ingredient-section" data-ingredient-section>
    <div class="admin-section-head">
      <input type="text" class="section-title-input" placeholder="Section name (e.g. For Tempering, For Curry, Main Ingredients)" value="${esc(sec.title || '')}" />
      <button type="button" class="btn-icon-danger remove-section" title="Remove section">✕</button>
    </div>
    <div class="ingredient-rows">
      ${items.map((i) => ingredientRowHtml(i)).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-light add-ing-row">+ Add Ingredient</button>
  </div>`;
}

function stepSectionHtml(step: { title?: string; text?: string } = {}) {
  return `<div class="step-section-box" data-step-section>
    <div class="step-section-head">
      <input type="text" class="step-title-input" placeholder="Step / Section Title (e.g. Sauté Onions, Tempering, Simmer)" value="${esc(step.title || '')}" required />
      <button type="button" class="btn-icon-danger remove-step-box" title="Remove step">✕</button>
    </div>
    <textarea class="step-text-input" rows="3" placeholder="Detailed instructions for this step..." required>${esc(step.text || '')}</textarea>
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

function recipeForm(r: any) {
  const categories = cache.categories?.data || [];
  const categoryOptions = categories.length ? categories : [];
  const ingredientSections = groupIngredientsBySection(r?.ingredients);
  const stepsList = r?.steps && r.steps.length ? r.steps : [{ title: '', text: '' }];

  return `<form class="admin-form" id="recipe-form">
    <label>Recipe title<input name="title" required maxlength="140" value="${esc(r?.title)}" placeholder="e.g. Andhra Chicken Curry"/></label>
    <label>Slug (URL, fixed after first save)<input name="slug" ${
      r ? 'readonly' : ''
    } placeholder="andhra-chicken-curry" value="${esc(r?.slug)}"/></label>
    <label>Description<textarea name="description" placeholder="A short, inviting description of this dish">${esc(r?.description)}</textarea></label>
    <label>Category<select name="category" id="recipe-category" required><option value="">Choose category</option>${categoryOptions
      .map(
        (c: any) =>
          `<option value="${esc(c.slug)}" ${r?.category === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`,
      )
      .join('')}</select></label>
    <label>Tags (comma-separated)<input name="tags" placeholder="e.g. Andhra, Spicy, Dinner, Chicken" value="${esc(r?.tags?.join(', '))}"/></label>
    <label>Diet<select name="diet"><option ${
      r?.diet === 'Vegetarian' ? 'selected' : ''
    }>Vegetarian</option><option ${
      r?.diet === 'Non-Vegetarian' ? 'selected' : ''
    }>Non-Vegetarian</option></select></label>
    <label>Recipe image<input name="image" id="recipe-image" value="${esc(
      r?.image || '/images/recipes/andhra-chicken-curry.png',
    )}"/></label>
    <label>Upload new recipe photo (JPG, PNG, WebP; max 4 MB)<input type="file" id="photo" accept="image/jpeg,image/png,image/webp"/></label>
    <button class="btn btn-light" type="button" id="upload-photo">Upload photo to GitHub</button>
    <div class="field-note">Upload before saving the recipe. An uploaded photo becomes public after deployment.</div>

    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
      <label>Prep minutes<input type="number" min="0" name="prepTime" value="${esc(r?.prepTime ?? 15)}"/></label>
      <label>Cook minutes<input type="number" min="0" name="cookTime" value="${esc(r?.cookTime ?? 30)}"/></label>
      <label>Servings<input type="number" min="1" name="servings" value="${esc(r?.servings ?? 4)}"/></label>
      <label>Difficulty<select name="difficulty">${['Easy', 'Medium', 'Hard']
        .map((v) => `<option ${r?.difficulty === v ? 'selected' : ''}>${v}</option>`)
        .join('')}</select></label>
    </div>

    <!-- Structured Ingredients Section -->
    <div style="margin-top:12px">
      <div class="admin-builder-title">Ingredients by Section</div>
      <div class="field-note" style="margin-bottom:8px">Organize ingredients into sections (e.g. "For Tempering", "For Curry", "For Marination"). Each row has ingredient name, quantity, and unit.</div>
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
    <label><input type="checkbox" name="featured" ${r?.featured ? 'checked' : ''}/> Feature on homepage</label>
    <label><input type="checkbox" name="published" ${r?.published !== false ? 'checked' : ''}/> Publish now (uncheck to save draft)</label>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
      <button class="btn" type="submit">${r ? 'Save changes' : 'Create recipe'}</button>
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

function formData(f: HTMLFormElement) {
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
          amount: amountRaw !== '' && !isNaN(Number(amountRaw)) ? Number(amountRaw) : null,
          unit,
          ...(secTitle ? { section: secTitle } : {}),
        });
      }
    });
  });

  // Extract structured step sections
  const steps: { title: string; text: string }[] = [];
  f.querySelectorAll<HTMLElement>('[data-step-section]').forEach((stepEl) => {
    const title = (stepEl.querySelector<HTMLInputElement>('.step-title-input')?.value || '').trim();
    const text = (stepEl.querySelector<HTMLTextAreaElement>('.step-text-input')?.value || '').trim();
    if (title || text) {
      steps.push({
        title: title || 'Step',
        text,
      });
    }
  });

  return {
    title: text('title'),
    slug: text('slug'),
    description: text('description'),
    category: text('category'),
    tags: text('tags')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    diet: text('diet'),
    prepTime: Number(text('prepTime')),
    cookTime: Number(text('cookTime')),
    servings: Number(text('servings')),
    difficulty: text('difficulty'),
    image: text('image'),
    published: d.has('published'),
    featured: d.has('featured'),
    ingredients,
    steps,
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
      }
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const value = formData(form);
    if (!value.category) {
      notice('Choose a category first.', true);
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
    try {
      notice('Saving recipe to GitHub...');
      await api('recipes/' + slug, 'POST', { recipe: value, sha: r?._sha });
      editing = null;
      await load();
      notice('Saved to GitHub. The public website will update after the next successful deployment.');
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
      notice('Photo uploaded to GitHub. Save the recipe next.');
    } catch (e) {
      notice(String(e), true);
    }
  };

  if (r) {
    const delBtn = el('delete-recipe');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!confirm(`Delete ${r.title}? This cannot be undone.`)) return;
        try {
          await api('recipes/' + r.slug, 'DELETE', { sha: r._sha });
          editing = null;
          await load();
          notice('Recipe removed from GitHub. A rebuild will update the website.');
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
  const columns =
    tab === 'categories'
      ? ['name', 'slug', 'description', 'image', 'order']
      : tab === 'menu'
        ? ['label', 'href', 'order', 'visible']
        : ['tag'];
  content.innerHTML = `<h2>Manage ${esc(tab)}</h2><p class="field-note">${
    tab === 'categories'
      ? 'Category image/icon path or upload. Slugs become URLs (e.g. /category/breakfast/).'
      : tab === 'menu'
        ? 'Menu href values must start with /, for example /category/curries/.'
        : 'Enter one tag per line.'
  }</p><form id="config-form" class="admin-form">${
    isTags
      ? `<label>Tags (one per line)<textarea name="tags" rows="12">${esc(list.join('\n'))}</textarea></label>`
      : `<table class="admin-table"><thead><tr>${columns
          .map((x) => `<th>${esc(x)}</th>`)
          .join('')}<th></th></tr></thead><tbody id="config-rows">${list
          .map((row: any) => configRow(row, columns))
          .join('')}</tbody></table><div>${actionButton('Add row', 'add-row')}</div>`
  }<button type="submit" class="btn">Save ${esc(tab)}</button></form>`;
  content.querySelectorAll('[data-action="add-row"]').forEach((b) =>
    b.addEventListener('click', () => {
      el('config-rows').insertAdjacentHTML('beforeend', configRow({}, columns));
      wireRemove();
      wireCategoryUploads();
    }),
  );
  wireRemove();
  wireCategoryUploads();
  (el('config-form') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const form = el('config-form') as HTMLFormElement;
    const data = isTags
      ? lines((form.elements.namedItem('tags') as HTMLTextAreaElement).value)
      : [...form.querySelectorAll<HTMLTableRowElement>('#config-rows tr')].map((tr) => {
          const o: Item = {};
          tr.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((field) => {
            const k = field.dataset.key!;
            o[k] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value.trim();
          });
          return o;
        });
    try {
      notice('Saving...');
      await api(tab, 'POST', { sha: entry.sha, data });
      await load();
      notice('Saved successfully. Cloudflare will deploy the updated site.');
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
        return `<td><input data-key="order" type="number" value="${esc(row[k] ?? 0)}" aria-label="order" style="max-width:80px" /></td>`;
      }
      if (k === 'image') {
        return `<td><div style="display:flex;align-items:center;gap:6px">
          <input data-key="image" value="${esc(row.image || row.emoji || '')}" placeholder="/images/categories/..." aria-label="image" style="max-width:160px"/>
          <label class="btn btn-outline" style="padding:4px 8px;font-size:12px;cursor:pointer;white-space:nowrap;margin:0" title="Upload category icon/image">
            Upload
            <input type="file" class="cat-upload-file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style="display:none"/>
          </label>
        </div></td>`;
      }
      return `<td><input data-key="${k}" value="${esc(row[k] ?? '')}" aria-label="${k}" style="max-width:${k === 'description' ? 220 : 140}px"/></td>`;
    })
    .join('')}<td><button type="button" class="remove-row">Remove</button></td></tr>`;
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

(async () => {
  try {
    const status = await api('status');
    const userEl = document.getElementById('admin-user-info');
    if (userEl && status.user) {
      userEl.textContent = `Logged in as @${status.user.login || status.user.id}`;
    }
    cache.categories = await api('categories');
    await load();
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('401') || msg.includes('Not authenticated')) {
      notice('You are not logged in. Redirecting to GitHub login...', true);
      window.location.href = '/api/auth/login';
      return;
    }
    notice('Admin access is not yet configured or you are not logged in. ' + msg, true);
  }
})();
