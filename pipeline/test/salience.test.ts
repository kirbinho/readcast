import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Segment } from '../../shared/src/types.ts';
import type { Art, Claim, QuoteCandidate, WindowResult } from '../src/extract.ts';
import { pickQuotes, scoreTopics } from '../src/salience.ts';
import type { Topic } from '../src/topics.ts';

// Eine 60-Minuten-Folge in Minutenabschnitten
function episode(plan: [string, Art, string][]): { segments: Segment[]; win: WindowResult } {
  const segments: Segment[] = plan.map((_, i) => ({ id: `s${String(i + 1).padStart(4, '0')}`, spk: i % 2 ? 'B' : 'A', start: i * 60_000, end: (i + 1) * 60_000, text: 'x' }));
  const win: WindowResult = { window: 0, art: new Map(), label: new Map(), claims: [], quotes: [] };
  plan.forEach(([, art, label], i) => {
    win.art.set(segments[i].id, art);
    win.label.set(segments[i].id, label);
  });
  return { segments, win };
}

const claim = (id: string, label: string, seg: string, over: Partial<Claim> = {}): Claim => ({
  id, window: 0, spk: 'A', segs: [seg], aussage: id, kontext: '', typ: 'einschaetzung', konkret: false, haltung: 'neutral', kern: true, label, ...over,
});

test('Sendezeit, Wiederkehr und Ankündigung bestimmen den Schwerpunkt; Werbung zählt nicht', () => {
  const plan: [string, Art, string][] = [];
  for (let i = 0; i < 3; i++) plan.push(['', 'werbung', '']);
  for (let i = 0; i < 25; i++) plan.push(['', 'inhalt', 'Cloud']);
  for (let i = 0; i < 2; i++) plan.push(['', 'inhalt', 'Reddit']);
  for (let i = 0; i < 10; i++) plan.push(['', 'inhalt', 'Oracle']);
  for (let i = 0; i < 2; i++) plan.push(['', 'smalltalk', '']);
  for (let i = 0; i < 8; i++) plan.push(['', 'inhalt', 'Cloud']);
  plan.push(['', 'inhalt', 'Randnotiz']);
  plan.push(['', 'moderation', '']);
  const { segments, win } = episode(plan);
  win.claims = [
    claim('c1', 'Cloud', 's0005'), claim('c2', 'Cloud', 's0010', { haltung: 'widerspruch', spk: 'B' }), claim('c3', 'Cloud', 's0020'),
    claim('c4', 'Reddit', 's0029'),
    claim('c5', 'Oracle', 's0032'), claim('c6', 'Oracle', 's0035', { konkret: true }),
    claim('c7', 'Randnotiz', 's0051', { kern: false }),
  ];
  const topics: Topic[] = [
    { id: 't1', title: 'Cloud', labels: ['w1:Cloud'], announced: true },
    { id: 't2', title: 'Reddit', labels: ['w1:Reddit'], announced: false },
    { id: 't3', title: 'Oracle', labels: ['w1:Oracle'], announced: true },
    { id: 't4', title: 'Randnotiz', labels: ['w1:Randnotiz'], announced: false },
  ];
  const sel = scoreTopics(topics, [win], segments);
  assert.deepEqual(sel.main.map((t) => t.topic.id), ['t1', 't3']);
  assert.deepEqual(sel.shorts.map((t) => t.topic.id), ['t2'], 'kurzes Thema mit tragender Aussage wird Kurzmeldung');
  assert.deepEqual(sel.dropped.map((t) => t.topic.id), ['t4'], 'eine Minute ohne tragende Aussage fällt raus');
  const cloud = sel.scored.find((t) => t.topic.id === 't1')!;
  assert.equal(cloud.visits, 2, 'Rückkehr zum Thema wird erkannt');
  assert.equal(sel.contentMs, 46 * 60_000, 'Werbung, Smalltalk und Moderation zählen nicht zur Inhaltszeit');
});

test('Jede Folge hat mindestens einen Schwerpunkt', () => {
  const { segments, win } = episode([['', 'inhalt', 'A'], ['', 'inhalt', 'A']]);
  win.claims = [claim('c1', 'A', 's0001', { kern: false })];
  const sel = scoreTopics([{ id: 't1', title: 'A', labels: ['w1:A'], announced: false }], [win], segments);
  assert.equal(sel.main.length, 1);
});

test('O-Töne über die ganze Folge verteilt, schwache fallen raus', () => {
  const segments: Segment[] = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, spk: 'A', start: i * 60_000, end: (i + 1) * 60_000, text: '' }));
  const q = (seg: number, m: number): QuoteCandidate => ({ id: `q${seg}`, spk: 'A', seg: `s${seg}`, text: '', meinung: m, pointe: m, zitierbar: m });
  // Viele starke O-Töne am Anfang, je einer in den anderen Fünfteln
  const quotes = [q(1, 5), q(2, 5), q(3, 5), q(5, 5), q(8, 5), q(11, 5), q(14, 5), q(17, 5), q(30, 4), q(50, 4), q(70, 4), q(95, 4), q(60, 2)];
  const picked = pickQuotes(quotes, segments);
  const fifths = new Set(picked.map((p) => Math.floor(Number(p.seg.slice(1)) / 20)));
  assert.equal(fifths.size, 5, 'jedes Fünftel ist vertreten');
  assert.ok(!picked.some((p) => p.seg === 's60'), 'schwacher Kandidat bleibt draußen');
  const ts = picked.map((p) => Number(p.seg.slice(1)));
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 4, 'kein Gedränge');
});
