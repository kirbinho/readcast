// Stufe 4: Schreiben. Das Modell bekommt nur die ausgewählten Themen und ihre Aussagen
// samt Originalstellen, und jeder Satz muss seine Belege nennen.

import { z } from 'zod';
import type { Block, Segment, Sentence, Short, Speaker } from '../../shared/src/types.ts';
import { UNTRUSTED_NOTE, callJson, fence } from './claude.ts';
import type { Claim, QuoteCandidate } from './extract.ts';
import { pickClaims, type ScoredTopic } from './salience.ts';
import { renderTranscript } from './segments.ts';

const SentenceSchema = z.object({ text: z.string(), segs: z.array(z.string()) });

const EssenzSchema = z.object({
  bloecke: z.array(z.object({ thema: z.string(), ueberschrift: z.string(), saetze: z.array(SentenceSchema) })),
  kurzmeldungen: z.array(z.object({ thema: z.string(), ueberschrift: z.string(), saetze: z.array(SentenceSchema) })),
});

const PersonSchema = z.object({
  bloecke: z.array(
    z.object({ thema: z.string(), ueberschrift: z.string(), saetze: z.array(SentenceSchema), oton: z.string().nullable() }),
  ),
});

export const WRITING_RULES = `Schreibregeln:
- Nur, was in der Folge gesagt wurde. Keine eigenen Schlüsse, keine Einordnung von außen, kein Weltwissen, keine Wertung.
- Meinungen und Prognosen bleiben als solche erkennbar und werden der Person zugeschrieben („Klöckner erwartet …“). Fakten, die jemand nennt, gibst du als seine Aussage wieder, nicht als geprüfte Tatsache.
- Zahlen, Namen und Daten exakt wie im Material.
- Leite nie ein Geschlecht ab, weder aus Name noch aus Stimme noch aus Rolle. Keine Wörter wie „Sprecherin“, „Moderator“, „er“ oder „sie“ für eine Person, außer die Folge nennt es ausdrücklich. Nenne die Person beim Namen, ohne Namen schreib „Host“ oder „Gast“ ohne Artikel.
- „Einspieler“ sind eingeblendete O-Töne, keine Gesprächspartner. Schreib „in einem Einspieler heißt es“ oder nenne den Namen, falls ihn das Material nennt. Schreib nie „Stimme A“ oder Ähnliches, wenn es sich vermeiden lässt.
- Überschriften sind Aussagen, keine Etiketten: „Microsoft spart beim Rechenzentrumsausbau“ statt „Microsoft“. Höchstens 90 Zeichen.
- Sachlich, klar, aktiv. Keine Füllsätze, keine Einleitungen wie „In diesem Abschnitt …“.
- Deutsch, auch wenn das Gespräch englisch ist.
- segs: die Abschnitte, auf die sich der Satz stützt. Jeder Satz hat mindestens einen Beleg. Nutze nur Abschnitte aus dem Material.`;

function claimLines(claims: Claim[], names: Record<string, string>): string {
  return claims
    .map((c) => `${c.id} [${names[c.spk] ?? c.spk}; ${c.typ}; segs ${c.segs.join(',')}] ${c.aussage}${c.kontext ? ` (Kontext: ${c.kontext})` : ''}`)
    .join('\n');
}

function sourceFor(claims: Claim[], segments: Segment[], names: Record<string, string>): string {
  const ids = new Set(claims.flatMap((c) => c.segs));
  return renderTranscript(segments.filter((s) => ids.has(s.id)), names);
}

function toSentences(raw: { text: string; segs: string[] }[], valid: Set<string>): Sentence[] {
  return raw
    .map((s) => ({ text: s.text.trim(), segs: s.segs.filter((x) => valid.has(x)) }))
    .filter((s) => s.text && s.segs.length);
}

function firstTs(sentences: Sentence[], segById: Map<string, Segment>): number {
  return Math.min(...sentences.flatMap((s) => s.segs.map((id) => segById.get(id)?.start ?? Infinity)));
}

/** Länge folgt dem Gewicht: großes Thema, mehr Sätze. */
function sentenceBudget(t: ScoredTopic, top: number): string {
  const rel = top ? t.score / top : 1;
  return rel > 0.8 ? '4 bis 6 Sätze' : rel > 0.55 ? '3 bis 5 Sätze' : '2 bis 4 Sätze';
}

export async function writeEssenz(
  main: ScoredTopic[],
  shorts: ScoredTopic[],
  segments: Segment[],
  names: Record<string, string>,
): Promise<{ blocks: Block[]; shorts: Short[] }> {
  const segById = new Map(segments.map((s) => [s.id, s]));
  const top = main[0]?.score ?? 1;
  const sections = [
    ...main.map((t, i) => {
      const claims = pickClaims(t.claims, 14);
      return `## ${t.topic.id} · Schwerpunkt ${i + 1} · ${t.topic.title} · Umfang: ${sentenceBudget(t, top)}\n${claimLines(claims, names)}`;
    }),
    ...shorts.map((t) => `## ${t.topic.id} · Kurzmeldung · ${t.topic.title} · Umfang: 1 bis 3 Sätze, höchstens 150 Wörter\n${claimLines(pickClaims(t.claims, 5), names)}`),
  ];
  const used = [...main, ...shorts].flatMap((t) => pickClaims(t.claims, 14));
  const res = await callJson({
    stage: 'Essenz',
    effort: 'medium',
    maxTokens: 24000,
    schema: EssenzSchema,
    system: `Du schreibst die Essenz einer Podcastfolge. Welche Themen hineingehören und in welcher Reihenfolge, ist bereits entschieden: Halte Reihenfolge und Umfang genau ein. Lass kein Thema weg und füge keins hinzu. ${UNTRUSTED_NOTE}

Je Schwerpunkt ein Block (bloecke), je Kurzmeldung ein Eintrag (kurzmeldungen), jeweils mit der Themen-ID in thema. Ein Block bündelt die tragenden Aussagen seines Themas zu einem lesbaren Absatz. Stützen sich Aussagen gegenseitig oder widersprechen sich die Stimmen, mach das sichtbar.

${WRITING_RULES}`,
    user: [fence('themen', sections.join('\n\n')), fence('originalstellen', sourceFor(used, segments, names))].join('\n\n'),
  });

  const valid = new Set(segments.map((s) => s.id));
  const blocks: Block[] = [];
  for (const t of main) {
    const b = res.bloecke.find((x) => x.thema === t.topic.id);
    const sentences = b ? toSentences(b.saetze, valid) : [];
    if (b && sentences.length) blocks.push({ heading: b.ueberschrift.trim(), sentences, ts: firstTs(sentences, segById), quote: null });
  }
  const shortOut: Short[] = [];
  for (const t of shorts) {
    const b = res.kurzmeldungen.find((x) => x.thema === t.topic.id);
    const sentences = b ? toSentences(b.saetze, valid) : [];
    if (b && sentences.length) shortOut.push({ heading: b.ueberschrift.trim(), sentences, ts: firstTs(sentences, segById) });
  }
  return { blocks, shorts: shortOut };
}

/** Themen einer Person: gewichtet nach ihrem Anteil am Thema und dem Gewicht des Themas. */
export function topicsForPerson(label: string, scored: ScoredTopic[]): ScoredTopic[] {
  return scored
    .map((t) => {
      const own = t.claims.filter((c) => c.spk === label && c.typ !== 'frage');
      return { t, own, weight: t.score * (own.length / Math.max(1, t.claims.length)) + 0.05 * own.filter((c) => c.kern).length };
    })
    .filter((x) => x.own.length >= 2 || x.own.some((c) => c.kern))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map((x) => x.t);
}

export async function writePerson(
  speaker: Speaker,
  scored: ScoredTopic[],
  quotes: QuoteCandidate[],
  segments: Segment[],
  names: Record<string, string>,
): Promise<{ blocks: Block[] }> {
  const topics = topicsForPerson(speaker.label, scored);
  if (!topics.length) return { blocks: [] };
  const segById = new Map(segments.map((s) => [s.id, s]));
  const name = names[speaker.label];
  const own = quotes.filter((q) => q.spk === speaker.label);

  const sections = topics.map((t) => {
    const mine = pickClaims(t.claims.filter((c) => c.spk === speaker.label), 10);
    // Fragen und Aussagen der anderen nur, soweit sie den Zusammenhang erklären
    const others = pickClaims(t.claims.filter((c) => c.spk !== speaker.label), 4);
    const segIds = new Set(t.claims.flatMap((c) => c.segs));
    const qs = own.filter((q) => segIds.has(q.seg));
    return [
      `## ${t.topic.id} · ${t.topic.title}`,
      `Aussagen von ${name}:\n${claimLines(mine, names)}`,
      others.length ? `Zusammenhang (andere Stimmen):\n${claimLines(others, names)}` : '',
      qs.length ? `Mögliche O-Töne von ${name}:\n${qs.map((q) => `${q.id}: „${q.text}“`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  });
  const used = topics.flatMap((t) => pickClaims(t.claims, 14));

  const res = await callJson({
    stage: `Person ${name}`,
    effort: 'medium',
    maxTokens: 16000,
    schema: PersonSchema,
    system: `Du schreibst auf, was ${name} in einer Podcastfolge sagt. Die Themen und ihre Reihenfolge stehen fest. Je Thema ein Block mit der Themen-ID in thema. ${UNTRUSTED_NOTE}

Der Block gibt die Position von ${name} wieder, in 2 bis 4 Sätzen. Was andere sagen, nur, wenn es nötig ist, um die Position zu verstehen (etwa die Frage, auf die ${name} antwortet).
oton: die ID eines der angebotenen O-Töne von ${name}, der die Position am besten trifft, oder null. Gibt es keinen passenden, null.

${WRITING_RULES}`,
    user: [fence('themen', sections.join('\n\n')), fence('originalstellen', sourceFor(used, segments, names))].join('\n\n'),
  });

  const valid = new Set(segments.map((s) => s.id));
  const blocks: Block[] = [];
  for (const t of topics) {
    const b = res.bloecke.find((x) => x.thema === t.topic.id);
    const sentences = b ? toSentences(b.saetze, valid) : [];
    if (!b || !sentences.length) continue;
    const q = b.oton ? own.find((x) => x.id === b.oton) : undefined;
    blocks.push({
      heading: b.ueberschrift.trim(),
      sentences,
      ts: firstTs(sentences, segById),
      quote: q ? { text: q.text, spk: q.spk, ts: segById.get(q.seg)?.start ?? 0 } : null,
    });
  }
  return { blocks };
}
