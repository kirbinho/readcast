import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModeKey } from '../../shared/src/types.ts';
import { ApiError } from './api.ts';

export interface SaveOption {
  mode: ModeKey;
  label: string;
  done: boolean;
}

interface Props {
  options: SaveOption[];
  preselect: ModeKey | null;
  existing: boolean;
  onConfirm: (modes: ModeKey[]) => Promise<void>;
  onClose: () => void;
}

/** Fragt beim Ablegen, welche Auswertungen nach Notion sollen. Auf dem Handy von unten, auf dem Desktop als Dialog. */
export function SaveSheet({ options, preselect, existing, onConfirm, onClose }: Props) {
  const open = options.filter((o) => !o.done);
  const initial = preselect && open.some((o) => o.mode === preselect) ? preselect : open[0]?.mode;
  const [sel, setSel] = useState<Set<ModeKey>>(() => new Set(initial ? [initial] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && dialog.current) {
        // Fokus bleibt im Dialog
        const items = [...dialog.current.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const n = sel.size;
  async function confirm() {
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm([...sel]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ablegen ging nicht.');
      setBusy(false);
    }
  }

  return (
    <>
      <div class="scrim" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h" ref={dialog}>
        <div class="grabber" aria-hidden="true" />
        <h2 id="sheet-h">Was soll nach Notion?</h2>
        <p class="mono" style={{ margin: '6px 0 0' }}>
          {existing
            ? 'Die Seite zur Folge gibt es schon. Neues kommt als weiterer Block dazu.'
            : 'Eine Seite pro Folge in Wissen. Jede Auswertung wird ein eigener Block.'}
        </p>
        <fieldset>
          <legend class="sr">Auswertungen</legend>
          {options.map((o) => (
            <label key={o.mode} class={`option${o.done ? ' is-done' : ''}`}>
              <input
                type="checkbox"
                name="auswertung"
                checked={o.done || sel.has(o.mode)}
                disabled={o.done || busy}
                onChange={() =>
                  setSel((s) => {
                    const next = new Set(s);
                    if (next.has(o.mode)) next.delete(o.mode);
                    else next.add(o.mode);
                    return next;
                  })
                }
              />
              <span class="label">{o.label}</span>
              {o.done && <span class="mono">liegt schon drin</span>}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" class="inline-msg">
            {error}
          </p>
        )}
        <div class="sheet-actions">
          <button class="confirm press" onClick={confirm} disabled={!n || busy}>
            {busy ? 'Lege ab …' : n === 0 ? 'Nichts ausgewählt' : n === 1 ? '1 Auswertung ablegen' : `${n} Auswertungen ablegen`}
          </button>
          <button class="cancel" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </div>
    </>
  );
}
