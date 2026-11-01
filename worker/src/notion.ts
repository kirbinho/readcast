// Ablage in der Datenbank „Wissen“: eine Seite pro Folge, jede Auswertung ein eigener Block.
// Formatierung nach dem Notion-Skill: Überschriften, Absätze, Fettung, Aufzählungen. Keine Farben, keine Trennlinien.

import type { Block, EpisodeMeta, ModeKey, NotionMeta, QaEntry, Results, Speaker } from '../../shared/src/types.ts';
import { formatTs } from '../../shared/src/text.ts';
import { FREIGABE_THEMEN, WISSEN_DATA_SOURCE_ID, keepExistingProperties } from '../../shared/src/wissen.ts';
import { HttpError, type Env } from './http.ts';
import type { EpisodeRow } from './store.ts';

const API = 'https://api.notion.com/v1';
const VERSION = '2026-03-11';
const UNDO_BATCH = 40; // Löschungen je Anfrage, wegen der Grenze für Unteranfragen

type NBlock = Record<string, unknown>;

async function notion<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, 'notion-version': VERSION, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // Notions Begründung nennt das betroffene Feld. Sie geht nur an die angemeldete Person und ins private Protokoll.
    const detail = ((await res.json().catch(() => ({}))) as { code?: string; message?: string });
    console.error(`Notion ${res.status} ${detail.code ?? ''}: ${detail.message ?? ''}`);
    throw new HttpError(502, `Notion hat abgelehnt (${res.status}): ${(detail.message ?? 'ohne Begründung').slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function rt(text: string, bold = false) {
  const out: { type: 'text'; text: { content: string }; annotations?: { bold: boolean } }[] = [];
  for (let i = 0; i < text.length; i += 1900) {
    out.push({ type: 'text', text: { content: text.slice(i, i + 1900) }, ...(bold ? { annotations: { bold: true } } : {}) });
  }
  return out;
}

const h2 = (t: string): NBlock => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(t) } });
const h3 = (t: string): NBlock => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(t) } });
const p = (...parts: { text: string; bold?: boolean }[]): NBlock => ({
  object: 'block',
  type: 'paragraph',
  paragraph: { rich_text: parts.flatMap((x) => rt(x.text, x.bold)) },
});
const li = (t: string): NBlock => ({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rt(t) } });

function blockSection(b: Block, short: Map<string, string>): NBlock[] {
  const out = [h3(b.heading), p({ text: `${b.sentences.map((s) => s.text).join(' ')} (${formatTs(b.ts)})` })];
  if (b.quote) out.push(p({ text: `${b.quote.text} (${short.get(b.quote.spk) ?? b.quote.spk}, ${formatTs(b.quote.ts)})` }));
  return out;
}

export function modeBlocks(mode: ModeKey, results: Results, speakers: Speaker[], qa: QaEntry[]): NBlock[] {
  const short = new Map(speakers.map((s) => [s.label, s.short]));
  if (mode === 'essenz') {
    const out = [h2('Essenz'), ...results.essenz.blocks.flatMap((b) => blockSection(b, short))];
    if (results.essenz.shorts.length) {
      out.push(h3('Kurzmeldungen'));
      for (const s of results.essenz.shorts) {
        out.push(p({ text: `${s.heading}. `, bold: true }, { text: `${s.sentences.map((x) => x.text).join(' ')} (${formatTs(s.ts)})` }));
      }
    }
    return out;
  }
  if (mode === 'zehn') {
    return [h2('10 O-Töne'), ...results.zehn.map((z) => li(`„${z.text}“ (${short.get(z.spk) ?? z.spk}, ${formatTs(z.ts)})`))];
  }
  if (mode === 'frag') {
    return [
      h2('Fragen an die Folge'),
      ...[...qa].reverse().flatMap((x) => [
        p({ text: x.q, bold: true }),
        p({ text: x.found ? `${x.answer} (${x.cites.map((c) => `${c.spk}, ${formatTs(c.ts)}`).join('; ')})` : x.answer }),
      ]),
    ];
  }
  const label = mode.slice(2);
  const sp = speakers.find((s) => s.label === label);
  const blocks = results.personen[label]?.blocks ?? [];
  return [h2(`Was ${sp?.name ?? sp?.short ?? 'diese Stimme'} sagt`), ...blocks.flatMap((b) => blockSection(b, short))];
}

export function availableModes(results: Results, qa: QaEntry[]): ModeKey[] {
  const modes: ModeKey[] = [];
  if (results.essenz.blocks.length) modes.push('essenz');
  if (results.zehn.length) modes.push('zehn');
  for (const [label, p] of Object.entries(results.personen)) if (p.blocks.length) modes.push(`p:${label}`);
  if (qa.length) modes.push('frag');
  return modes;
}

function berlinDate(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

function properties(meta: EpisodeMeta, nm: NotionMeta, speakers: Speaker[], link: string, modes: ModeKey[]) {
  const people = speakers.filter((s) => s.role !== 'sonstige' && s.name).map((s) => s.name!);
  const summary = modes.some((m) => m === 'essenz' || m.startsWith('p:'));
  const props: Record<string, unknown> = {
    Titel: { title: rt(nm.titel) },
    Thema: { multi_select: nm.themen.map((name) => ({ name })) },
    Kontext: { select: { name: nm.kontext } },
    Format: { select: { name: 'Podcast' } },
    Tiefe: { select: { name: summary ? 'Zusammenfassung' : 'Extrakte' } },
    Evidenzgrad: { select: { name: nm.evidenzgrad } },
    Herkunft: { rich_text: rt(meta.show) },
    Sensibel: { checkbox: nm.sensibel },
    'ZEIT-intern': { checkbox: nm.zeitIntern },
    'Freigabe Arbeit': { checkbox: nm.themen.some((t) => FREIGABE_THEMEN.includes(t)) },
    Erfassungsdatum: { date: { start: berlinDate() } },
    URL: { url: link },
  };
  if (people.length) props.Personen = { rich_text: rt(people.join(', ')) };
  if (meta.published) props['Publiziert am'] = { date: { start: meta.published.slice(0, 10) } };
  if (nm.haltbarkeit) props.Haltbarkeit = { select: { name: nm.haltbarkeit } };
  if (nm.haltbarkeitsnotiz) props.Haltbarkeitsnotiz = { rich_text: rt(nm.haltbarkeitsnotiz) };
  if (nm.horizont) props.Horizont = { date: { start: nm.horizont } };
  return props;
}

export interface SaveResult {
  pageUrl: string;
  pageId: string;
  added: ModeKey[];
  last: { blockIds: string[]; createdPage: boolean; modes: ModeKey[] };
}

export async function save(env: Env, row: EpisodeRow, modes: ModeKey[], qa: QaEntry[]): Promise<SaveResult> {
  if (!row.results || !row.meta || !row.notion_meta) throw new HttpError(409, 'Die Folge ist noch nicht fertig ausgelesen.');
  const results = JSON.parse(row.results) as Results;
  const meta = JSON.parse(row.meta) as EpisodeMeta;
  const nm = JSON.parse(row.notion_meta) as NotionMeta;
  const speakers = (row.speakers ? JSON.parse(row.speakers) : []) as Speaker[];
  const already = new Set(JSON.parse(row.notion_modes) as ModeKey[]);
  const allowed = new Set(availableModes(results, qa));
  const add = modes.filter((m, i) => allowed.has(m) && !already.has(m) && modes.indexOf(m) === i);
  if (!add.length) throw new HttpError(400, 'Nichts Neues ausgewählt.');

  const children = add.flatMap((m) => modeBlocks(m, results, speakers, qa));

  if (!row.notion_page_id) {
    // Felder wie Haltbarkeit können in Notion wegfallen. Mit ihnen entfällt auch der Kernaussagen-Block, der darauf aufbaut.
    const schema = await notion<{ properties: Record<string, unknown> }>(env, 'GET', `/data_sources/${WISSEN_DATA_SOURCE_ID}`);
    const { kept, dropped } = keepExistingProperties(properties(meta, nm, speakers, row.link, add), Object.keys(schema.properties));
    if (dropped.length) console.error(`Felder fehlen in Wissen: ${dropped.join(', ')}`);
    const head: NBlock[] = nm.kernaussagen.length && 'Haltbarkeit' in schema.properties
      ? [h2('Kernaussagen'), ...nm.kernaussagen.map((k) => p({ text: `[${k.marker}] ${k.text}` }))]
      : [];
    const all = [...head, ...children];
    const page = await notion<{ id: string; url: string }>(env, 'POST', '/pages', {
      parent: { type: 'data_source_id', data_source_id: WISSEN_DATA_SOURCE_ID },
      properties: kept,
      children: all.slice(0, 100),
    });
    for (let i = 100; i < all.length; i += 100) {
      await notion(env, 'PATCH', `/blocks/${page.id}/children`, { children: all.slice(i, i + 100) });
    }
    return { pageUrl: page.url, pageId: page.id, added: add, last: { blockIds: [], createdPage: true, modes: add } };
  }

  const ids: string[] = [];
  for (let i = 0; i < children.length; i += 100) {
    const r = await notion<{ results: { id: string }[] }>(env, 'PATCH', `/blocks/${row.notion_page_id}/children`, { children: children.slice(i, i + 100) });
    ids.push(...r.results.map((x) => x.id));
  }
  return { pageUrl: row.notion_page_url!, pageId: row.notion_page_id, added: add, last: { blockIds: ids, createdPage: false, modes: add } };
}

/** Macht die letzte Ablage rückgängig. Gibt zurück, wie viele Blöcke noch zu löschen sind. */
export async function undo(env: Env, row: EpisodeRow): Promise<{ remaining: number; pageGone: boolean; modes: ModeKey[] }> {
  if (!row.notion_last || !row.notion_page_id) throw new HttpError(409, 'Es gibt nichts rückgängig zu machen.');
  const last = JSON.parse(row.notion_last) as { blockIds: string[]; createdPage: boolean; modes: ModeKey[] };
  if (last.createdPage) {
    await notion(env, 'PATCH', `/pages/${row.notion_page_id}`, { in_trash: true });
    return { remaining: 0, pageGone: true, modes: last.modes };
  }
  const batch = last.blockIds.slice(0, UNDO_BATCH);
  for (const id of batch) await notion(env, 'DELETE', `/blocks/${id}`);
  const rest = last.blockIds.slice(UNDO_BATCH);
  await env.DB.prepare('UPDATE episodes SET notion_last = ? WHERE id = ?')
    .bind(rest.length ? JSON.stringify({ ...last, blockIds: rest }) : null, row.id)
    .run();
  return { remaining: rest.length, pageGone: false, modes: last.modes };
}
