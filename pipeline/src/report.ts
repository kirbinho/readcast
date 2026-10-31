// Meldungen der Pipeline an den Worker. Nur dieser Weg führt Ergebnisse zurück,
// damit nichts davon in den öffentlichen Protokollen von GitHub Actions landet.

import type { EpisodeMeta, NotionMeta, Results, Segment, Speaker, Status } from '../../shared/src/types.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} fehlt.`);
  return v;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env('READCAST_API_URL')}/internal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${env('PIPELINE_SECRET')}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Worker antwortet mit ${res.status} auf ${path}.`);
  return (await res.json()) as T;
}

export const getJob = (id: string) => call<{ id: string; link: string }>(`/jobs/${id}`);

export const progress = (
  id: string,
  p: { status: Status; progress: number; etaSec?: number | null; meta?: EpisodeMeta; speakers?: Speaker[]; speakerCount?: number },
) => call<{ ok: true }>(`/jobs/${id}/progress`, p);

export const budgetCheck = (id: string, estimateUsd: number) => call<{ ok: boolean }>(`/jobs/${id}/budget`, { estimateUsd });

export const finish = (
  id: string,
  r: { results: Results; speakers: Speaker[]; segments: Segment[]; notionMeta: NotionMeta; costUsd: number },
) => call<{ ok: true }>(`/jobs/${id}/result`, r);

export const fail = (id: string, r: { status: Status; error: string; costUsd: number }) => call<{ ok: true }>(`/jobs/${id}/fail`, r);
