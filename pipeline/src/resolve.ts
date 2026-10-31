// Aus einem beliebigen Link zur Folge den RSS-Feed und die Folge darin finden.
// Woher der Link stammt, ist egal: Spotify, Apple, YouTube, Website oder der Feed selbst.

import type { EpisodeMeta } from '../../shared/src/types.ts';
import { htmlToText } from '../../shared/src/text.ts';
import { findItem, looksLikeFeed, parseFeed, toMeta, type Feed } from './feed.ts';
import { FetchError, assertPublicUrl, fetchJson, fetchText } from './net.ts';
import { titleSimilarity } from './similarity.ts';

export class NotFoundError extends Error {}

interface AppleResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  collectionId?: number;
  trackName?: string;
  collectionName?: string;
  feedUrl?: string;
  episodeUrl?: string;
  episodeGuid?: string;
  trackViewUrl?: string;
}

interface PageHints {
  title: string | null; // Titel der Folge
  show: string | null; // Name der Sendung, falls erkennbar
  audioUrl: string | null;
  feedUrl: string | null;
}

const feedCache = new Map<string, Feed>();

async function loadFeed(url: string): Promise<Feed> {
  const cached = feedCache.get(url);
  if (cached) return cached;
  const { text, finalUrl } = await fetchText(url, { accept: 'application/rss+xml, application/xml, text/xml' });
  const feed = parseFeed(text, finalUrl);
  feedCache.set(url, feed);
  return feed;
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? htmlToText(v) : null;
}

function readPage(html: string, url: URL): PageHints {
  const ogTitle = meta(html, 'og:title');
  const docTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  let title = ogTitle ?? (docTitle ? htmlToText(docTitle) : null);
  let show = meta(html, 'og:site_name');
  const desc = meta(html, 'og:description') ?? '';

  if (/spotify\.com$/.test(url.hostname)) {
    // „Listen to this episode from <Show> on Spotify.“ oder deutsch „… von <Show> auf Spotify …“
    const m = desc.match(/episode from (.+?) on Spotify/i) ?? desc.match(/Folge von (.+?) (?:auf|bei) Spotify/i);
    show = m?.[1] ?? null;
    title = title?.replace(/\s*\|\s*Podcast on Spotify$/i, '') ?? null;
  }
  if (/youtube\.com$|youtu\.be$/.test(url.hostname)) show = null; // Kanalname kommt aus oEmbed
  const feedHref = html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]*href=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/rss\+xml["']/i)?.[1];
  const audio = meta(html, 'og:audio') ?? meta(html, 'og:audio:url');
  return {
    title: title?.trim() || null,
    show: show?.trim() || null,
    audioUrl: audio,
    feedUrl: feedHref ? new URL(feedHref, url).toString() : null,
  };
}

async function youtubeAuthor(url: string): Promise<string | null> {
  try {
    const o = await fetchJson<{ author_name?: string }>(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    return o.author_name ?? null;
  } catch {
    return null;
  }
}

async function appleSearchEpisodes(term: string): Promise<AppleResult[]> {
  const q = encodeURIComponent(term.slice(0, 200));
  const out: AppleResult[] = [];
  for (const country of ['DE', 'US']) {
    const r = await fetchJson<{ results: AppleResult[] }>(
      `https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=25&country=${country}&term=${q}`,
    );
    out.push(...r.results);
    if (out.length) break;
  }
  return out;
}

async function fromApple(url: URL): Promise<EpisodeMeta | null> {
  const showId = url.pathname.match(/id(\d+)/)?.[1];
  const episodeId = url.searchParams.get('i');
  if (!showId) return null;
  const r = await fetchJson<{ results: AppleResult[] }>(
    `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&limit=300&country=DE`,
  );
  const show = r.results.find((x) => x.wrapperType === 'track');
  if (!show?.feedUrl) return null;
  const feed = await loadFeed(show.feedUrl);
  const ep = episodeId ? r.results.find((x) => String(x.trackId) === episodeId) : null;
  if (episodeId && !ep) {
    // Ältere Folgen fehlen in der Liste: Titel von der Seite lesen
    const page = await fetchText(url.toString(), { maxBytes: 5_000_000 });
    const hints = readPage(page.text, url);
    const item = findItem(feed, { title: hints.title });
    return item ? toMeta(feed, item, url.toString()) : null;
  }
  const item = ep ? findItem(feed, { guid: ep.episodeGuid, audioUrl: ep.episodeUrl, title: ep.trackName }) : feed.items[0];
  return item ? toMeta(feed, item, url.toString()) : null;
}

async function viaSearch(hints: PageHints, link: string): Promise<EpisodeMeta | null> {
  if (!hints.title) return null;
  const term = hints.show ? `${hints.show} ${hints.title}` : hints.title;
  let results = await appleSearchEpisodes(term);
  if (!results.length && hints.show) results = await appleSearchEpisodes(hints.title);
  const scored = results
    .filter((r) => r.feedUrl && r.trackName)
    .map((r) => ({
      r,
      score: titleSimilarity(hints.title!, r.trackName!) + (hints.show && r.collectionName ? 0.3 * titleSimilarity(hints.show, r.collectionName) : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.6) return null;
  const feed = await loadFeed(best.r.feedUrl!);
  const item = findItem(feed, { guid: best.r.episodeGuid, audioUrl: best.r.episodeUrl, title: best.r.trackName });
  return item ? toMeta(feed, item, link) : null;
}

export async function resolveEpisode(link: string): Promise<EpisodeMeta> {
  const url = assertPublicUrl(link.trim());
  try {
    if (/podcasts\.apple\.com$/.test(url.hostname)) {
      const m = await fromApple(url);
      if (m) return m;
    }
    const page = await fetchText(url.toString(), { maxBytes: 40_000_000 });
    if (looksLikeFeed(page.text, page.contentType)) {
      // Link auf den Feed selbst: die neueste Folge
      const feed = parseFeed(page.text, page.finalUrl);
      feedCache.set(url.toString(), feed);
      const item = feed.items.find((i) => i.audioUrl);
      if (item) return toMeta(feed, item, null);
      throw new NotFoundError('Im Feed steht keine Folge mit Audio.');
    }
    const hints = readPage(page.text, new URL(page.finalUrl));
    if (/youtube\.com$|youtu\.be$/.test(url.hostname)) hints.show = await youtubeAuthor(url.toString());
    if (hints.feedUrl) {
      const feed = await loadFeed(hints.feedUrl);
      const item = findItem(feed, { audioUrl: hints.audioUrl, title: hints.title });
      if (item) return toMeta(feed, item, link);
    }
    const found = await viaSearch(hints, link);
    if (found) return found;
  } catch (e) {
    if (e instanceof NotFoundError) throw e;
    if (e instanceof FetchError) throw new NotFoundError(e.message);
    throw e;
  }
  throw new NotFoundError('Zu diesem Link gibt es keinen öffentlichen Feed.');
}
