// Stufe 1: Das Transkript abschnittsweise lesen.
// Jedes Fenster wird für sich ausgewertet, damit die Mitte einer langen Folge
// so gründlich gelesen wird wie Anfang und Ende („Lost in the Middle“).

import { z } from 'zod';
import type { EpisodeMeta, Segment, Speaker } from '../../shared/src/types.ts';
import { isVerbatim, wordCount } from '../../shared/src/text.ts';
import { UNTRUSTED_NOTE, callJson, fence } from './claude.ts';
import { renderTranscript } from './segments.ts';
import { displayName } from './speakers.ts';

export const WINDOW_MS = 15 * 60_000;
const CONTEXT_SEGMENTS = 3;

export type Art = 'inhalt' | 'hoererfrage' | 'werbung' | 'smalltalk' | 'moderation';

export interface Claim {
  id: string; // "c0012"
  window: number;
  spk: string;
  segs: string[];
  aussage: string;
  kontext: string;
  typ: 'fakt' | 'zahl' | 'einschaetzung' | 'prognose' | 'empfehlung' | 'erklaerung' | 'erfahrung' | 'frage';
  konkret: boolean;
  haltung: 'neutral' | 'betont' | 'widerspruch' | 'zustimmung';
  kern: boolean;
  label: string; // Themen-Etikett des Fensters
}

export interface QuoteCandidate {
  id: string; // "q0007"
  spk: string;
  seg: string;
  text: string;
  meinung: number;
  pointe: number;
  zitierbar: number;
}

export interface WindowResult {
  window: number;
  art: Map<string, Art>; // Abschnitt → Art
  label: Map<string, string>; // Abschnitt → Themen-Etikett
  claims: Claim[];
  quotes: QuoteCandidate[];
}

const Schema = z.object({
  abschnitte: z.array(
    z.object({
      von: z.string(),
      bis: z.string(),
      art: z.enum(['inhalt', 'hoererfrage', 'werbung', 'smalltalk', 'moderation']),
      thema: z.string(),
    }),
  ),
  aussagen: z.array(
    z.object({
      segs: z.array(z.string()),
      stimme: z.string(),
      aussage: z.string(),
      kontext: z.string(),
      typ: z.enum(['fakt', 'zahl', 'einschaetzung', 'prognose', 'empfehlung', 'erklaerung', 'erfahrung', 'frage']),
      konkret: z.boolean(),
      haltung: z.enum(['neutral', 'betont', 'widerspruch', 'zustimmung']),
      kern: z.boolean(),
      thema: z.string(),
    }),
  ),
  otoene: z.array(
    z.object({
      seg: z.string(),
      text: z.string(),
      meinung: z.number().int(),
      pointe: z.number().int(),
      zitierbar: z.number().int(),
    }),
  ),
});

const SYSTEM = `Du liest einen Ausschnitt aus dem Transkript eines Podcasts und legst eine saubere Arbeitsgrundlage für spätere Zusammenfassungen an. Du fasst hier noch nichts zusammen und bewertest nicht, was wichtig ist. Du hältst fest, was gesagt wurde. ${UNTRUSTED_NOTE}

Jede Zeile des Transkripts beginnt mit [Abschnitt | Minute | Stimme]. „Einspieler“ steht für eingeblendete O-Töne, die nicht am Gespräch teilnehmen. Gib solche Aussagen nur wieder, wenn die Folge mit ihnen arbeitet, und mach kenntlich, dass sie eingespielt sind. Nennt die Folge den Namen, schreib ihn dazu. Der Block <daten-kontext> zeigt nur, was direkt davor gesagt wurde. Ordne ihn nicht ein und entnimm ihm nichts.

1. abschnitte: Teile alle Abschnitte des Ausschnitts lückenlos in zusammenhängende Bereiche (von, bis = Abschnittsnummern). Art:
   - inhalt: das eigentliche Gespräch über ein Thema
   - hoererfrage: eine Hörerfrage oder Hörerpost, die ein inhaltliches Thema aufmacht oder vertieft
   - werbung: Werbung, Sponsoren, Eigenwerbung, Rabattcodes, Hinweise auf Newsletter oder Tickets
   - smalltalk: Plaudern ohne Bezug zu einem Thema, Privates, Witze ohne Inhalt
   - moderation: Begrüßung, Ankündigungen, Verabschiedung, Organisatorisches, Hörerpost ohne Inhalt
   thema: bei inhalt und hoererfrage ein kurzes Etikett in höchstens sechs Wörtern (gleiches Thema = gleiches Etikett), sonst "".

2. aussagen: Alle inhaltlichen Aussagen aus inhalt- und hoererfrage-Bereichen als einzelne, für sich verständliche Sätze auf Deutsch, auch wenn das Gespräch englisch ist.
   - Eine Aussage pro Eintrag. Treu am Gesagten: nichts zuspitzen, nichts schlussfolgern, keine Wertung hinzufügen, Zahlen exakt übernehmen. Meinungen bleiben als Meinung erkennbar.
   - kontext: das Mindeste, das man braucht, um die Aussage richtig zu verstehen (z. B. worauf sie antwortet). Sonst "".
   - stimme: die Stimme, die es sagt, so wie sie im Transkript steht.
   - segs: die Abschnitte, in denen es gesagt wird.
   - typ: fakt, zahl, einschaetzung, prognose, empfehlung, erklaerung, erfahrung, frage.
   - konkret: true, wenn sie eine Zahl, einen Namen, ein Datum oder ein konkretes Beispiel enthält.
   - haltung: betont, wenn die Stimme sie ausdrücklich hervorhebt („das Entscheidende ist …“); widerspruch, wenn sie einer anderen Stimme widerspricht; zustimmung, wenn sie einer anderen ausdrücklich zustimmt; sonst neutral.
   - kern: true, wenn die Aussage einen tragenden Gedanken ihres Themas ausdrückt; false bei Beispielen, Ausschmückungen, Nebenbemerkungen.
   - thema: dasselbe Etikett wie im zugehörigen Bereich.
   Höchstens 25 Aussagen. Wenn es mehr gibt, nimm die tragenden und die konkreten.

3. otoene: Bis zu sechs Kandidaten für starke O-Töne. text ist eine exakte, unveränderte Zeichenfolge aus genau einem Abschnitt (seg), höchstens zwei Sätze und 45 Wörter, verständlich ohne Kontext. Nur aus inhalt- oder hoererfrage-Bereichen. Bewerte jeweils von 1 bis 5:
   - meinung: wie klar und entschieden eine Haltung ausgedrückt wird
   - pointe: wie zugespitzt und prägnant es formuliert ist
   - zitierbar: wie gut es für sich allein steht und Sinn ergibt
   Gibt es keine starken Stellen, gib weniger oder keine zurück.`;

export function windows(segments: Segment[]): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  let start = segments[0]?.start ?? 0;
  for (const s of segments) {
    if (cur.length && s.start - start >= WINDOW_MS) {
      out.push(cur);
      cur = [];
      start = s.start;
    }
    cur.push(s);
  }
  if (cur.length) out.push(cur);
  // Ein sehr kurzer Rest wird an das letzte Fenster gehängt
  if (out.length > 1) {
    const last = out[out.length - 1];
    if (last[last.length - 1].end - last[0].start < WINDOW_MS / 4) out[out.length - 2].push(...out.pop()!);
  }
  return out;
}

export async function extractWindow(
  meta: EpisodeMeta,
  win: Segment[],
  index: number,
  before: Segment[],
  speakers: Speaker[],
): Promise<WindowResult> {
  const names = Object.fromEntries(speakers.map((s) => [s.label, displayName(s)]));
  // Mehrere Einspieler teilen sich einen Namen, dort entscheidet die Belegstelle
  const byName = new Map(speakers.filter((s) => names[s.label] !== 'Einspieler').map((s) => [names[s.label], s.label]));
  const ids = new Set(win.map((s) => s.id));
  const segById = new Map(win.map((s) => [s.id, s]));

  const res = await callJson({
    stage: `Lesen ${index + 1}`,
    effort: 'medium',
    maxTokens: 32000,
    schema: Schema,
    system: SYSTEM,
    user: [
      `Sendung: ${meta.show}\nFolge: ${meta.title}\nStimmen: ${speakers.filter((s) => s.role !== 'sonstige').map((s) => names[s.label]).join(', ')}`,
      before.length ? fence('kontext', renderTranscript(before, names)) : '',
      fence('transkript', renderTranscript(win, names)),
    ].filter(Boolean).join('\n\n'),
  });

  // Bereiche auf Abschnitte abbilden, Lücken gelten als Inhalt ohne Etikett
  const order = win.map((s) => s.id);
  const art = new Map<string, Art>(order.map((id) => [id, 'inhalt']));
  const label = new Map<string, string>(order.map((id) => [id, '']));
  for (const a of res.abschnitte) {
    const from = order.indexOf(a.von);
    const to = order.indexOf(a.bis);
    if (from < 0 || to < from) continue;
    for (let i = from; i <= to; i++) {
      art.set(order[i], a.art);
      label.set(order[i], a.art === 'inhalt' || a.art === 'hoererfrage' ? a.thema.trim() : '');
    }
  }

  const usable = (seg: string) => ids.has(seg) && (art.get(seg) === 'inhalt' || art.get(seg) === 'hoererfrage');

  const claims: Claim[] = [];
  for (const c of res.aussagen) {
    const segs = c.segs.filter(usable);
    if (!segs.length || !c.aussage.trim()) continue;
    const spk = byName.get(c.stimme) ?? segById.get(segs[0])!.spk;
    claims.push({
      id: '',
      window: index,
      spk,
      segs,
      aussage: c.aussage.trim(),
      kontext: c.kontext.trim(),
      typ: c.typ,
      konkret: c.konkret,
      haltung: c.haltung,
      kern: c.kern,
      label: c.thema.trim() || label.get(segs[0]) || '',
    });
  }

  const quotes: QuoteCandidate[] = [];
  for (const q of res.otoene) {
    const seg = segById.get(q.seg);
    if (!seg || !usable(q.seg)) continue;
    const next = win[win.indexOf(seg) + 1];
    const source = next && next.spk === seg.spk ? `${seg.text} ${next.text}` : seg.text;
    // Nur, was wörtlich so im Transkript steht
    if (!isVerbatim(q.text, source) || wordCount(q.text) > 45) continue;
    const clamp = (n: number) => Math.min(5, Math.max(1, n));
    quotes.push({
      id: '',
      spk: seg.spk,
      seg: seg.id,
      text: q.text.trim(),
      meinung: clamp(q.meinung),
      pointe: clamp(q.pointe),
      zitierbar: clamp(q.zitierbar),
    });
  }

  return { window: index, art, label, claims, quotes };
}

export async function extractAll(meta: EpisodeMeta, segments: Segment[], speakers: Speaker[]): Promise<WindowResult[]> {
  const wins = windows(segments);
  const results = await Promise.all(
    wins.map((w, i) => {
      const before = i > 0 ? wins[i - 1].slice(-CONTEXT_SEGMENTS) : [];
      return extractWindow(meta, w, i, before, speakers);
    }),
  );
  let c = 0;
  let q = 0;
  for (const r of results) {
    for (const claim of r.claims) claim.id = `c${String(++c).padStart(4, '0')}`;
    for (const quote of r.quotes) quote.id = `q${String(++q).padStart(4, '0')}`;
  }
  return results;
}
