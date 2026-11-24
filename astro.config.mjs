import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeRecipe, sanitizeConfig } from './src/lib/admin-sanitize.ts';

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Minimal draft preview used only by the local dev server (production uses api/index.php).
function renderDevPreview(r) {
  const ings = (r.ingredients || [])
    .map((i) => `<li>${escHtml([i.amount ?? '', i.unit, i.name].filter((x) => x !== '').join(' '))}</li>`)
    .join('');
  const steps = (r.steps || [])
    .map((s) => `<li><strong>${escHtml(s.title)}</strong><br>${escHtml(s.text)}</li>`)
    .join('');
  const tips = (r.tips || []).map((t) => `<li>${escHtml(t)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview: ${escHtml(r.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#2b1d1a}
.banner{background:#fff3cd;border:1px solid #e6c85c;padding:.5rem .75rem;border-radius:6px;margin-bottom:1rem}
img{max-width:100%;border-radius:8px}</style></head><body>
<div class="banner">Draft preview (last saved version)${r.published ? '' : ' - not published'}</div>
<h1>${escHtml(r.title)}</h1><p>${escHtml(r.description)}</p>
${r.image ? `<img src="${escHtml(r.image)}" alt="">` : ''}
<p>Prep ${escHtml(r.prepTime)} min | Cook ${escHtml(r.cookTime)} min | Serves ${escHtml(r.servings)} | ${escHtml(r.difficulty)}</p>
<h2>Ingredients</h2><ul>${ings}</ul><h2>Steps</h2><ol>${steps}</ol>
${tips ? `<h2>Tips</h2><ul>${tips}</ul>` : ''}</body></html>`;
}

function adminDevPlugin() {
  return {
    name: 'admin-dev-api',
    // Saving writes JSON that data.ts imports; without this Vite does a full page reload,
    // which restarts the admin SPA ("Checking administrator access...").
    handleHotUpdate({ file }) {
      const f = file.replace(/\\/g, '/');
      if (f.includes('/config/') || f.includes('/src/content/recipes/')) return [];
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;

        if (!pathname.startsWith('/api/admin/')) {
          return next();
        }

        const sendJson = (data, status = 200) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json;charset=utf-8');
          res.end(JSON.stringify(data));
        };

        const readJson = () =>
          new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
              try {
                resolve(body ? JSON.parse(body) : {});
              } catch (e) {
                reject(e);
              }
            });
            req.on('error', reject);
          });

        const subPath = pathname.replace(/^\/api\/admin\//, '').replace(/\/$/, '');
        const segments = subPath.split('/');
        const type = segments[0];

        try {
          if (type === 'preview' && segments.length === 2 && req.method === 'GET') {
            const slug = decodeURIComponent(segments[1]).replace(/[^a-z0-9-]/gi, '');
            try {
              const recipe = JSON.parse(
                await fs.readFile(path.join(process.cwd(), 'src/content/recipes', `${slug}.json`), 'utf-8')
              );
              res.statusCode = 200;
              res.setHeader('Content-Type', 'text/html;charset=utf-8');
              return res.end(renderDevPreview(recipe));
            } catch {
              return sendJson({ error: 'Recipe not found' }, 404);
            }
          }

          if (type === 'status' && req.method === 'GET') {
            return sendJson({
              ok: true,
              user: {
                id: '12345678',
                login: 'jyocancook-admin',
                name: 'JyoCanCook Admin',
              },
              localDev: true,
            });
          }

          if (['categories', 'subcategories', 'diets', 'menu', 'tags'].includes(type)) {
            const filePath = path.join(process.cwd(), `config/${type}.json`);
            if (req.method === 'GET') {
              const content = await fs.readFile(filePath, 'utf-8');
              return sendJson({ data: JSON.parse(content), sha: 'local-dev-sha' });
            }
            if (req.method === 'POST') {
              const body = await readJson();
              const validated = sanitizeConfig(type, body.data);
              await fs.writeFile(filePath, JSON.stringify(validated, null, 2) + '\n', 'utf-8');
              return sendJson({ ok: true });
            }
          }

          if (type === 'recipes') {
            const recipeDir = path.join(process.cwd(), 'src/content/recipes');
            if (segments.length === 1 && req.method === 'GET') {
              const files = await fs.readdir(recipeDir);
              const data = [];
              for (const f of files) {
                if (f.endsWith('.json')) {
                  const content = await fs.readFile(path.join(recipeDir, f), 'utf-8');
                  data.push(JSON.parse(content));
                }
              }
              data.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
              return sendJson({ data, sha: 'local-dev-sha' });
            }

            if (segments.length === 2) {
              const slug = segments[1];
              const recipeFile = path.join(recipeDir, `${slug}.json`);

              if (req.method === 'GET') {
                const content = await fs.readFile(recipeFile, 'utf-8');
                return sendJson({ recipe: JSON.parse(content), sha: 'local-dev-sha' });
              }

              if (req.method === 'POST') {
                const body = await readJson();
                const validated = sanitizeRecipe(body.recipe);
                const targetFile = path.join(recipeDir, `${validated.slug}.json`);
                // Like the PHP backend: stamp the publish date once, keep it on later saves.
                let publishedAt;
                try {
                  publishedAt = JSON.parse(await fs.readFile(targetFile, 'utf-8')).publishedAt;
                } catch {}
                if (!publishedAt && validated.published) publishedAt = new Date().toISOString();
                const toSave = publishedAt ? { ...validated, publishedAt } : validated;
                await fs.writeFile(targetFile, JSON.stringify(toSave, null, 2) + '\n', 'utf-8');
                return sendJson({ ok: true, slug: validated.slug });
              }

              if (req.method === 'DELETE') {
                await fs.unlink(recipeFile);
                return sendJson({ ok: true });
              }
            }
          }

          if (type === 'image' && req.method === 'POST') {
            const body = await readJson();
            const rawName = String(body.name || 'image');
            const slugName = rawName
              .toLowerCase()
              .replace(/\.[^.]+$/, '')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 80);
            const ext = rawName.split('.').pop()?.toLowerCase() || 'jpg';
            const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'svg'];
            if (!allowedExts.includes(ext)) {
              return sendJson({ error: 'Unsupported image format (use JPG, PNG, WebP or SVG)' }, 400);
            }
            const name = `${slugName}-${Date.now().toString(36)}.${ext}`;
            const dataUrl = String(body.content || '');
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            if (!base64 || base64.length > 6 * 1024 * 1024) {
              return sendJson({ error: 'Invalid or oversized image payload' }, 400);
            }
            const buffer = Buffer.from(base64, 'base64');
            const dir = path.join(process.cwd(), 'public/images/recipes');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, name), buffer);
            return sendJson({ ok: true, path: `/images/recipes/${name}` });
          }

          return sendJson({ error: 'Not found' }, 404);
        } catch (err) {
          return sendJson({ error: err?.message || 'Server error' }, 500);
        }
      });
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL || 'https://jyocancook.com',
  output: 'static',
  integrations: [sitemap()],
  vite: {
    plugins: [adminDevPlugin()],
  },
});
