import { useEffect, useRef, useState } from 'preact/hooks';
import type { Block, EpisodeView, ModeKey, Sentence, Speaker } from '../../shared/src/types.ts';
import { LAUFEND } from '../../shared/src/types.ts';
import { formatTs } from '../../shared/src/text.ts';
import { ApiError, api } from './api.ts';
import { go } from './App.tsx';
import { fullDate, language, minutes, statusLine } from './format.ts';
import { SaveSheet, type SaveOption } from './SaveSheet.tsx';

interface Tab {
  id: string; // in der Adresse
  label: string;
  mode: ModeKey | null; // was nach Notion gehen kann
}

const voicesOf = (ep: EpisodeView) => ep.speakers.filter((s) => s.role !== 'sonstige');

function tabsFor(ep: EpisodeView): Tab[] {
  const tabs: Tab[] = [{ id: 'uebersicht', label: 'Übersicht', mode: null }];
  if (ep.status === 'zu_viele' || ep.status === 'budget' || ep.status === 'fehler') return tabs;
  tabs.push({ id: 'essenz', label: 'Essenz', mode: 'essenz' }, { id: 'zehn', label: '10 O-Töne', mode: 'zehn' });
  // Pro Person nur, wenn wirklich mehrere miteinander sprechen. Einspieler zählen nicht.
  const voices = voicesOf(ep);
  if (voices.length >= 2) for (const v of voices) tabs.push({ id: `p-${v.label}`, label: v.short, mode: `p:${v.label}` });
  tabs.push({ id: 'frag', label: 'Frag die Folge', mode: 'frag' });
  return tabs;
}

function Text({ sentences, ts }: { sentences: Sentence[]; ts: number }) {
  return (
    <p>
      {sentences.map((s) => s.text).join(' ')} <span class="ts">{formatTs(ts)}</span>
    </p>
  );
}

function Blocks({ blocks, speakers }: { blocks: Block[]; speakers: Speaker[] }) {
  const short = new Map(speakers.map((s) => [s.label, s.short]));
  return (
    <>
      {blocks.map((b, i) => (
        <article class="block" key={i}>
          <h3>{b.heading}</h3>
          <Text sentences={b.sentences} ts={b.ts} />
          {b.quote && (
            <blockquote>
              „{b.quote.text}“{' '}
              <span class="ts">
                {short.get(b.quote.spk) ?? b.quote.spk} · {formatTs(b.quote.ts)}
              </span>
            </blockquote>
          )}
        </article>
      ))}
    </>
  );
}

export function Episode({ id, tab, onAuthLost }: { id: string; tab: string; onAuthLost: () => void }) {
  const [ep, setEp] = useState<EpisodeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<{ text: string; url: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const saveBtn = useRef<HTMLButtonElement>(null);

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) return onAuthLost();
    setError(e instanceof ApiError ? e.message : 'Da ist etwas schiefgegangen.');
  };

  // Laden und, solange die Folge läuft, alle paar Sekunden nachfragen
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await api.episode(id);
        if (!alive) return;
        if (next.duplicateOf) return go(next.duplicateOf, 'uebersicht', true);
        setEp(next);
        if (LAUFEND.includes(next.status)) timer = window.setTimeout(load, next.status === 'hoert' ? 5000 : 3000);
      } catch (e) {
        fail(e);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  if (error && !ep) {
    return (
      <main class="page">
        <div class="topbar">
          <button class="wordmark-small press" onClick={() => go(null)}>Tobis Readcast</button>
        </div>
        <p role="alert" class="state-text">{error}</p>
      </main>
    );
  }
  if (!ep) return <main class="page" aria-busy="true" />;

  const tabs = tabsFor(ep);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const ready = ep.status === 'fertig';
  const running = LAUFEND.includes(ep.status);
  const voices = voicesOf(ep);
  const r = ep.results;

  // Was gespeichert werden kann
  const options: SaveOption[] = tabs
    .filter((t) => t.mode && r)
    .filter((t) => {
      if (t.mode === 'essenz') return r!.essenz.blocks.length > 0;
      if (t.mode === 'zehn') return r!.zehn.length > 0;
      if (t.mode === 'frag') return ep.qa.length > 0;
      return (r!.personen[t.mode!.slice(2)]?.blocks.length ?? 0) > 0;
    })
    .map((t) => ({ mode: t.mode!, label: t.mode === 'frag' ? 'Deine Fragen' : t.label, done: ep.notion.modes.includes(t.mode!) }));
  const anySaved = ep.notion.modes.length > 0;
  const allSaved = options.length > 0 && options.every((o) => o.done);

  function showToast(text: string, url: string) {
    clearTimeout(toastTimer.current);
    setToast({ text, url });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }

  async function confirmSave(modes: ModeKey[]) {
    const res = await api.save(id, modes);
    setEp((e) => (e ? { ...e, notion: { pageUrl: res.pageUrl, modes: res.modes, canUndo: true } } : e));
    setSheet(false);
    showToast(res.added.length > 1 ? `${res.added.length} Auswertungen in Wissen.` : 'Liegt unter Wissen.', res.pageUrl);
  }

  async function undo() {
    clearTimeout(toastTimer.current);
    setToast(null);
    try {
      let left: { remaining: number; modes?: ModeKey[] };
      do left = await api.undo(id);
      while (left.remaining > 0);
      setEp((e) => (e ? { ...e, notion: { pageUrl: left.modes?.length ? e.notion.pageUrl : null, modes: left.modes ?? [], canUndo: false } } : e));
    } catch (e) {
      fail(e);
    }
  }

  async function submitQuestion(e: Event) {
    e.preventDefault();
    const text = q.trim();
    if (!text || asking) return;
    setAsking(true);
    try {
      const entry = await api.ask(id, text);
      setEp((x) => (x ? { ...x, qa: [entry, ...x.qa] } : x));
      setQ('');
    } catch (err) {
      fail(err);
    } finally {
      setAsking(false);
    }
  }

  const meta = ep.meta;
  const failedText = ep.status === 'fehler' || ep.status === 'budget' ? (ep.error ?? 'Beim Auslesen ist etwas schiefgegangen.') : null;

  return (
    <main class="page">
      <div class="topbar">
        <button class="wordmark-small press" onClick={() => go(null)}>Tobis Readcast</button>
        <button class="text-link" onClick={() => go(null)}>Neuer Link</button>
      </div>

      <header class="ep-head">
        <div class="mono" translate={false}>{meta?.show ?? ''}</div>
        <h1 class="ep-title">{meta?.title ?? 'Folge'}</h1>
        {running && (
          <div class="progress">
            <div class="bar" aria-hidden="true">
              <span style={{ width: `${ep.progress}%` }} />
            </div>
            <div class="mono num" role="status" style={{ marginTop: '6px' }}>{statusLine(ep)}</div>
          </div>
        )}
      </header>

      <nav class="tabs" aria-label="Auswertungen">
        {tabs.map((t) => (
          <button key={t.id} class="pill press" aria-pressed={t.id === current.id} onClick={() => go(id, t.id, true)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div class="content">
        {failedText && (
          <div class="notice" role="alert">
            <div class="notice-head">Das hat nicht geklappt.</div>
            <p>{failedText}</p>
          </div>
        )}

        {current.id === 'uebersicht' && meta && (
          <>
            <div class="card dark ov-card">
              {meta.image ? (
                <img class="cover" src={meta.image} alt="" width={64} height={64} referrerpolicy="no-referrer" />
              ) : (
                <span class="cover" aria-hidden="true" />
              )}
              <dl class="facts">
                <div><dt>Erschienen</dt><dd>{fullDate(meta.published)}</dd></div>
                <div><dt>Länge</dt><dd>{minutes(meta.durationSec) || '–'}</dd></div>
                <div><dt>Sprache</dt><dd>{language(meta.language)}</dd></div>
              </dl>
            </div>

            {ep.status === 'zu_viele' && (
              <div class="notice" role="alert">
                <div class="notice-head">{ep.speakerCount ?? 'Mehr als 4'} Stimmen erkannt.</div>
                <p>Readcast liest Folgen mit höchstens vier Stimmen aus. Bei mehr wird es zu unsicher, wer was gesagt hat.</p>
              </div>
            )}

            <div class="ov-grid">
              <section aria-labelledby="stimmen">
                <h2 id="stimmen">Stimmen</h2>
                {voices.length ? (
                  <>
                    <ul class="voices">
                      {voices.map((v) => (
                        <li key={v.label}>
                          <span class="name" translate={false}>{v.name ?? v.short}</span>
                          <span class="mono">{v.role === 'host' ? 'Host' : 'Gast'}</span>
                        </li>
                      ))}
                    </ul>
                    <p class="mono" style={{ margin: '8px 0 0' }}>Namen aus Shownotes, Feed und Gespräch.</p>
                  </>
                ) : (
                  <p class="state-text">Stehen fest, sobald das Transkript fertig ist.</p>
                )}
              </section>

              <section aria-labelledby="notes">
                <h2 id="notes">Shownotes</h2>
                {meta.description && (
                  <>
                    <p class={`notes-text${notesOpen ? '' : ' clamped'}`}>{meta.description}</p>
                    {meta.description.length > 420 && (
                      <button class="text-link" aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
                        {notesOpen ? 'Weniger' : 'Alles zeigen'}
                      </button>
                    )}
                  </>
                )}
                {meta.links.length > 0 && (
                  <ul class="notes-links">
                    {meta.links.map((l) => (
                      <li key={l.url}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer">
                          <span>{l.title}</span>
                          <span class="mono">{l.domain}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}

        {current.id !== 'uebersicht' && running && (
          <>
            <div class="state-head">Höre noch mit.</div>
            <p class="state-text">{current.label} steht hier, sobald das Transkript ausgewertet ist.</p>
          </>
        )}

        {ready && r && current.id === 'essenz' && (
          <div class="read">
            <h2 class="mono read-label">Essenz der Folge</h2>
            <Blocks blocks={r.essenz.blocks} speakers={ep.speakers} />
            {r.essenz.shorts.length > 0 && (
              <section class="shorts" aria-labelledby="kurz">
                <h3 id="kurz">Kurzmeldungen</h3>
                {r.essenz.shorts.map((s, i) => (
                  <div class="short" key={i}>
                    <div class="short-head">{s.heading}</div>
                    <Text sentences={s.sentences} ts={s.ts} />
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {ready && r && current.id === 'zehn' && (
          <div class="read">
            <h2 class="mono read-label">Die {r.zehn.length} stärksten O-Töne, wörtlich</h2>
            {r.zehn.length ? (
              <ol class="otoene">
                {r.zehn.map((z, i) => (
                  <li key={i}>
                    <span class="n">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <div class="q">„{z.text}“</div>
                      <div class="mono num who">
                        {ep.speakers.find((s) => s.label === z.spk)?.short ?? z.spk} · {formatTs(z.ts)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p class="state-text">In dieser Folge gibt es keine Stelle, die stark genug für einen O-Ton ist.</p>
            )}
          </div>
        )}

        {ready && r && current.id.startsWith('p-') && (() => {
          const label = current.id.slice(2);
          const sp = ep.speakers.find((s) => s.label === label);
          const blocks = r.personen[label]?.blocks ?? [];
          return (
            <div class="read">
              <h2 class="mono read-label">Was {sp?.name ?? sp?.short} sagt</h2>
              {blocks.length ? (
                <Blocks blocks={blocks} speakers={ep.speakers} />
              ) : (
                <p class="state-text">Zu den Themen der Folge sagt {sp?.short} nichts Eigenständiges.</p>
              )}
            </div>
          );
        })()}

        {ready && current.id === 'frag' && (
          <div class="read">
            <form class="card dark ask-form" onSubmit={submitQuestion}>
              <label for="frage" class="sr">Frage an die Folge</label>
              <input
                id="frage"
                name="frage"
                class="ask-input"
                type="text"
                autocomplete="off"
                placeholder="Was willst du wissen …"
                maxLength={500}
                value={q}
                onInput={(e) => setQ(e.currentTarget.value)}
              />
              <button class="pill-light press" type="submit" disabled={asking}>
                {asking ? 'Suche …' : 'Fragen'}
              </button>
            </form>
            <p class="mono ask-note">Antwortet nur mit dem, was gesagt wurde.</p>
            {error && <p role="alert" class="inline-msg">{error}</p>}
            {ep.qa.length === 0 && (
              <>
                <div class="state-head">Frag etwas zur Folge.</div>
                <p class="state-text">Jede Antwort nennt Sprecher und Minute. Kommt etwas nicht vor, steht genau das da.</p>
              </>
            )}
            <div aria-live="polite">
              {ep.qa.map((x, i) => (
                <article class={`qa${x.found ? '' : ' missing'}`} key={`${x.at}-${i}`}>
                  <h3>{x.q}</h3>
                  <p>
                    {x.answer}{' '}
                    {x.cites.length > 0 && <span class="ts">{x.cites.map((c) => `${c.spk} · ${formatTs(c.ts)}`).join(', ')}</span>}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>

      {ready && options.length > 0 && (
        <div class="savebar">
          <div aria-live="polite">
            {toast && (
              <div class="toast">
                <span>{toast.text}</span>
                <span class="toast-actions">
                  {ep.notion.canUndo && <button onClick={undo}>Rückgängig</button>}
                  <button onClick={() => window.open(toast.url, '_blank', 'noopener,noreferrer')}>Öffnen</button>
                </span>
              </div>
            )}
          </div>
          <button
            ref={saveBtn}
            class={`save-btn press${anySaved ? ' done' : ''}`}
            onClick={() => {
              if (allSaved && ep.notion.pageUrl) window.open(ep.notion.pageUrl, '_blank', 'noopener,noreferrer');
              else setSheet(true);
            }}
          >
            {allSaved ? 'Liegt unter Wissen' : anySaved ? 'In Notion ergänzen' : 'Ab in Notion'}
          </button>
        </div>
      )}

      {sheet && (
        <SaveSheet
          options={options}
          preselect={current.mode}
          existing={anySaved}
          onConfirm={confirmSave}
          onClose={() => {
            setSheet(false);
            saveBtn.current?.focus();
          }}
        />
      )}
    </main>
  );
}
