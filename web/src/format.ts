import type { EpisodeView, Status } from '../../shared/src/types.ts';

const day = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const full = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export const shortDate = (iso: string | null) => (iso ? day.format(new Date(iso)) : '');
export const fullDate = (iso: string | null) => (iso ? full.format(new Date(iso)) : '–');
export const money = (n: number) => eur.format(n);
export const minutes = (sec: number | null) => (sec ? `${Math.round(sec / 60)} Min` : '');

const LANG: Record<string, string> = { de: 'Deutsch', en: 'Englisch' };
export const language = (code: string | null) => (code ? (LANG[code.slice(0, 2)] ?? code) : '–');

function eta(sec: number | null): string {
  const m = Math.max(1, Math.ceil((sec ?? 120) / 60));
  return m === 1 ? 'Noch etwa 1 Minute.' : `Noch etwa ${m} Minuten.`;
}

export function statusLine(ep: Pick<EpisodeView, 'status' | 'etaSec'>): string {
  const s: Status = ep.status;
  if (s === 'wartet' || s === 'sucht') return 'Suche die Folge …';
  if (s === 'hoert') return `Höre mit. ${eta(ep.etaSec)}`;
  if (s === 'liest') return `Lese die Schwerpunkte heraus. ${eta(ep.etaSec)}`;
  if (s === 'schreibt') return `Schreibe und prüfe gegen das Transkript. ${eta(ep.etaSec)}`;
  return '';
}
