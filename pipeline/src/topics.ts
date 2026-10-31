// Stufe 2: Die Etiketten aller Fenster zu Themen der ganzen Folge zusammenführen.
// Ein Thema, das in Minute 10 und Minute 70 vorkommt, wird so als ein Thema erkannt.

import { z } from 'zod';
import type { EpisodeMeta, Segment } from '../../shared/src/types.ts';
import { formatTs } from '../../shared/src/text.ts';
import { UNTRUSTED_NOTE, callJson, fence } from './claude.ts';
import type { WindowResult } from './extract.ts';
import { renderTranscript } from './segments.ts';

export interface Topic {
  id: string;
  title: string;
  labels: string[]; // "w2:Etikett"
  announced: boolean; // in Titel, Kapiteln oder Anmoderation angekündigt
}

const Schema = z.object({
  themen: z.array(
    z.object({
      titel: z.string(),
      etiketten: z.array(z.string()),
      angekuendigt: z.boolean(),
    }),
  ),
});

export interface Chapter {
  ts: number;
  title: string;
}

/** Kapitelmarken aus den Shownotes, z. B. „(00:19:26) KI-Suchanzeigen“. */
export function parseChapters(description: string): Chapter[] {
  const out: Chapter[] = [];
  for (const m of description.matchAll(/^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:]?\s*(.+)$/gm)) {
    const parts = m[1].split(':').map(Number);
    const sec = parts.reduce((a, p) => a * 60 + p, 0);
    out.push({ ts: sec * 1000, title: m[2].trim().slice(0, 120) });
  }
  return out.length >= 2 ? out : [];
}

export async function mergeTopics(meta: EpisodeMeta, wins: WindowResult[], segments: Segment[], names: Record<string, string>): Promise<Topic[]> {
  const lines: string[] = [];
  const allLabels: string[] = [];
  for (const w of wins) {
    const byLabel = new Map<string, string[]>();
    for (const c of w.claims) {
      if (!c.label) continue;
      const list = byLabel.get(c.label) ?? [];
      if (list.length < 4) list.push(c.aussage);
      byLabel.set(c.label, list);
    }
    for (const [label, claims] of byLabel) {
      const key = `w${w.window + 1}:${label}`;
      allLabels.push(key);
      lines.push(`${key}\n${claims.map((c) => `  – ${c}`).join('\n')}`);
    }
  }
  if (!allLabels.length) return [];

  const chapters = parseChapters(meta.description);
  const opening = segments.filter((s) => s.start < 180_000);

  const res = await callJson({
    stage: 'Themen',
    effort: 'medium',
    maxTokens: 16000,
    schema: Schema,
    system: `Du bekommst die Themen-Etiketten aus allen Abschnitten einer Podcastfolge, jeweils mit einigen Aussagen. Führe sie zu den Themen der ganzen Folge zusammen. ${UNTRUSTED_NOTE}

Regeln:
- Etiketten, die dasselbe Thema meinen, gehören zusammen, auch wenn sie in weit auseinanderliegenden Abschnitten stehen.
- Getrennte Themen bleiben getrennt. Fasse nicht zu Oberbegriffen zusammen, die nichts mehr aussagen.
- Jedes Etikett gehört zu genau einem Thema. Übernimm die Etiketten exakt, mit dem Präfix.
- titel: ein kurzer, sachlicher Name des Themas.
- angekuendigt: true, wenn der Folgentitel, eine Kapitelmarke, die Beschreibung oder die Anmoderation genau dieses Thema als Thema der Folge nennt. Sonst false.`,
    user: [
      `Folgentitel: ${meta.title}`,
      chapters.length ? fence('kapitel', chapters.map((c) => `${formatTs(c.ts)} ${c.title}`).join('\n')) : '',
      fence('beschreibung', meta.description.slice(0, 2500)),
      fence('anmoderation', renderTranscript(opening, names)),
      fence('etiketten', lines.join('\n\n')),
    ].filter(Boolean).join('\n\n'),
  });

  const valid = new Set(allLabels);
  const used = new Set<string>();
  const topics: Topic[] = [];
  for (const t of res.themen) {
    const labels = t.etiketten.filter((l) => valid.has(l) && !used.has(l));
    labels.forEach((l) => used.add(l));
    if (labels.length) topics.push({ id: `t${topics.length + 1}`, title: t.titel.trim(), labels, announced: t.angekuendigt });
  }
  // Was das Modell vergessen hat, wird ein eigenes Thema
  for (const l of allLabels) {
    if (!used.has(l)) topics.push({ id: `t${topics.length + 1}`, title: l.split(':').slice(1).join(':'), labels: [l], announced: false });
  }
  return topics;
}
