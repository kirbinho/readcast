import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSegments, voiceStats } from '../src/segments.ts';
import { decideRole, hostsFromShownotes, mergeSameNames } from '../src/speakers.ts';
import type { Utterance } from '../src/transcribe.ts';

test('lange Äußerungen werden an Satzenden geschnitten', () => {
  const words = Array.from({ length: 40 }, (_, i) => ({ text: i % 10 === 9 ? 'Ende.' : 'wort', start: i * 3000, end: i * 3000 + 2500, speaker: 'A' }));
  const u: Utterance = { speaker: 'A', text: words.map((w) => w.text).join(' '), start: 0, end: 120_000, words };
  const segs = toSegments([u]);
  assert.ok(segs.length >= 3);
  assert.ok(segs.every((s) => s.end - s.start <= 60_000));
  assert.ok(segs.slice(0, -1).every((s) => s.text.endsWith('Ende.')));
});

test('kurze Stimmen zählen nicht als Stimme', () => {
  const segs = toSegments([
    { speaker: 'A', text: 'a', start: 0, end: 1_500_000, words: [] },
    { speaker: 'B', text: 'b', start: 1_500_000, end: 2_900_000, words: [] },
    { speaker: 'C', text: 'Werbespot', start: 2_900_000, end: 2_930_000, words: [] },
  ]);
  const v = voiceStats(segs);
  assert.deepEqual(v.filter((x) => x.significant).map((x) => x.label), ['A', 'B']);
});

test('zwei Kennungen mit demselben Namen werden eine Stimme', () => {
  const segs = toSegments([
    { speaker: 'A', text: 'a', start: 0, end: 1000, words: [] },
    { speaker: 'C', text: 'c', start: 1000, end: 2000, words: [] },
  ]);
  const r = mergeSameNames(segs, [
    { label: 'A', name: 'Pip Klöckner', short: 'Klöckner', role: 'host', source: 'feed', shareOfTalk: 0.6 },
    { label: 'C', name: 'Pip Klöckner', short: 'Klöckner', role: 'host', source: 'feed', shareOfTalk: 0.4 },
  ]);
  assert.equal(r.speakers.length, 1);
  assert.ok(r.segments.every((s) => s.spk === 'A'));
});

test('Einspieler zählen nicht als Gesprächspartner', () => {
  const v = (shortTurns: number, significant = true) => ({ label: 'B', ms: 1, share: 0.1, significant, turns: shortTurns, shortTurns });
  assert.equal(decideRole(v(0), true, 'sonstige'), 'host', 'die lauteste Stimme führt durch die Folge');
  assert.equal(decideRole(v(1), false, 'sonstige'), 'sonstige', 'Konferenzredner');
  assert.equal(decideRole(v(1), false, 'gast'), 'sonstige', 'kein Wechsel im Gespräch, also kein Gast');
  assert.equal(decideRole(v(12), false, 'gast'), 'gast', 'echter Gesprächspartner');
  assert.equal(decideRole(v(12, false), false, 'gast'), 'sonstige', 'zu wenig Sprechzeit');
});

test('Kurze Wechsel werden gezählt, lange Blöcke nicht', () => {
  const seg = (spk: string, start: number, end: number) => ({ speaker: spk, text: spk, start, end, words: [] });
  const stats = voiceStats(toSegments([seg('A', 0, 300_000), seg('B', 300_000, 345_000), seg('A', 345_000, 600_000), seg('C', 600_000, 610_000), seg('A', 610_000, 620_000), seg('C', 620_000, 630_000)]));
  assert.equal(stats.find((s) => s.label === 'B')?.shortTurns, 0);
  assert.equal(stats.find((s) => s.label === 'C')?.shortTurns, 2);
});

test('Host aus den Shownotes', () => {
  const dave = 'ist eine Produktion von Studio Bummens.\n\nHost: Khesrau Behroz\nExecutive Producer: Tobias Bauckhage, Jon Handschin und Khesrau Behroz.';
  assert.deepEqual(hostsFromShownotes(dave), ['Khesrau Behroz']);
  assert.deepEqual(hostsFromShownotes('Moderation: Anna Beispiel und Bert Muster'), ['Anna Beispiel', 'Bert Muster']);
  assert.deepEqual(hostsFromShownotes('Executive Producer: Tobias Bauckhage'), []);
  assert.deepEqual(hostsFromShownotes('Heute geht es um Hosting bei Cloud-Anbietern.'), []);
  assert.deepEqual(hostsFromShownotes('Host der Sendung ist heute leider krank'), []);
});
