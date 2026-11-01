import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepExistingProperties } from '../src/wissen.ts';
import { formatTs, htmlToText, isVerbatim, normalizeForMatch, safeUrl } from '../src/text.ts';

test('Zeitstempel', () => {
  assert.equal(formatTs(0), '00:00');
  assert.equal(formatTs(872_000), '14:32');
  assert.equal(formatTs(3_872_000), '1:04:32');
});

test('wörtlicher Abgleich ignoriert Satzzeichen und Großschreibung, aber nicht Wörter', () => {
  const src = 'Ich glaube, das ist der größte Fehler, den Google je gemacht hat. Wirklich.';
  assert.ok(isVerbatim('„Das ist der größte Fehler, den Google je gemacht hat.“', src));
  assert.ok(!isVerbatim('Das ist der größte Fehler, den Microsoft je gemacht hat.', src));
  assert.ok(!isVerbatim('Das ist der Fehler, den Google je gemacht hat.', src));
  assert.ok(!isVerbatim('Ich glaube', src), 'zu kurz für einen O-Ton');
});

test('Normalisierung', () => {
  assert.equal(normalizeForMatch('  „Hallo,   Welt!“ '), 'hallo welt');
});

test('Shownotes ohne HTML', () => {
  assert.equal(htmlToText('<p>Eins &amp; zwei</p><ul><li>drei</li></ul>'), 'Eins & zwei\n• drei');
});

test('nur Web-Links', () => {
  assert.ok(safeUrl('https://example.com/a'));
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('kein link'), null);
});

test('Nur vorhandene Notion-Felder werden geschrieben', () => {
  const r = keepExistingProperties({ Titel: 1, Haltbarkeit: 2, Haltbarkeitsnotiz: 3 }, ['Titel', 'Thema']);
  assert.deepEqual(r.kept, { Titel: 1 });
  assert.deepEqual(r.dropped, ['Haltbarkeit', 'Haltbarkeitsnotiz']);
});
