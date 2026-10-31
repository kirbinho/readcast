# Tobis Readcast

Link zu einer Podcastfolge einfügen, egal von welcher Plattform. Readcast sucht die Folge im öffentlichen RSS-Feed, hört sie mit und liest die Schwerpunkte heraus:

- **Essenz**: die Themen der Folge als Blöcke, so viele, wie die Folge hergibt, dazu Kurzmeldungen
- **10 O-Töne**: die meinungsstärksten, pointiertesten Sätze, wörtlich und über die ganze Folge verteilt
- **Pro Stimme**: was jede der höchstens vier Personen sagt, mit Zitat
- **Frag die Folge**: Antworten nur aus dem Transkript, mit Sprecher und Minute
- **Ab in Notion**: eine Seite pro Folge in der Datenbank „Wissen“, mit den ausgewählten Auswertungen als Blöcke

Wie die Schwerpunkte entstehen, steht in [docs/SCHWERPUNKTE.md](docs/SCHWERPUNKTE.md). Einrichten: [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md). Sicherheit: [docs/SICHERHEIT.md](docs/SICHERHEIT.md).

## Aufbau

```
Browser ──► GitHub Pages (web/)            die App, nur statische Dateien
   │
   └──────► Cloudflare Worker (worker/)    Zugang, Datenbank, Fragen, Notion, Budget
                │  startet
                ▼
            GitHub Actions (pipeline/)     Feed finden, transkribieren, auswerten
                │  nutzt
                ├─ AssemblyAI              Transkript mit Sprechererkennung
                └─ Claude (Opus 5.5)       Lesen, Gewichten, Schreiben, Prüfen
```

Alle Schlüssel liegen als Geheimnisse bei GitHub und Cloudflare, nie im Code und nie im Browser.

## Kosten

Monatsgrenze: 10 € (`CAP_EUR` in `worker/wrangler.toml`). Vor jeder Folge prüft die Pipeline, ob das Budget reicht, danach verbucht sie die tatsächlichen Kosten. Fragen an die Folge werden ebenfalls verbucht.

Grobe Schätzung pro Folge, noch nicht an echten Folgen gemessen:

| Länge | Transkription | Auswertung (Claude Opus 5.5) | Zusammen |
|---|---|---|---|
| 20 Minuten | 0,08 $ | ca. 0,30 $ | ca. 0,40 $ |
| 90 Minuten | 0,35 $ | ca. 1,00–1,30 $ | ca. 1,40–1,70 $ |

GitHub Pages, GitHub Actions (öffentliches Repository), Cloudflare Workers und D1 kosten im Rahmen der kostenlosen Kontingente nichts.

## Entwickeln

```bash
npm install
npm run check   # Typprüfung
npm test        # Tests
npm run mock    # Probe-API mit Platzhalterdaten auf Port 8788
npm run dev -w web
```

Zugangscode für die Probe-API: `probe-zugang-1234567890`.
