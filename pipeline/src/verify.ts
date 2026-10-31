// Stufe 5: Gegenprobe. Jeder geschriebene Satz wird gegen seine Belegstellen geprüft.
// Nicht gestützte Sätze fliegen raus, teilweise gestützte werden auf das Belegte zurückgeschnitten.

import { z } from 'zod';
import type { Block, Segment, Sentence, Short } from '../../shared/src/types.ts';
import { UNTRUSTED_NOTE, callJson, fence } from './claude.ts';
import { renderTranscript } from './segments.ts';

const Schema = z.object({
  pruefung: z.array(
    z.object({
      id: z.string(),
      urteil: z.enum(['gestuetzt', 'teilweise', 'nicht']),
      korrektur: z.string(),
    }),
  ),
});

type Item = { heading: string; sentences: Sentence[] };

export async function verifyItems<T extends Item>(label: string, items: T[], segments: Segment[], names: Record<string, string>): Promise<T[]> {
  const flat = items.flatMap((it, i) => it.sentences.map((s, j) => ({ id: `${i}.${j}`, s })));
  if (!flat.length) return items;
  const segById = new Map(segments.map((s) => [s.id, s]));
  const listing = flat
    .map(({ id, s }) => {
      const src = s.segs.map((x) => segById.get(x)).filter((x): x is Segment => !!x);
      return `### ${id}\nSatz: ${s.text}\nBelege:\n${renderTranscript(src, names)}`;
    })
    .join('\n\n');

  const res = await callJson({
    stage: `Prüfen ${label}`,
    effort: 'low',
    maxTokens: 16000,
    schema: Schema,
    system: `Du prüfst Sätze einer Zusammenfassung gegen ihre Belegstellen aus dem Transkript. ${UNTRUSTED_NOTE}

Für jeden Satz:
- gestuetzt: Alles im Satz steht so in den Belegen. Zuschreibungen stimmen (wer hat es gesagt), Zahlen stimmen, eine Meinung wird nicht als Tatsache ausgegeben.
- teilweise: Der Kern ist belegt, aber etwas ist zugespitzt, falsch zugeschrieben, verallgemeinert oder hinzugefügt. korrektur: derselbe Satz, nur auf das Belegte zurückgeschnitten.
- nicht: Der Kern ist nicht belegt.
korrektur ist bei gestuetzt und nicht leer.`,
    user: fence('saetze', listing),
  });

  const verdict = new Map(res.pruefung.map((p) => [p.id, p]));
  return items
    .map((it, i) => ({
      ...it,
      sentences: it.sentences.flatMap((s, j) => {
        const v = verdict.get(`${i}.${j}`);
        if (!v || v.urteil === 'gestuetzt') return [s];
        if (v.urteil === 'teilweise' && v.korrektur.trim()) return [{ ...s, text: v.korrektur.trim() }];
        return [];
      }),
    }))
    .filter((it) => it.sentences.length > 0);
}

export async function verifyEssenz(e: { blocks: Block[]; shorts: Short[] }, segments: Segment[], names: Record<string, string>) {
  const [blocks, shorts] = await Promise.all([
    verifyItems('Essenz', e.blocks, segments, names),
    verifyItems('Kurzmeldungen', e.shorts, segments, names),
  ]);
  return { blocks, shorts };
}
