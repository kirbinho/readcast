// Zugang über einen langen Zugangscode je Person. Der Worker speichert nur dessen Hash.
// Nach dem Login gibt es ein signiertes Token, das 30 Tage gilt.

import { HttpError, type Env, readJson, safeEqual } from './http.ts';

const TOKEN_DAYS = 30;
const MAX_ATTEMPTS = 8; // Fehlversuche je IP in 15 Minuten

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export interface User {
  id: string;
  name: string;
}

export async function issueToken(env: Env, user: User): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ uid: user.id, name: user.name, exp: Date.now() + TOKEN_DAYS * 86_400_000 })));
  return `${payload}.${await hmac(env.TOKEN_SECRET, payload)}`;
}

export async function requireUser(req: Request, env: Env): Promise<User> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, await hmac(env.TOKEN_SECRET, payload))) throw new HttpError(401, 'Bitte neu anmelden.');
  const data = JSON.parse(fromB64url(payload)) as { uid: string; name: string; exp: number };
  if (data.exp < Date.now()) throw new HttpError(401, 'Bitte neu anmelden.');
  // Ein gelöschter Zugang gilt sofort nicht mehr, auch wenn sein Token noch läuft
  const user = await env.DB.prepare('SELECT id, name FROM users WHERE id = ?').bind(data.uid).first<User>();
  if (!user) throw new HttpError(401, 'Bitte neu anmelden.');
  return user;
}

export async function login(req: Request, env: Env): Promise<{ token: string; name: string }> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unbekannt';
  const since = Date.now() - 15 * 60_000;
  const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first<{ n: number }>()) ?? { n: 0 };
  if (n >= MAX_ATTEMPTS) throw new HttpError(429, 'Zu viele Versuche. Warte eine Viertelstunde.');

  const { code } = await readJson<{ code?: string }>(req, 2000);
  const clean = (code ?? '').trim();
  const user = clean.length >= 20
    ? await env.DB.prepare('SELECT id, name FROM users WHERE code_hash = ?').bind(await sha256Hex(clean)).first<User>()
    : null;
  if (!user) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()),
      env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(since),
    ]);
    throw new HttpError(401, 'Dieser Zugangscode stimmt nicht.');
  }
  return { token: await issueToken(env, user), name: user.name };
}

export function requirePipeline(req: Request, env: Env): void {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!env.PIPELINE_SECRET || !safeEqual(token, env.PIPELINE_SECRET)) throw new HttpError(401, 'Nicht erlaubt.');
}

