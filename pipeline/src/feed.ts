// RSS-Feed lesen und eine Folge darin finden.

import { XMLParser } from 'fast-xml-parser';
import { SafeError } from './errors.ts';
import type { EpisodeMeta, ShownoteLink } from '../../shared/src/types.ts';
import { domainOf, htmlToText, safeUrl } from '../../shared/src/text.ts';
import { titleSimilarity } from './similarity.ts';

export interface FeedItem {
  title: string;
  guid: string | null;
  pubDate: string | null;
  audioUrl: string | null;
  durationSec: number | null;
  html: string;
  link: string | null;
  image: string | null;
}

export interface Feed {
  url: string;
  title: string;
  author: string | null;
  language: string | null;
  image: string | null;
  items: FeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'item',
});

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)['#text']);
  return '';
}

export function parseDuration(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function looksLikeFeed(body: string, contentType: string): boolean {
  return /xml|rss/.test(contentType) || /^\s*(<\?xml[^>]*>\s*)?<rss[\s>]/i.test(body.slice(0, 2000));
}

export function parseFeed(xml: string, url: string): Feed {
  const doc = parser.parse(xml);
  const ch = doc?.rss?.channel;
  if (!ch) throw new SafeError('Kein RSS-Feed.');
  const items: FeedItem[] = (ch.item ?? []).map((it: Record<string, unknown>) => {
    const enc = it.enclosure as Record<string, string> | undefined;
    const img = it['itunes:image'] as Record<string, string> | undefined;
    const html = text(it['content:encoded']) || text(it.description) || text(it['itunes:summary']);
    return {
      title: text(it.title).trim(),
      guid: text(it.guid).trim() || null,
      pubDate: text(it.pubDate) || null,
      audioUrl: enc?.['@_url'] ?? null,
      durationSec: parseDuration(text(it['itunes:duration'])),
      html,
      link: text(it.link) || null,
      image: img?.['@_href'] ?? null,
    };
  });
  const chImg = ch['itunes:image'] as Record<string, string> | undefined;
  return {
    url,
    title: text(ch.title).trim(),
    author: text(ch['itunes:author']).trim() || null,
    language: text(ch.language).trim().slice(0, 2).toLowerCase() || null,
    image: chImg?.['@_href'] ?? text(ch.image?.url) ?? null,
    items,
  };
}

/** Sucht die Folge im Feed: zuerst über die GUID, dann die Audiodatei, dann den Titel. */
export function findItem(feed: Feed, hint: { guid?: string | null; audioUrl?: string | null; title?: string | null }): FeedItem | null {
  if (hint.guid) {
    const hit = feed.items.find((i) => i.guid === hint.guid);
    if (hit) return hit;
  }
  if (hint.audioUrl) {
    const base = hint.audioUrl.split('?')[0];
    const hit = feed.items.find((i) => i.audioUrl?.split('?')[0] === base);
    if (hit) return hit;
  }
  if (hint.title) {
    let best: FeedItem | null = null;
    let bestScore = 0;
    for (const i of feed.items) {
      const s = titleSimilarity(hint.title, i.title);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best && bestScore >= 0.6) return best;
  }
  return null;
}

const INVISIBLE = /[​-‍⁠﻿]/g;

export function extractLinks(html: string): ShownoteLink[] {
  const out: ShownoteLink[] = [];
  const seen = new Set<string>();
  const push = (href: string, label: string) => {
    const u = safeUrl(href.replace(INVISIBLE, ''));
    if (!u || seen.has(u.toString())) return;
    seen.add(u.toString());
    const title = htmlToText(label).replace(INVISIBLE, '').trim() || domainOf(u);
    out.push({ title: title.slice(0, 160), url: u.toString(), domain: domainOf(u) });
  };
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) push(m[1], m[2]);
  if (out.length === 0) {
    // Klartext-Shownotes: nackte Adressen einsammeln
    const plain = htmlToText(html).replace(INVISIBLE, '');
    for (const m of plain.matchAll(/https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?]/g)) push(m[0], '');
  }
  return out.slice(0, 25);
}

export function toMeta(feed: Feed, item: FeedItem, episodeUrl: string | null): EpisodeMeta {
  if (!item.audioUrl) throw new SafeError('Die Folge hat keine Audiodatei im Feed.');
  const published = item.pubDate ? new Date(item.pubDate) : null;
  return {
    show: feed.title,
    title: item.title,
    published: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
    durationSec: item.durationSec,
    audioUrl: item.audioUrl,
    image: item.image ?? feed.image,
    description: htmlToText(item.html).replace(INVISIBLE, '').slice(0, 20_000),
    links: extractLinks(item.html),
    feedUrl: feed.url,
    feedAuthor: feed.author,
    episodeUrl: episodeUrl ?? item.link,
    language: feed.language,
  };
}
