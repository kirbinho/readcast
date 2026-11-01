// Probe-API für die lokale Entwicklung der Web-App, ohne Cloudflare, Claude oder Notion.
// Start: npm run mock, dann in web/: VITE_API_URL=http://localhost:8788 npm run dev

import { createServer } from 'node:http';
import type { EpisodeView, QaEntry, RecentItem, Results, Speaker } from '../shared/src/types.ts';

const speakers: Speaker[] = [
  { label: 'A', name: 'Philipp Klöckner', short: 'Klöckner', role: 'host', source: 'shownotes', shareOfTalk: 0.52 },
  { label: 'B', name: 'Philipp Glöckler', short: 'Glöckler', role: 'host', source: 'shownotes', shareOfTalk: 0.46 },
  { label: 'C', name: null, short: 'Stimme C', role: 'sonstige', source: null, shareOfTalk: 0.02 },
];

const s = (text: string, segs = ['s0001']) => ({ text, segs });
const results: Results = {
  essenz: {
    blocks: [
      { heading: '[Themenblock 1, als Aussage formuliert]', sentences: [s('[Die wichtigsten Aussagen zum Thema, eingeordnet, ohne Folgerungen, die so nicht gesagt wurden.]')], ts: 520_000, quote: null },
      { heading: '[Themenblock 2, als Aussage formuliert]', sentences: [s('[Gleicher Aufbau. Wie viele Blöcke es gibt, hängt von der Folge ab.]')], ts: 1_635_000, quote: null },
      { heading: '[Themenblock 3, als Aussage formuliert]', sentences: [s('[Gleicher Aufbau.]')], ts: 3_123_000, quote: null },
    ],
    shorts: [
      { heading: '[Kurzmeldung, als Headline]', sentences: [s('[Höchstens 150 Wörter. Nur, was über der Schwelle liegt.]')], ts: 4_290_000 },
    ],
  },
  zehn: Array.from({ length: 10 }, (_, i) => ({ text: `[O-Ton ${i + 1}, wörtlich, höchstens zwei Sätze.]`, spk: i % 2 ? 'B' : 'A', ts: (i + 1) * 470_000 })),
  personen: {
    A: { blocks: [{ heading: '[Erstes Thema, als Aussage formuliert]', sentences: [s('[Was Klöckner dazu sagt, verdichtet.]')], ts: 872_000, quote: { text: '[Wörtliches Zitat, höchstens zwei Sätze.]', spk: 'A', ts: 1_025_000 } }] },
    B: { blocks: [{ heading: '[Erstes Thema, als Aussage formuliert]', sentences: [s('[Was Glöckler dazu sagt, verdichtet.]')], ts: 912_000, quote: null }] },
  },
};

const meta = {
  show: 'Doppelgänger',
  title: '[Titel der Folge, so wie er im Feed steht]',
  published: '2026-10-27T23:05:00.000Z',
  durationSec: 4550,
  audioUrl: 'https://example.com/a.mp3',
  image: null,
  description: '[Beschreibung der Folge, wörtlich aus dem Feed übernommen.]\n\n(00:00:00) [Kapitel 1]\n(00:19:26) [Kapitel 2]',
  links: [
    { title: '[Link 1 aus den Shownotes]', url: 'https://example.com/1', domain: 'example.com' },
    { title: '[Link 2 aus den Shownotes]', url: 'https://example.org/2', domain: 'example.org' },
  ],
  feedUrl: 'https://example.com/feed',
  feedAuthor: 'Philipp Glöckler, Philipp Klöckner',
  episodeUrl: null,
  language: 'de',
};

const episodes = new Map<string, EpisodeView & { startedAt: number }>();
const mk = (id: string, ready: boolean): EpisodeView & { startedAt: number } => ({
  id,
  link: 'https://podcasts.apple.com/…',
  status: ready ? 'fertig' : 'wartet',
  progress: ready ? 100 : 0,
  etaSec: null,
  error: null,
  duplicateOf: null,
  meta: ready ? meta : null,
  speakers: ready ? speakers : [],
  speakerCount: ready ? 2 : null,
  results: ready ? results : null,
  qa: [] as QaEntry[],
  notion: { pageUrl: null, modes: [], canUndo: false },
  createdAt: new Date().toISOString(),
  startedAt: Date.now(),
});
episodes.set('11111111-1111-4111-8111-111111111111', mk('11111111-1111-4111-8111-111111111111', true));

function advance(e: EpisodeView & { startedAt: number }) {
  if (e.status === 'fertig') return;
  const t = (Date.now() - e.startedAt) / 1000;
  const steps: [number, EpisodeView['status'], number][] = [[0, 'sucht', 3], [3, 'hoert', 10], [15, 'liest', 55], [22, 'schreibt', 85], [28, 'fertig', 100]];
  const [, status, progress] = [...steps].reverse().find(([at]) => t >= at)!;
  e.status = status;
  e.progress = status === 'hoert' ? Math.round(10 + (t - 3) * 3.5) : progress;
  e.etaSec = Math.max(30, Math.round(30 - t) * 8);
  if (t >= 3) e.meta = meta;
  if (t >= 15) {
    e.speakers = speakers;
    e.speakerCount = 2;
  }
  if (status === 'fertig') e.results = results;
}

createServer(async (req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204, {});
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const url = req.url ?? '';
  const m = url.match(/^\/api\/episodes\/([0-9a-f-]{36})(\/.*)?$/);

  if (url === '/api/login') return body.code === 'probe-zugang-1234567890' ? send(200, { token: 'probe', name: 'Tobi' }) : send(401, { error: 'Dieser Zugangscode stimmt nicht.' });
  if (url === '/api/me') {
    const recents: RecentItem[] = [...episodes.values()].map((e) => ({ id: e.id, show: e.meta?.show ?? null, title: e.meta?.title ?? null, published: e.meta?.published ?? null, durationSec: e.meta?.durationSec ?? null, status: e.status, inNotion: e.notion.modes.length > 0, image: null }));
    return send(200, { name: 'Tobi', budget: { spentEur: 3.4, capEur: 10 }, recents });
  }
  if (url === '/api/episodes' && req.method === 'POST') {
    if (String(body.link).includes('exklusiv')) {
      const id = crypto.randomUUID();
      episodes.set(id, { ...mk(id, false), status: 'nicht_gefunden' });
      return send(201, { id });
    }
    const id = crypto.randomUUID();
    episodes.set(id, mk(id, false));
    return send(201, { id });
  }
  if (m) {
    const e = episodes.get(m[1]);
    if (!e) return send(404, { error: 'Diese Folge gibt es nicht.' });
    if (!m[2]) {
      advance(e);
      const { startedAt: _, ...view } = e;
      return send(200, view);
    }
    if (m[2] === '/ask') {
      const entry: QaEntry = { q: body.q, found: true, answer: '[Antwort nur aus dem Transkript. Kommt das Thema nicht vor, steht genau das hier.]', cites: [{ spk: 'Klöckner', ts: 1_990_000 }], at: new Date().toISOString() };
      e.qa.unshift(entry);
      return send(200, entry);
    }
    if (m[2] === '/notion') {
      e.notion = { pageUrl: 'https://www.notion.so/', modes: [...new Set([...e.notion.modes, ...body.modes])], canUndo: true };
      return send(200, { pageUrl: e.notion.pageUrl, added: body.modes, modes: e.notion.modes });
    }
    if (m[2] === '/notion/undo') {
      e.notion = { pageUrl: null, modes: [], canUndo: false };
      return send(200, { remaining: 0, modes: [] });
    }
  }
  send(404, { error: 'Nicht gefunden.' });
}).listen(8788, () => console.log('Probe-API auf http://localhost:8788 · Zugangscode: probe-zugang-1234567890'));
