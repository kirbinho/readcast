import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLinks, findItem, parseDuration, parseFeed } from '../src/feed.ts';
import { parseChapters } from '../src/topics.ts';
import { assertPublicUrl } from '../src/net.ts';

const xml = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Testshow</title><language>de-DE</language><itunes:author>A &amp; B</itunes:author>
<item><title>Folge zwei: Über Börsen #2</title><guid>g2</guid><enclosure url="https://cdn.example.com/2.mp3?x=1" type="audio/mpeg"/><itunes:duration>01:15:50</itunes:duration>
<content:encoded><![CDATA[<p>Text <a href="https://example.com/x">Ein Artikel</a></p>]]></content:encoded></item>
<item><title>Folge eins</title><guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/><itunes:duration>3600</itunes:duration><description>Nur Text https://example.org/quelle.</description></item>
</channel></rss>`;

test('Feed lesen und Folge finden', () => {
  const feed = parseFeed(xml, 'https://example.com/feed');
  assert.equal(feed.title, 'Testshow');
  assert.equal(feed.language, 'de');
  assert.equal(feed.items[0].durationSec, 4550);
  assert.equal(findItem(feed, { guid: 'g1' })?.title, 'Folge eins');
  assert.equal(findItem(feed, { audioUrl: 'https://cdn.example.com/2.mp3?tracking=9' })?.guid, 'g2');
  assert.equal(findItem(feed, { title: 'Über Börsen – Folge zwei #2' })?.guid, 'g2');
  assert.equal(findItem(feed, { title: 'Ganz etwas anderes' }), null);
});

test('Links aus Shownotes', () => {
  assert.deepEqual(extractLinks('<a href="https://www.example.com/x">Ein Artikel</a><a href="javascript:x">böse</a>'), [
    { title: 'Ein Artikel', url: 'https://www.example.com/x', domain: 'example.com' },
  ]);
  assert.equal(extractLinks('Nur Text https://example.org/quelle.')[0].url, 'https://example.org/quelle');
});

test('Dauer', () => {
  assert.equal(parseDuration('45:10'), 2710);
  assert.equal(parseDuration(''), null);
});

test('Kapitelmarken', () => {
  const ch = parseChapters('Intro\n(00:00:00) Alphabet-Zahlen\n(00:19:26) KI-Suchanzeigen\n1:03:39 Spionin');
  assert.deepEqual(ch.map((c) => c.ts), [0, 1_166_000, 3_819_000]);
});

test('keine internen Adressen', () => {
  assert.throws(() => assertPublicUrl('http://169.254.169.254/latest'));
  assert.throws(() => assertPublicUrl('http://localhost:3000'));
  assert.throws(() => assertPublicUrl('file:///etc/passwd'));
  assert.ok(assertPublicUrl('https://podcasts.apple.com/de/podcast/x/id1'));
});
