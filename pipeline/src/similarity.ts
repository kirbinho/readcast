import { normalizeForMatch } from '../../shared/src/text.ts';

function tokens(s: string): Set<string> {
  return new Set(normalizeForMatch(s).split(' ').filter((t) => t.length > 1));
}

/** Ähnlichkeit zweier Titel zwischen 0 und 1 (Dice-Koeffizient über Wörter). */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}
