// Readcast-API. Öffentliche Routen unter /api (mit Login), Pipeline-Routen unter /internal (mit Geheimnis).

import type { EpisodeMeta, ModeKey, NotionMeta, Results, Segment, Speaker, Status } from '../../shared/src/types.ts';
import { LAUFEND } from '../../shared/src/types.ts';
import { formatTs, safeUrl } from '../../shared/src/text.ts';
import { ask } from './ask.ts';
import { login, requirePipeline, requireUser } from './auth.ts';
import { dispatchPipeline } from './github.ts';
import { HttpError, type Env, cors, json, now, readJson } from './http.ts';
import { save, undo } from './notion.ts';
import { budget, getRow, normalizeLink, recents, reserve, settleCost, view } from './store.ts';

type Handler = (req: Request, env: Env, params: string[]) => Promise<Response>;

const routes: [string, RegExp, Handler][] = [
  ['POST', /^\/api\/login$/, async (req, env) => json(env, await login(req, env))],

  ['GET', /^\/api\/me$/, async (req, env) => {
    const user = await requireUser(req, env);
    const { spentEur, capEur } = await budget(env);
    return json(env, { name: user.name, budget: { spentEur, capEur }, recents: await recents(env, user.id) });
  }],

  ['POST', /^\/api\/episodes$/, async (req, env) => {
    const user = await requireUser(req, env);
    const { link } = await readJson<{ link?: string }>(req, 4000);
    const url = safeUrl(link ?? '');
    if (!url) throw new HttpError(400, 'Das ist kein gültiger Link.');
    const b = await budget(env);
    if (b.availableUsd <= 0) throw new HttpError(402, 'Das Budget für diesen Monat ist aufgebraucht. Ab dem 1. geht es weiter.');

    const norm = normalizeLink(url.toString());
    const existing = await env.DB.prepare(
      `SELECT id FROM episodes WHERE user_id = ? AND link_norm = ? AND status IN ('fertig','wartet','sucht','hoert','liest','schreibt')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(user.id, norm).first<{ id: string }>();
    if (existing) {
      const row = await getRow(env, existing.id, user.id);
      if (row.status === 'fertig' || LAUFEND.includes(row.status)) return json(env, { id: row.id });
    }
    const id = crypto.randomUUID();
    const t = now();
    await env.DB.prepare(
      'INSERT INTO episodes (id, user_id, link, link_norm, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    ).bind(id, user.id, url.toString(), norm, 'wartet', t, t).run();
    try {
      await dispatchPipeline(env, id);
    } catch {
      await env.DB.prepare("UPDATE episodes SET status = 'fehler', error = ? WHERE id = ?")
        .bind('Das Auslesen ließ sich nicht starten. Versuch es gleich noch einmal.', id).run();
    }
    return json(env, { id }, 201);
  }],

  ['GET', /^\/api\/episodes\/([0-9a-f-]{36})$/, async (req, env, [id]) => {
    const user = await requireUser(req, env);
    return json(env, await view(env, await getRow(env, id, user.id)));
  }],

  ['POST', /^\/api\/episodes\/([0-9a-f-]{36})\/ask$/, async (req, env, [id]) => {
    const user = await requireUser(req, env);
    const { q } = await readJson<{ q?: string }>(req, 4000);
    return json(env, await ask(env, await getRow(env, id, user.id, true), q ?? ''));
  }],

  ['POST', /^\/api\/episodes\/([0-9a-f-]{36})\/notion$/, async (req, env, [id]) => {
    const user = await requireUser(req, env);
    const { modes } = await readJson<{ modes?: ModeKey[] }>(req, 4000);
    const row = await getRow(env, id, user.id);
    const qa = (await view(env, row)).qa;
    const r = await save(env, row, Array.isArray(modes) ? modes : [], qa);
    const all = [...new Set([...(JSON.parse(row.notion_modes) as ModeKey[]), ...r.added])];
    await env.DB.prepare('UPDATE episodes SET notion_page_id = ?, notion_page_url = ?, notion_modes = ?, notion_last = ?, updated_at = ? WHERE id = ?')
      .bind(r.pageId, r.pageUrl, JSON.stringify(all), JSON.stringify(r.last), now(), id).run();
    return json(env, { pageUrl: r.pageUrl, added: r.added, modes: all });
  }],

  ['POST', /^\/api\/episodes\/([0-9a-f-]{36})\/notion\/undo$/, async (req, env, [id]) => {
    const user = await requireUser(req, env);
    const row = await getRow(env, id, user.id);
    const r = await undo(env, row);
    if (r.remaining === 0) {
      const left = (JSON.parse(row.notion_modes) as ModeKey[]).filter((m) => !r.modes.includes(m));
      await env.DB.prepare('UPDATE episodes SET notion_modes = ?, notion_last = NULL, notion_page_id = ?, notion_page_url = ? WHERE id = ?')
        .bind(JSON.stringify(left), r.pageGone ? null : row.notion_page_id, r.pageGone ? null : row.notion_page_url, id).run();
      return json(env, { remaining: 0, modes: left });
    }
    return json(env, { remaining: r.remaining });
  }],

  // Ab hier nur für die Pipeline
  ['GET', /^\/internal\/jobs\/([0-9a-f-]{36})$/, async (req, env, [id]) => {
    requirePipeline(req, env);
    const row = await getRow(env, id);
    return json(env, { id: row.id, link: row.link });
  }],

  ['POST', /^\/internal\/jobs\/([0-9a-f-]{36})\/progress$/, async (req, env, [id]) => {
    requirePipeline(req, env);
    const p = await readJson<{ status: Status; progress: number; costUsd?: number; etaSec?: number | null; meta?: EpisodeMeta; speakers?: Speaker[]; speakerCount?: number }>(req);
    await env.DB.prepare(
      `UPDATE episodes SET status = ?, progress = ?, eta_sec = ?, meta = COALESCE(?, meta), speakers = COALESCE(?, speakers),
       speaker_count = COALESCE(?, speaker_count), updated_at = ? WHERE id = ?`,
    ).bind(p.status, Math.round(p.progress), p.etaSec ?? null, p.meta ? JSON.stringify(p.meta) : null,
      p.speakers ? JSON.stringify(p.speakers) : null, p.speakerCount ?? null, now(), id).run();
    await settleCost(env, id, p.costUsd ?? 0);
    return json(env, { ok: true });
  }],

  ['POST', /^\/internal\/jobs\/([0-9a-f-]{36})\/reserve$/, async (req, env, [id]) => {
    requirePipeline(req, env);
    const { ceilingUsd } = await readJson<{ ceilingUsd: number }>(req);
    return json(env, { ok: await reserve(env, id, ceilingUsd) });
  }],

  ['POST', /^\/internal\/jobs\/([0-9a-f-]{36})\/result$/, async (req, env, [id]) => {
    requirePipeline(req, env);
    const r = await readJson<{ results: Results; speakers: Speaker[]; segments: Segment[]; notionMeta: NotionMeta; costUsd: number }>(req, 20_000_000);
    const names = Object.fromEntries(r.speakers.map((s) => [s.label, s.name ?? `Stimme ${s.label}`]));
    const transcript = r.segments.map((s) => `[${s.id} | ${formatTs(s.start)} | ${names[s.spk] ?? s.spk}] ${s.text}`).join('\n');
    const segIndex = r.segments.map((s) => [s.id, s.start, s.spk]);
    await env.DB.prepare(
      `UPDATE episodes SET status = 'fertig', progress = 100, eta_sec = NULL, error = NULL, results = ?, speakers = ?, notion_meta = ?,
       transcript = ?, seg_index = ?, updated_at = ? WHERE id = ?`,
    ).bind(JSON.stringify(r.results), JSON.stringify(r.speakers), JSON.stringify(r.notionMeta), transcript, JSON.stringify(segIndex), now(), id).run();
    await settleCost(env, id, r.costUsd);
    return json(env, { ok: true });
  }],

  ['POST', /^\/internal\/jobs\/([0-9a-f-]{36})\/fail$/, async (req, env, [id]) => {
    requirePipeline(req, env);
    const r = await readJson<{ status: Status; error: string; costUsd: number }>(req);
    await env.DB.prepare('UPDATE episodes SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .bind(r.status, r.error.slice(0, 500), now(), id).run();
    await settleCost(env, id, r.costUsd);
    return json(env, { ok: true });
  }],
];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    const { pathname } = new URL(req.url);
    try {
      for (const [method, re, handler] of routes) {
        const m = pathname.match(re);
        if (m && req.method === method) return await handler(req, env, m.slice(1));
      }
      return json(env, { error: 'Nicht gefunden.' }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json(env, { error: e.message }, e.status);
      console.error(e instanceof Error ? e.message : e);
      return json(env, { error: 'Da ist etwas schiefgegangen.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
