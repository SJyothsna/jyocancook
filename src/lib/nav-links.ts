// Header navigation rules for pages that build their links in the browser (the admin page): hidden items
// are dropped and the rest are ordered, like the public pages do. Only site paths and https links are kept.
export type MenuRow = { label?: unknown; href?: unknown; order?: unknown; visible?: unknown };

export function navLinks(rows: MenuRow[] | undefined): { label: string; href: string }[] {
  return (rows || [])
    .filter((i) => i.visible && /^(\/(?!\/)|https:\/\/)/.test(String(i.href || '')))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((i) => ({ label: String(i.label ?? ''), href: String(i.href) }));
}
