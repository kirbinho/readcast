export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  GITHUB_REPO: string;
  CAP_EUR: string;
  EUR_PER_USD: string;
  ANTHROPIC_API_KEY: string;
  NOTION_TOKEN: string;
  GITHUB_TOKEN: string;
  PIPELINE_SECRET: string;
  TOKEN_SECRET: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function cors(env: Env): Record<string, string> {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function json(env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...cors(env),
    },
  });
}

export async function readJson<T>(req: Request, maxBytes = 2_000_000): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'Zu groß.');
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Ungültige Anfrage.');
  }
}

export const now = () => new Date().toISOString();

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/** Vergleich ohne Zeitverrat, für Geheimnisse. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
