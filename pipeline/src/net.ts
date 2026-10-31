// Abrufe aus dem Netz mit Zeitlimit, Größenlimit und ohne Zugriff auf interne Adressen.

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

export class FetchError extends Error {}

export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchError('Das ist kein gültiger Link.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError('Nur Web-Links gehen.');
  if (PRIVATE_HOST.test(u.hostname)) throw new FetchError('Interne Adressen sind gesperrt.');
  return u;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Readcast/1.0';

export async function fetchText(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const { maxBytes = 40_000_000, timeoutMs = 20_000, accept = '*/*' } = opts;
  let current = assertPublicUrl(url).toString();
  // Weiterleitungen selbst verfolgen, damit jede Station geprüft wird
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': UA, accept, 'accept-language': 'de,en;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = assertPublicUrl(new URL(res.headers.get('location')!, current).toString()).toString();
      continue;
    }
    if (!res.ok) throw new FetchError(`Abruf fehlgeschlagen (${res.status}).`);
    const reader = res.body?.getReader();
    if (!reader) return { text: '', contentType: res.headers.get('content-type') ?? '', finalUrl: current };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FetchError('Die Antwort ist zu groß.');
      }
      chunks.push(value);
    }
    const text = new TextDecoder('utf-8').decode(Buffer.concat(chunks));
    return { text, contentType: res.headers.get('content-type') ?? '', finalUrl: current };
  }
  throw new FetchError('Zu viele Weiterleitungen.');
}

export async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const { text } = await fetchText(url, { timeoutMs, accept: 'application/json', maxBytes: 10_000_000 });
  return JSON.parse(text) as T;
}
