import { useState } from 'preact/hooks';
import { ApiError, api } from './api.ts';

export function Login({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(code.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anmelden ging nicht.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="page">
      <h1 class="wordmark">Tobis Readcast</h1>
      <form class="card dark link-card login" onSubmit={submit}>
        <label for="code" class="sr">Zugangscode</label>
        <input
          id="code"
          name="code"
          class="link-input"
          type="password"
          autocomplete="current-password"
          spellcheck={false}
          placeholder="Zugangscode …"
          value={code}
          onInput={(e) => setCode(e.currentTarget.value)}
        />
        <div class="link-row">
          <span class="mono">Den Code bekommst du von Tobi.</span>
          <button class="pill-light press" type="submit" disabled={busy}>
            {busy ? 'Prüfe …' : 'Anmelden'}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" class="inline-msg">
          {error}
        </p>
      )}
    </main>
  );
}
