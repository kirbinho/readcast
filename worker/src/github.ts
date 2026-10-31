// Startet die Pipeline in GitHub Actions. Das Token darf nur Workflows dieses Repositorys auslösen.

import type { Env } from './http.ts';

export async function dispatchPipeline(env: Env, jobId: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/pipeline.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'readcast-worker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { job: jobId } }),
  });
  if (!res.ok) throw new Error(`GitHub hat den Start abgelehnt (${res.status}).`);
}
