// Felder für die Datenbank „Wissen“ einstufen, nach den Regeln aus Tobis Notion-Skill.

import { z } from 'zod';
import type { EpisodeMeta, NotionMeta, Results, Speaker } from '../../shared/src/types.ts';
import { EINSTUFUNGSREGELN, EVIDENZGRADE, KONTEXTE, THEMEN } from '../../shared/src/wissen.ts';
import { UNTRUSTED_NOTE, callJson, fence } from './claude.ts';

const Schema = z.object({
  titel: z.string(),
  themen: z.array(z.enum(THEMEN)),
  kontext: z.enum(KONTEXTE),
  evidenzgrad: z.enum(EVIDENZGRADE),
  sensibel: z.boolean(),
  zeit_intern: z.boolean(),
  zeitgebunden: z.array(z.string()),
  stand_zusatz: z.string().nullable(),
});

export async function classify(meta: EpisodeMeta, results: Results, speakers: Speaker[]): Promise<NotionMeta> {
  const essenz = [
    ...results.essenz.blocks.map((b) => `## ${b.heading}\n${b.sentences.map((s) => s.text).join(' ')}`),
    ...results.essenz.shorts.map((b) => `## ${b.heading}\n${b.sentences.map((s) => s.text).join(' ')}`),
  ].join('\n\n');

  const r = await callJson({
    stage: 'Einstufen',
    effort: 'low',
    maxTokens: 8000,
    schema: Schema,
    system: `Du stufst eine Podcastfolge für eine persönliche Wissensdatenbank ein. ${UNTRUSTED_NOTE}

${EINSTUFUNGSREGELN}

Grundlage ist nur die Essenz unten. Erfinde nichts hinzu.`,
    user: [
      `Sendung: ${meta.show}\nFolge: ${meta.title}\nStimmen: ${speakers.filter((s) => s.role !== 'sonstige').map((s) => s.name ?? s.short).join(', ')}`,
      fence('essenz', essenz),
    ].join('\n\n'),
  });

  return {
    titel: r.titel.trim().slice(0, 60),
    themen: [...new Set(r.themen)].slice(0, 2),
    kontext: r.kontext,
    evidenzgrad: r.evidenzgrad,
    sensibel: r.sensibel,
    zeitIntern: r.zeit_intern,
    zeitgebunden: r.zeitgebunden.map((b) => b.trim()).filter(Boolean).slice(0, 5),
    standZusatz: r.stand_zusatz?.trim() || null,
  };
}
