// Ingredient quantities are stored as numbers (0.5) but typed and shown as fractions (1/2).
// The same display logic is repeated in the inline page scripts and in backend/generator/TemplateRenderer.php.

/** "1/2", "1 1/2", "0.5" or "2" -> number. Empty or invalid text -> null. */
export function parseQty(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const m = s.match(/^(?:(\d+) )?(\d+) ?\/ ?(\d+)$/);
  if (m) {
    const den = Number(m[3]);
    if (!den) return null;
    return Number((Number(m[1] || 0) + Number(m[2]) / den).toFixed(4));
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const FRACTIONS: [number, string, string][] = [
  [1 / 8, '1/8', '⅛'],
  [1 / 4, '1/4', '¼'],
  [1 / 3, '1/3', '⅓'],
  [3 / 8, '3/8', '⅜'],
  [1 / 2, '1/2', '½'],
  [5 / 8, '5/8', '⅝'],
  [2 / 3, '2/3', '⅔'],
  [3 / 4, '3/4', '¾'],
  [7 / 8, '7/8', '⅞'],
];

/**
 * 0.5 -> "1/2", 1.5 -> "1 1/2", 2 -> "2", 0.33 -> "1/3", 0.7 -> "0.7".
 * With `symbols` the fraction is a single character ("1 ½"), which reads clearly next to a whole number.
 * The admin form uses the plain "1 1/2" form because that is what parseQty reads back.
 */
export function formatQty(n: number | null | undefined, symbols = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  const hit = FRACTIONS.find(([v]) => Math.abs(frac - v) < 0.02);
  if (hit) return (whole ? `${whole} ` : '') + (symbols ? hit[2] : hit[1]);
  return String(Number(n.toFixed(2)));
}
