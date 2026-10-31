// Äußerungen in zitierbare Abschnitte schneiden und die Stimmen zählen.

import type { Segment } from '../../shared/src/types.ts';
import { formatTs } from '../../shared/src/text.ts';
import type { Utterance } from './transcribe.ts';

const SOFT_MS = 25_000; // ab hier am nächsten Satzende schneiden
const HARD_MS = 60_000; // spätestens hier schneiden

export function toSegments(utterances: Utterance[]): Segment[] {
  const out: Segment[] = [];
  const push = (spk: string, start: number, end: number, text: string) => {
    const t = text.trim();
    if (t) out.push({ id: `s${String(out.length + 1).padStart(4, '0')}`, spk, start, end, text: t });
  };
  for (const u of utterances) {
    if (u.end - u.start <= HARD_MS || !u.words?.length) {
      push(u.speaker, u.start, u.end, u.text);
      continue;
    }
    let buf: string[] = [];
    let chunkStart = u.words[0].start;
    let lastEnd = chunkStart;
    for (const w of u.words) {
      buf.push(w.text);
      lastEnd = w.end;
      const len = w.end - chunkStart;
      if ((len >= SOFT_MS && /[.!?…]["“”»]?$/.test(w.text)) || len >= HARD_MS) {
        push(u.speaker, chunkStart, w.end, buf.join(' '));
        buf = [];
        chunkStart = w.end;
      }
    }
    if (buf.length) push(u.speaker, chunkStart, lastEnd, buf.join(' '));
  }
  return out;
}

export interface VoiceStat {
  label: string;
  ms: number;
  share: number;
  significant: boolean;
}

/**
 * Eine Stimme zählt, wenn sie mindestens 3 % der Sprechzeit oder 90 Sekunden hat.
 * Kurze Stimmen sind meist Jingles, Werbespots oder Einspieler.
 */
export function voiceStats(segments: Segment[]): VoiceStat[] {
  const ms = new Map<string, number>();
  for (const s of segments) ms.set(s.spk, (ms.get(s.spk) ?? 0) + (s.end - s.start));
  const total = [...ms.values()].reduce((a, b) => a + b, 0) || 1;
  return [...ms.entries()]
    .map(([label, v]) => ({ label, ms: v, share: v / total, significant: v / total >= 0.03 || v >= 90_000 }))
    .sort((a, b) => b.ms - a.ms);
}

/** Transkript als Text mit Abschnittsnummer, Minute und Stimme, so wie Claude es liest. */
export function renderTranscript(segments: Segment[], names: Record<string, string>): string {
  return segments
    .map((s) => `[${s.id} | ${formatTs(s.start)} | ${names[s.spk] ?? `Stimme ${s.spk}`}] ${s.text}`)
    .join('\n');
}
