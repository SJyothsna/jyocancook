// Display helpers for recipe text. The same rules are repeated in backend/generator/TemplateRenderer.php.

const UNIT_LABELS: Record<string, string> = { tsp: 'Tsp', tbsp: 'Tbsp' };

/** Units are stored as typed ("tbsp") and shown with a capital first letter for tsp and tbsp ("Tbsp"). */
export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit.trim().toLowerCase()] ?? unit;
}

export type StepBlock = { type: 'p' | 'ul' | 'ol'; lines: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Instruction text is plain lines. Lines starting with "- " or "• " are shown as a bullet list,
 * lines starting with "1. " as a numbered list, and every other line as normal text.
 */
export function stepBlocks(text: string): StepBlock[] {
  const blocks: StepBlock[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const bullet = raw.match(BULLET);
    const number = bullet ? null : raw.match(NUMBER);
    const type = bullet ? 'ul' : number ? 'ol' : 'p';
    const line = (bullet ?? number)?.[1].trim() ?? raw.trim();
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) last.lines.push(line);
    else blocks.push({ type, lines: [line] });
  }
  return blocks;
}

/**
 * Admin helper: puts a bullet ("\u2022 ") or number ("1. ") in front of every non-empty line, or takes it
 * away again when every line already has that style. Existing bullets and numbers are replaced.
 */
export function applyListFormat(text: string, kind: 'ul' | 'ol'): string {
  const lines = text.split(/\r?\n/);
  const filled = lines.filter((l) => l.trim());
  const marker = kind === 'ul' ? BULLET : NUMBER;
  const strip = (l: string) => (l.match(BULLET) ?? l.match(NUMBER))?.[1].trim() ?? l.trim();
  if (filled.length && filled.every((l) => marker.test(l))) {
    return lines.map((l) => (l.trim() ? strip(l) : l)).join('\n');
  }
  let n = 0;
  return lines.map((l) => (l.trim() ? (kind === 'ul' ? '\u2022 ' : `${++n}. `) + strip(l) : l)).join('\n');
}
