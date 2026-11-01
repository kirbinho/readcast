import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPage, splitTitle } from '../src/resolve.ts';
import { containment } from '../src/similarity.ts';

test('Seitentitel mit Folge und Sendung werden getrennt', () => {
  const r = splitTitle('Folge 39, Rita Shaqlawi: Biokunststoffe ~ Welt der Werkstoffe Podcast');
  assert.equal(r.titles[0], 'Folge 39, Rita Shaqlawi: Biokunststoffe');
  assert.equal(r.show, 'Welt der Werkstoffe');
});

test('Titel ohne Trenner bleibt ganz', () => {
  const r = splitTitle('Google, Microsoft, Amazon Earnings: Cloud boomt #610');
  assert.deepEqual(r.titles, ['Google, Microsoft, Amazon Earnings: Cloud boomt #610']);
  assert.equal(r.show, null);
});

test('Spotify: Sendung erkannt, die Hörprobe gilt nie als Folge', () => {
  const html = `<meta property="og:title" content="Eine Folge #1"/><meta property="og:description" content="Doppelgänger · Episode"/>
    <meta property="og:audio" content="https://p.scdn.co/mp3-preview/abc.mp3"/>`;
  const h = readPage(html, new URL('https://open.spotify.com/episode/x'));
  assert.equal(h.show, 'Doppelgänger');
  assert.equal(h.audioUrl, null);
});

test('Andere Seiten: Audiodatei und alle Feeds werden gelesen', () => {
  const html = `<title>Folge ~ Sendung Podcast</title><meta property="og:audio" content="https://cdn.example.com/a.mp3"/>
    <link rel="alternate" type="application/rss+xml" href="/feed/news"><link rel="alternate" type="application/rss+xml" href="https://example.org/podcast.xml">`;
  const h = readPage(html, new URL('https://example.com/episode/1'));
  assert.equal(h.audioUrl, 'https://cdn.example.com/a.mp3');
  assert.deepEqual(h.feedUrls, ['https://example.com/feed/news', 'https://example.org/podcast.xml']);
});

test('Folgentitel steckt im längeren Seitentitel', () => {
  assert.equal(containment('Rita Shaqlawi Biokunststoffe', 'Folge 39, Rita Shaqlawi: Biokunststoffe ~ Werkstoffe'), 1);
  assert.equal(containment('Ganz etwas anderes hier', 'Folge 39, Rita Shaqlawi'), 0);
});
