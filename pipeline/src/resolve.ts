// Aus einem beliebigen Link zur Folge den RSS-Feed und die Folge darin finden.
// Woher der Link stammt, ist egal: Spotify, Apple, YouTube, Website oder der Feed selbst.

import type { EpisodeMeta } from '../../shared/src/types.ts';
import { htmlToText } from '../../shared/src/text.ts';
import { findItem, looksLikeFeed, parseFeed, toMeta, type Feed } from './feed.ts';
import { FetchError, assertPublicUrl, fetchJson, fetchText } from './net.ts';
import { containment, titleSimilarity } from './similarity.ts';

// Das Protokoll ist öffentlich: nur Wege und Zahlen, nie Link, Titel oder Sendung
const log = (text: string) => console.log(`[Suche] ${text}`);

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
  titles: string[]; // mögliche Folgentitel, der wahrscheinlichste zuerst
  pageTitle: string | null; // vollständiger Seitentitel
  show: string | null; // Name der Sendung, falls erkennbar
  audioUrl: string | null; // vollständige Audiodatei, falls die Seite eine nennt
  feedUrls: string[];
  image: string | null;
  description: string | null;
  published: string | null;
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

const STRONG_SEPARATOR = /\s+[~|•·]\s+/;
const WEAK_SEPARATOR = /\s+[-–—]\s+/;

/** Seitentitel mischen oft Folge und Sendung: „Folge ~ Sendung Podcast“ oder „Folge | Sendung“. */
export function splitTitle(raw: string): { titles: string[]; show: string | null } {
  const strong = raw.split(STRONG_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  const weak = raw.split(WEAK_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  const titles = [...new Set([strong[0], raw, ...weak.filter((p) => p.split(/\s+/).length >= 3)])].filter(Boolean).slice(0, 4);
  const show = strong.length > 1 ? strong[strong.length - 1].replace(/\s+podcast$/i, '').trim() : null;
  return { titles, show: show || null };
}

export function readPage(html: string, url: URL): PageHints {
  const ogTitle = meta(html, 'og:title');
  const docTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const pageTitle = (ogTitle ?? (docTitle ? htmlToText(docTitle) : '')).trim() || null;
  const split = pageTitle ? splitTitle(pageTitle) : { titles: [], show: null };
  const desc = meta(html, 'og:description') ?? '';
  let show = split.show;
  let audio = meta(html, 'og:audio') ?? meta(html, 'og:audio:url') ?? meta(html, 'twitter:player:stream');
  audio ??= html.match(/<(?:audio|source)\b[^>]*\bsrc=["'](https?:[^"']+\.(?:mp3|m4a|aac|ogg)[^"']*)["']/i)?.[1] ?? null;

  if (/spotify\.com$/.test(url.hostname)) {
    // „Sendung · Episode“, älter: „Listen to this episode from Sendung on Spotify.“
    const m = desc.match(/^(.+?)\s+·\s+(?:Episode|Folge)\b/i) ?? desc.match(/episode from (.+?) on Spotify/i) ?? desc.match(/Folge von (.+?) (?:auf|bei) Spotify/i);
    show = m?.[1]?.trim() ?? null;
    // Spotify nennt nur eine kurze Hörprobe, nie die ganze Folge
    audio = null;
  }
  if (/youtube\.com$|youtu\.be$/.test(url.hostname)) {
    show = null; // Kanalname kommt aus oEmbed
    audio = null;
  }
  if (audio && /preview/i.test(audio)) audio = null;

  const feedUrls: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*application\/rss\+xml[^>]*>/gi)) {
    const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
    if (href) feedUrls.push(new URL(href, url).toString());
  }
  return {
    titles: split.titles,
    pageTitle,
    show,
    audioUrl: audio,
    feedUrls: feedUrls.slice(0, 3),
    image: meta(html, 'og:image'),
    description: desc || null,
    published: meta(html, 'article:published_time') ?? meta(html, 'music:release_date'),
  };
}

/** Liefert Spotify keine Angaben auf der Seite, nennt die offizielle oEmbed-Schnittstelle wenigstens den Titel. */
async function addSpotifyTitle(hints: PageHints, url: URL): Promise<void> {
  try {
    const o = await fetchJson<{ title?: string }>(`https://open.spotify.com/oembed?url=${encodeURIComponent(url.toString())}`);
    if (o.title) {
      hints.titles = [o.title];
      hints.pageTitle = o.title;
    }
  } catch (e) {
    log(`Spotify oEmbed: ${e instanceof Error ? e.message : 'Fehler'}`);
  }
}

/** Ist die Sendung bekannt, führt ihr Feed direkt zur Folge. Die Episodensuche kennt nicht jede neue Folge. */
async function viaShow(hints: PageHints, link: string): Promise<EpisodeMeta | null> {
  if (!hints.show) return null;
  const q = encodeURIComponent(hints.show.slice(0, 200));
  const r = await fetchJson<{ results: AppleResult[] }>(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&country=DE&term=${q}`);
  const shows = r.results.filter((x) => x.feedUrl && x.collectionName && titleSimilarity(hints.show!, x.collectionName) >= 0.5);
  log(`Sendungssuche: ${shows.length} passende Sendungen`);
  for (const s of shows.slice(0, 3)) {
    try {
      const feed = await loadFeed(s.feedUrl!);
      for (const title of hints.titles) {
        const item = findItem(feed, { audioUrl: hints.audioUrl, title });
        if (item?.audioUrl) return toMeta(feed, item, link);
      }
    } catch {
      log('Ein Feed der Sendung ließ sich nicht lesen');
    }
  }
  return null;
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
    const item = findItem(feed, { title: hints.titles[0] ?? null });
    return item ? toMeta(feed, item, url.toString()) : null;
  }
  const item = ep ? findItem(feed, { guid: ep.episodeGuid, audioUrl: ep.episodeUrl, title: ep.trackName }) : feed.items[0];
  return item ? toMeta(feed, item, url.toString()) : null;
}

/** Sucht die Folge über die Apple-Podcast-Suche, die jeden öffentlichen Feed kennt. */
async function viaSearch(hints: PageHints, link: string): Promise<EpisodeMeta | null> {
  const whole = hints.pageTitle ?? '';
  const titleScore = (name: string) =>
    Math.max(...hints.titles.map((t) => titleSimilarity(t, name)), 0.95 * containment(name, whole));
  const seen = new Map<number | string, AppleResult>();
  for (const title of hints.titles.slice(0, 3)) {
    const terms = hints.show ? [`${hints.show} ${title}`, title] : [title];
    for (const term of terms) {
      try {
        for (const r of await appleSearchEpisodes(term)) seen.set(r.trackId ?? `${r.collectionId}:${r.trackName}`, r);
      } catch (e) {
        log(`Apple-Suche: ${e instanceof Error ? e.message : 'Fehler'}`);
      }
    }
    if ([...seen.values()].some((r) => r.trackName && titleScore(r.trackName) >= 0.9)) break;
  }
  const audioBase = hints.audioUrl?.split('?')[0];
  const scored = [...seen.values()]
    .filter((r) => r.feedUrl && r.trackName)
    .map((r) => {
      const title = titleScore(r.trackName!);
      const sameAudio = !!audioBase && r.episodeUrl?.split('?')[0] === audioBase;
      const showBonus = r.collectionName && hints.show ? 0.3 * titleSimilarity(hints.show, r.collectionName) : 0;
      return { r, title, score: sameAudio ? 2 : title + showBonus };
    })
    .sort((a, b) => b.score - a.score);
  log(`Apple-Suche: ${seen.size} Treffer, bester Wert ${(scored[0]?.score ?? 0).toFixed(2)}`);
  const best = scored[0];
  if (!best || best.score < 0.6 || (best.score < 2 && best.title < 0.55)) return null;
  const feed = await loadFeed(best.r.feedUrl!);
  const item = findItem(feed, { guid: best.r.episodeGuid, audioUrl: best.r.episodeUrl, title: best.r.trackName });
  return item ? toMeta(feed, item, link) : null;
}

/** Letzter Weg: Die Seite nennt selbst eine vollständige Audiodatei. Woher die Folge kommt, ist dann egal. */
function fromPage(hints: PageHints, link: string, url: URL): EpisodeMeta | null {
  if (!hints.audioUrl || !hints.titles[0]) return null;
  const audio = new URL(hints.audioUrl, url).toString();
  assertPublicUrl(audio);
  const date = hints.published ? new Date(hints.published) : null;
  return {
    show: hints.show ?? url.hostname.replace(/^www\./, ''),
    title: hints.titles[0],
    published: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    durationSec: null,
    audioUrl: audio,
    image: hints.image,
    description: hints.description ?? '',
    links: [],
    feedUrl: link,
    feedAuthor: null,
    episodeUrl: link,
    language: null,
  };
}

export async function resolveEpisode(link: string): Promise<EpisodeMeta> {
  const url = assertPublicUrl(link.trim());
  try {
    if (/podcasts\.apple\.com$/.test(url.hostname)) {
      try {
        const m = await fromApple(url);
        if (m) return m;
      } catch (e) {
        log(`Apple-Abruf: ${e instanceof Error ? e.message : 'Fehler'}`);
      }
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
    const finalUrl = new URL(page.finalUrl);
    const hints = readPage(page.text, finalUrl);
    if (/youtube\.com$|youtu\.be$/.test(url.hostname)) hints.show = await youtubeAuthor(url.toString());
    if (/spotify\.com$/.test(url.hostname) && !hints.titles.length) await addSpotifyTitle(hints, url);
    log(`Seite gelesen: ${hints.titles.length} Titel, Sendung ${hints.show ? 'erkannt' : 'unbekannt'}, Audio ${hints.audioUrl ? 'ja' : 'nein'}, ${hints.feedUrls.length} Feeds`);

    // Feeds, die die Seite selbst nennt. Das können auch Nachrichten-Feeds sein, deshalb darf das scheitern.
    for (const feedUrl of hints.feedUrls) {
      try {
        const feed = await loadFeed(feedUrl);
        for (const title of ['', ...hints.titles]) {
          const item = findItem(feed, { audioUrl: hints.audioUrl, title: title || null });
          if (item?.audioUrl) return toMeta(feed, item, link);
        }
      } catch {
        log('Ein Feed der Seite ließ sich nicht lesen');
      }
    }
    try {
      const found = (await viaSearch(hints, link)) ?? (await viaShow(hints, link));
      if (found) return found;
    } catch (e) {
      log(`Suche: ${e instanceof Error ? e.message : 'Fehler'}`);
    }
    const direct = fromPage(hints, link, finalUrl);
    if (direct) return direct;
  } catch (e) {
    if (e instanceof NotFoundError) throw e;
    if (e instanceof FetchError) {
      log(`Abruf: ${e.message}`);
      throw new NotFoundError(e.message);
    }
    throw e;
  }
  throw new NotFoundError('Zu diesem Link gibt es keinen öffentlichen Feed.');
}
