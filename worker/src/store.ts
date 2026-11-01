// Lesen und Schreiben der Folgen in D1.

import type { Budget, EpisodeView, ModeKey, QaEntry, RecentItem, Status } from '../../shared/src/types.ts';
import { LAUFEND } from '../../shared/src/types.ts';
import { HttpError, type Env, monthKey, now } from './http.ts';

export interface EpisodeRow {
  id: string;
  user_id: string;
  link: string;
  link_norm: string;
  status: Status;
  progress: number;
  eta_sec: number | null;
  error: string | null;
  meta: string | null;
  speakers: string | null;
  speaker_count: number | null;
  results: string | null;
  notion_meta: string | null;
  transcript: string | null;
  seg_index: string | null;
  notion_page_id: string | null;
  notion_page_url: string | null;
  notion_modes: string;
  notion_last: string | null;
  cost_usd: number;
  reserved_usd: number;
  created_at: string;
  updated_at: string;
}

const STALE_MS = 90 * 60_000;

/** Gleiche Folge, gleicher Schlüssel: Tracking-Parameter und Schreibweisen fallen weg. */
export function normalizeLink(link: string): string {
  try {
    const u = new URL(link.trim());
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|si$|uo$|ref|context|nd$|go$)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    return u.toString().replace(/\/$/, '');
  } catch {
    return link.trim();
  }
}

const LIGHT_COLUMNS = `id, user_id, link, link_norm, status, progress, eta_sec, error, meta, speakers, speaker_count, results,
  notion_meta, notion_page_id, notion_page_url, notion_modes, notion_last, cost_usd, reserved_usd, created_at, updated_at,
  NULL AS transcript, NULL AS seg_index`;

/** Ohne `withTranscript` bleibt das Transkript in der Datenbank, das spart Zeit beim regelmäßigen Nachfragen. */
export async function getRow(env: Env, id: string, userId?: string, withTranscript = false): Promise<EpisodeRow> {
  const row = await env.DB.prepare(`SELECT ${withTranscript ? '*' : LIGHT_COLUMNS} FROM episodes WHERE id = ?`).bind(id).first<EpisodeRow>();
  if (!row || (userId && row.user_id !== userId)) throw new HttpError(404, 'Diese Folge gibt es nicht.');
  // Hängengebliebene Aufträge laufen ab
  if (LAUFEND.includes(row.status) && Date.now() - Date.parse(row.updated_at) > STALE_MS) {
    await env.DB.prepare("UPDATE episodes SET status = 'fehler', error = ?, updated_at = ? WHERE id = ?")
      .bind('Das Auslesen ist hängen geblieben. Versuch es noch einmal.', now(), id)
      .run();
    return { ...row, status: 'fehler', error: 'Das Auslesen ist hängen geblieben. Versuch es noch einmal.' };
  }
  return row;
}

export async function view(env: Env, row: EpisodeRow): Promise<EpisodeView> {
  const qa = await env.DB.prepare('SELECT q, found, answer, cites, created_at FROM qa WHERE episode_id = ? ORDER BY id DESC LIMIT 50')
    .bind(row.id)
    .all<{ q: string; found: number; answer: string; cites: string; created_at: string }>();
  const last = row.notion_last ? (JSON.parse(row.notion_last) as { blockIds: string[]; createdPage: boolean }) : null;
  return {
    id: row.id,
    link: row.link,
    status: row.status,
    progress: row.progress,
    etaSec: row.eta_sec,
    error: row.error,
    meta: row.meta ? JSON.parse(row.meta) : null,
    speakers: row.speakers ? JSON.parse(row.speakers) : [],
    speakerCount: row.speaker_count,
    results: row.results ? JSON.parse(row.results) : null,
    qa: qa.results.map((r): QaEntry => ({ q: r.q, found: !!r.found, answer: r.answer, cites: JSON.parse(r.cites), at: r.created_at })),
    notion: { pageUrl: row.notion_page_url, modes: JSON.parse(row.notion_modes) as ModeKey[], canUndo: !!last },
    createdAt: row.created_at,
  };
}

export async function recents(env: Env, userId: string): Promise<RecentItem[]> {
  const rows = await env.DB.prepare(
    `SELECT id, status, meta, notion_modes FROM episodes
     WHERE user_id = ? AND status IN ('fertig','wartet','sucht','hoert','liest','schreibt')
     ORDER BY created_at DESC LIMIT 30`,
  )
    .bind(userId)
    .all<{ id: string; status: Status; meta: string | null; notion_modes: string }>();
  return rows.results.map((r) => {
    const m = r.meta ? JSON.parse(r.meta) : null;
    return {
      id: r.id,
      show: m?.show ?? null,
      title: m?.title ?? null,
      published: m?.published ?? null,
      durationSec: m?.durationSec ?? null,
      status: r.status,
      inNotion: (JSON.parse(r.notion_modes) as string[]).length > 0,
      image: m?.image ?? null,
    };
  });
}

const RUNNING_SQL = "('wartet','sucht','hoert','liest','schreibt')";
const staleCutoff = () => new Date(Date.now() - STALE_MS).toISOString();

/** Überträgt die bisherigen Kosten eines Auftrags (Gesamtsumme) ins Monatsbudget. Doppelt melden schadet nicht. */
export async function settleCost(env: Env, id: string, totalUsd: number): Promise<void> {
  if (!(totalUsd > 0)) return;
  const row = await env.DB.prepare('SELECT cost_usd FROM episodes WHERE id = ?').bind(id).first<{ cost_usd: number }>();
  const delta = totalUsd - (row?.cost_usd ?? 0);
  if (!(delta > 0)) return;
  await env.DB.batch([
    env.DB.prepare('UPDATE episodes SET cost_usd = ? WHERE id = ?').bind(totalUsd, id),
    env.DB.prepare('INSERT INTO spend (month, usd) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET usd = usd + excluded.usd').bind(monthKey(), delta),
  ]);
}

export async function addSpend(env: Env, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  await env.DB.prepare('INSERT INTO spend (month, usd) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET usd = usd + excluded.usd')
    .bind(monthKey(), usd)
    .run();
}

function capUsd(env: Env): { capEur: number; rate: number; capUsd: number } {
  const rate = Number(env.EUR_PER_USD) || 0.95;
  const capEur = Number(env.CAP_EUR) || 10;
  return { capEur, rate, capUsd: capEur / rate };
}

export async function budget(env: Env): Promise<Budget & { spentUsd: number; capUsd: number; availableUsd: number }> {
  const row = await env.DB.prepare(
    `SELECT COALESCE((SELECT usd FROM spend WHERE month = ?1), 0) AS spent,
       COALESCE((SELECT SUM(MAX(reserved_usd - cost_usd, 0)) FROM episodes WHERE status IN ${RUNNING_SQL} AND updated_at > ?2), 0) AS reserved`,
  ).bind(monthKey(), staleCutoff()).first<{ spent: number; reserved: number }>();
  const c = capUsd(env);
  const spentUsd = row?.spent ?? 0;
  return {
    spentEur: Math.round(spentUsd * c.rate * 100) / 100,
    capEur: c.capEur,
    spentUsd,
    capUsd: c.capUsd,
    availableUsd: c.capUsd - spentUsd - (row?.reserved ?? 0),
  };
}

/**
 * Reserviert die Höchstkosten einer Folge, nur wenn sie zusammen mit den bisherigen Ausgaben
 * und den Reservierungen laufender Folgen ins Monatsbudget passen. Eine einzige Anweisung,
 * damit zwei gleichzeitige Folgen nicht beide durchrutschen.
 */
export async function reserve(env: Env, id: string, ceilingUsd: number): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE episodes SET reserved_usd = ?1, updated_at = ?2 WHERE id = ?3
     AND COALESCE((SELECT usd FROM spend WHERE month = ?4), 0)
       + COALESCE((SELECT SUM(MAX(e.reserved_usd - e.cost_usd, 0)) FROM episodes e WHERE e.id <> ?3 AND e.status IN ${RUNNING_SQL} AND e.updated_at > ?5), 0)
       + MAX(?1 - cost_usd, 0) <= ?6`,
  ).bind(ceilingUsd, now(), id, monthKey(), staleCutoff(), capUsd(env).capUsd).run();
  return r.meta.changes === 1;
}
