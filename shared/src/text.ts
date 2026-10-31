// Kleine Textwerkzeuge, die überall gleich arbeiten müssen.

/** Zeitstempel in ms als "14:32" oder "1:04:32". */
export function formatTs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Normalisiert Text für den wörtlichen Abgleich: Kleinschreibung,
 * Anführungszeichen und Satzzeichen raus, Leerraum vereinheitlicht.
 * Gleiche Wörter in gleicher Reihenfolge bleiben gleich.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[„“”‚‘’«»"'`´]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prüft, ob ein Zitat wörtlich im Quelltext steht. */
export function isVerbatim(quote: string, source: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.split(' ').length < 4) return false;
  return normalizeForMatch(source).includes(q);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Entfernt HTML aus Shownotes und behält Absätze. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Nur http(s)-Adressen gelten als Link. */
export function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

export function domainOf(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}
