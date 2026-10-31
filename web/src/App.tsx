import { useEffect, useState } from 'preact/hooks';
import { getToken } from './api.ts';
import { Episode } from './Episode.tsx';
import { Login } from './Login.tsx';
import { Start } from './Start.tsx';

export interface Route {
  id: string | null;
  tab: string;
}

function parse(hash: string): Route {
  const m = hash.match(/^#\/folge\/([0-9a-f-]{36})(?:\/([\w:-]+))?/);
  return m ? { id: m[1], tab: m[2] ?? 'uebersicht' } : { id: null, tab: 'uebersicht' };
}

export function go(id: string | null, tab = 'uebersicht', replace = false): void {
  const hash = id ? `#/folge/${id}${tab !== 'uebersicht' ? `/${tab}` : ''}` : '#/';
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function App() {
  const [route, setRoute] = useState(() => parse(location.hash));
  const [authed, setAuthed] = useState(() => !!getToken());

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const logout = () => setAuthed(false);
  return route.id ? (
    <Episode key={route.id} id={route.id} tab={route.tab} onAuthLost={logout} />
  ) : (
    <Start onAuthLost={logout} />
  );
}
