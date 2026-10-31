import type { Budget, EpisodeView, ModeKey, QaEntry, RecentItem } from '../../shared/src/types.ts';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'readcast.token';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ohne Speicher gilt die Anmeldung nur bis zum Neuladen
  }
}

let memoryToken: string | null = null;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = memoryToken ?? getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung. Prüf dein Netz und versuch es noch einmal.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') {
      setToken(null);
      memoryToken = null;
    }
    throw new ApiError(res.status, data.error ?? 'Da ist etwas schiefgegangen.');
  }
  return data as T;
}

export const api = {
  async login(code: string) {
    const r = await request<{ token: string; name: string }>('POST', '/api/login', { code });
    memoryToken = r.token;
    setToken(r.token);
    return r;
  },
  me: () => request<{ name: string; budget: Budget; recents: RecentItem[] }>('GET', '/api/me'),
  create: (link: string) => request<{ id: string }>('POST', '/api/episodes', { link }),
  episode: (id: string) => request<EpisodeView>('GET', `/api/episodes/${id}`),
  ask: (id: string, q: string) => request<QaEntry>('POST', `/api/episodes/${id}/ask`, { q }),
  save: (id: string, modes: ModeKey[]) => request<{ pageUrl: string; added: ModeKey[]; modes: ModeKey[] }>('POST', `/api/episodes/${id}/notion`, { modes }),
  undo: (id: string) => request<{ remaining: number; modes?: ModeKey[] }>('POST', `/api/episodes/${id}/notion/undo`),
};
