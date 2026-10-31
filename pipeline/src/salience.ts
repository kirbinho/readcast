// Stufe 3: Gewichtung. Hier wird entschieden, was ein Schwerpunkt ist.
// Bewusst als nachvollziehbare Rechnung und nicht als Frage an das Modell:
// Modelle können nicht verlässlich benennen, was sie selbst für wichtig halten,
// und ihr Gespür deckt sich nur schwach mit dem von Menschen (Trienes u. a., ACL 2025).
// Die Signale stammen aus der Folge selbst, nicht aus Tobis Interessen.

import type { Segment } from '../../shared/src/types.ts';
import type { Claim, QuoteCandidate, WindowResult } from './extract.ts';
import type { Topic } from './topics.ts';

export const WEIGHTS = {
  airtime: 0.4, // Sendezeit: wie viel Raum die Folge dem Thema gibt
  recurrence: 0.15, // Wiederkehr: kommt das Gespräch darauf zurück
  editorial: 0.15, // Ankündigung: Titel, Kapitel oder Anmoderation nennen es
  substance: 0.15, // Gehalt: Zahl der tragenden Aussagen
  specificity: 0.05, // Konkretheit: Zahlen, Namen, Beispiele
  engagement: 0.1, // Auseinandersetzung: mehrere Stimmen, Widerspruch, Betonung
};

const AIRTIME_FULL = 0.25;

export const THRESHOLDS = {
  mainScore: 0.42, // ab hier ein eigener Themenblock …
  mainAirtimeShare: 0.05, // … wenn das Thema auch mindestens 5 % der Inhaltszeit bekommt
  mainMinMs: 3 * 60_000, // oder mindestens drei Minuten
  maxMain: 7,
  shortAirtimeShare: 0.015, // Kurzmeldung ab 1,5 % Inhaltszeit …
  shortMinMs: 60_000, // … oder einer Minute
  maxShorts: 6,
};

export interface ScoredTopic {
  topic: Topic;
  ms: number;
  share: number;
  visits: number;
  firstTs: number;
  claims: Claim[];
  speakers: Set<string>;
  score: number;
  parts: Record<keyof typeof WEIGHTS, number>;
}

export interface Selection {
  main: ScoredTopic[];
  shorts: ScoredTopic[];
  dropped: ScoredTopic[];
  contentMs: number;
  scored: ScoredTopic[];
}

export function scoreTopics(topics: Topic[], wins: WindowResult[], segments: Segment[]): Selection {
  const labelToTopic = new Map<string, Topic>();
  for (const t of topics) for (const l of t.labels) labelToTopic.set(l, t);

  const segTopic = new Map<string, Topic>();
  let contentMs = 0;
  for (const w of wins) {
    for (const [seg, lbl] of w.label) {
      const art = w.art.get(seg);
      if (art !== 'inhalt' && art !== 'hoererfrage') continue;
      const t = lbl ? labelToTopic.get(`w${w.window + 1}:${lbl}`) : undefined;
      if (t) segTopic.set(seg, t);
    }
  }

  const stats = new Map<string, ScoredTopic>();
  const get = (t: Topic) => {
    let s = stats.get(t.id);
    if (!s) {
      s = { topic: t, ms: 0, share: 0, visits: 0, firstTs: Infinity, claims: [], speakers: new Set(), score: 0, parts: { airtime: 0, recurrence: 0, editorial: 0, substance: 0, specificity: 0, engagement: 0 } };
      stats.set(t.id, s);
    }
    return s;
  };

  // Sendezeit und Wiederkehr: zusammenhängende Strecken zählen als ein Besuch.
  // Kurze Einschübe (bis zwei Abschnitte) unterbrechen eine Strecke nicht.
  let prev: Topic | undefined;
  let gap = 0;
  for (const seg of segments) {
    const w = wins.find((x) => x.art.has(seg.id));
    const art = w?.art.get(seg.id);
    const isContent = art === 'inhalt' || art === 'hoererfrage';
    if (isContent) contentMs += seg.end - seg.start;
    const t = segTopic.get(seg.id);
    if (!t) {
      gap++;
      continue;
    }
    const s = get(t);
    s.ms += seg.end - seg.start;
    s.firstTs = Math.min(s.firstTs, seg.start);
    s.speakers.add(seg.spk);
    if (prev?.id !== t.id || gap > 2) s.visits++;
    prev = t;
    gap = 0;
  }

  for (const w of wins) {
    for (const c of w.claims) {
      const t = labelToTopic.get(`w${w.window + 1}:${c.label}`) ?? (c.segs[0] ? segTopic.get(c.segs[0]) : undefined);
      if (t) get(t).claims.push(c);
    }
  }

  const all = [...stats.values()].filter((s) => s.ms > 0 || s.claims.length > 0);
  const maxKern = Math.max(...all.map((s) => s.claims.filter((c) => c.kern && c.typ !== 'frage').length), 1);

  for (const s of all) {
    s.share = contentMs ? s.ms / contentMs : 0;
    const substantive = s.claims.filter((c) => c.typ !== 'frage');
    const kern = substantive.filter((c) => c.kern).length;
    const concrete = substantive.length ? substantive.filter((c) => c.konkret).length / substantive.length : 0;
    const voices = new Set(substantive.map((c) => c.spk)).size;
    const contested = substantive.some((c) => c.haltung === 'widerspruch');
    const stressed = substantive.some((c) => c.haltung === 'betont');
    s.parts = {
      // Absoluter Anteil, voll ab einem Viertel der Inhaltszeit. So bleiben in einer Folge
      // mit vielen gleich großen Themen alle sichtbar, statt am größten gemessen zu werden.
      airtime: Math.min(1, s.share / AIRTIME_FULL),
      recurrence: Math.min(1, Math.max(0, s.visits - 1) / 3),
      editorial: s.topic.announced ? 1 : 0,
      substance: kern / maxKern,
      specificity: concrete,
      engagement: (voices > 1 ? 0.4 : 0) + (contested ? 0.4 : 0) + (stressed ? 0.2 : 0),
    };
    s.score = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((acc, k) => acc + WEIGHTS[k] * s.parts[k], 0);
  }

  const ranked = [...all].sort((a, b) => b.score - a.score);
  const isMain = (s: ScoredTopic) =>
    s.score >= THRESHOLDS.mainScore && (s.share >= THRESHOLDS.mainAirtimeShare || s.ms >= THRESHOLDS.mainMinMs);
  let main = ranked.filter(isMain).slice(0, THRESHOLDS.maxMain);
  // Jede Folge hat mindestens einen Schwerpunkt
  if (!main.length && ranked.length) main = [ranked[0]];
  const rest = ranked.filter((s) => !main.includes(s));
  const hasSubstance = (s: ScoredTopic) => s.claims.some((c) => c.kern && c.typ !== 'frage');
  const shorts = rest
    .filter((s) => (s.share >= THRESHOLDS.shortAirtimeShare || s.ms >= THRESHOLDS.shortMinMs) && hasSubstance(s))
    .slice(0, THRESHOLDS.maxShorts);
  const dropped = rest.filter((s) => !shorts.includes(s));
  return { main, shorts, dropped, contentMs, scored: ranked };
}

/** Die Aussagen, auf die ein Block gebaut wird: tragende zuerst, dann konkrete. Fragen nur als Kontext. */
export function pickClaims(claims: Claim[], max: number): Claim[] {
  const rank = (c: Claim) => (c.kern ? 2 : 0) + (c.konkret ? 1 : 0) + (c.haltung !== 'neutral' ? 0.5 : 0) - (c.typ === 'frage' ? 3 : 0);
  return [...claims]
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, max)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Die zehn O-Töne: nach Meinung, Pointe und Zitierbarkeit, verteilt über die ganze Folge.
 * Jede Fünftel der Folge bekommt, wenn möglich, mindestens einen O-Ton,
 * und zwei O-Töne liegen nie dicht beieinander.
 */
export function pickQuotes(quotes: QuoteCandidate[], segments: Segment[], count = 10): QuoteCandidate[] {
  if (!quotes.length || !segments.length) return [];
  const start = segments[0].start;
  const duration = segments[segments.length - 1].end - start || 1;
  const tsOf = new Map(segments.map((s) => [s.id, s.start]));
  const score = (q: QuoteCandidate) => q.meinung + q.pointe + q.zitierbar;
  const sorted = [...quotes].filter((q) => score(q) >= 8).sort((a, b) => score(b) - score(a));
  const minGap = duration / 25;
  const picked: QuoteCandidate[] = [];
  const fits = (q: QuoteCandidate) => picked.every((p) => Math.abs(tsOf.get(p.seg)! - tsOf.get(q.seg)!) >= minGap);
  const fifth = (q: QuoteCandidate) => Math.min(4, Math.floor(((tsOf.get(q.seg)! - start) / duration) * 5));

  // Erst je Fünftel der stärkste starke O-Ton …
  for (let f = 0; f < 5; f++) {
    const best = sorted.find((q) => fifth(q) === f && score(q) >= 11 && fits(q));
    if (best) picked.push(best);
  }
  // … dann nach Stärke auffüllen
  for (const q of sorted) {
    if (picked.length >= count) break;
    if (!picked.includes(q) && fits(q)) picked.push(q);
  }
  return picked.sort((a, b) => tsOf.get(a.seg)! - tsOf.get(b.seg)!);
}
