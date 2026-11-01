import { useEffect, useRef, useState } from 'preact/hooks';
import type { Budget, RecentItem } from '../../shared/src/types.ts';
import { ApiError, api } from './api.ts';
import { go } from './App.tsx';
import { minutes, money, shortDate, statusLine } from './format.ts';

const ERRORS: Record<string, string> = {
  nicht_gefunden: 'Zu diesem Link gibt es keinen öffentlichen Feed. Exklusive Folgen lassen sich nicht auslesen.',
  budget: 'Das Budget für diesen Monat reicht für diese Folge nicht mehr. Ab dem 1. geht es weiter.',
};

export function Start({ onAuthLost }: { onAuthLost: () => void }) {
  const [link, setLink] = useState('');
  const [recents, setRecents] = useState<RecentItem[] | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) return onAuthLost();
    setError(e instanceof ApiError ? e.message : 'Da ist etwas schiefgegangen.');
  };

  useEffect(() => {
    api.me().then((r) => {
      setRecents(r.recents);
      setBudget(r.budget);
    }, fail);
  }, []);

  // Solange die Folge gesucht wird, bleibt die Startseite stehen
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const tick = async () => {
      try {
        const ep = await api.episode(pending);
        if (!alive) return;
        if (ep.status === 'wartet' || ep.status === 'sucht') {
          setStatus(statusLine(ep));
          setTimeout(tick, 2000);
        } else if (ep.duplicateOf) {
          go(ep.duplicateOf);
        } else if (ep.status === 'nicht_gefunden' || ep.status === 'budget' || ep.status === 'fehler') {
          setPending(null);
          setError(ERRORS[ep.status] ?? ep.error ?? 'Da ist etwas schiefgegangen.');
        } else go(ep.id);
      } catch (e) {
        setPending(null);
        fail(e);
      }
    };
    tick();
    return () => {
      alive = false;
    };
  }, [pending]);

  async function start(value: string) {
    setError(null);
    try {
      const { id } = await api.create(value.trim());
      setStatus('Suche die Folge …');
      setPending(id);
    } catch (e) {
      fail(e);
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (pending) return;
    if (link.trim()) return start(link);
    // Leeres Feld: aus der Zwischenablage einfügen
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setLink(text);
        return start(text);
      }
    } catch {
      // Kein Zugriff auf die Zwischenablage: dann tippen oder selbst einfügen
    }
    input.current?.focus();
  }

  return (
    <main class="page">
      <h1 class="wordmark">Tobis Readcast</h1>
      <form class="card dark link-card" onSubmit={submit}>
        <label for="link" class="sr">Link zur Folge</label>
        <input
          ref={input}
          id="link"
          name="folge"
          class="link-input"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck={false}
          placeholder="Link zur Folge …"
          value={link}
          disabled={!!pending}
          onInput={(e) => {
            setLink(e.currentTarget.value);
            setError(null);
          }}
        />
        <div class="link-row">
          <span class="mono" role="status">{pending ? status : 'Jeder Link zur Folge, egal von wo.'}</span>
          <button class="pill-light press" type="submit" disabled={!!pending}>
            {pending ? 'Suche …' : link.trim() ? 'Auslesen' : 'Einfügen'}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" class="inline-msg">
          {error}
        </p>
      )}

      <section class="recents" aria-labelledby="zuletzt">
        <div class="section-head">
          <h2 id="zuletzt">Zuletzt</h2>
          <span class="mono num">{recents ? `${recents.length} ${recents.length === 1 ? 'Folge' : 'Folgen'}` : ''}</span>
        </div>
        {recents?.length === 0 && <p class="empty">Noch keine Folge ausgelesen.</p>}
        {recents?.map((r) => {
          const meta = [shortDate(r.published), minutes(r.durationSec)].filter(Boolean).join(' · ');
          const side = r.status === 'fertig' ? (r.inNotion ? 'in Notion' : '') : 'läuft';
          return (
            <button key={r.id} class="recent press" onClick={() => go(r.id)}>
              {r.image ? (
                <img class="cover" src={r.image} alt="" width={52} height={52} loading="lazy" referrerpolicy="no-referrer" />
              ) : (
                <span class="cover" aria-hidden="true" />
              )}
              <span class="recent-text">
                <span class="mono recent-show" translate={false}>{r.show ?? 'Folge wird gesucht'}</span>
                <span class="recent-title">{r.title ?? 'Noch ohne Titel'}</span>
                <span class="mono num recent-meta-below">{[meta, side].filter(Boolean).join(' · ')}</span>
              </span>
              <span class="mono num recent-meta-side">
                {meta}
                <br />
                {side}
              </span>
            </button>
          );
        })}
      </section>

      {budget && (
        <div class="budget">
          <div class="budget-row mono num">
            <span>Budget diesen Monat</span>
            <span>
              {money(budget.spentEur)} von {money(budget.capEur)}
            </span>
          </div>
          <div class="bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (budget.spentEur / budget.capEur) * 100)}%` }} />
          </div>
        </div>
      )}
    </main>
  );
}
