# Sicherheit

## Was geschützt wird

- **Schlüssel** für Claude, AssemblyAI, Notion, GitHub und Cloudflare
- **Deine Notion-Datenbank** „Wissen“
- **Das Budget**: Niemand außer dir soll Kosten verursachen können
- **Transkripte und Auswertungen**: Sie sind urheberrechtlich nicht deins und gehören nicht ins Netz

## Wie

| Risiko | Schutz |
|---|---|
| Schlüssel im Code oder Browser | Alle Schlüssel liegen als Geheimnisse bei GitHub und werden beim Veröffentlichen in den Worker übertragen. Die Web-App kennt nur die öffentliche Adresse des Workers. |
| Fremde nutzen die App | Zugang nur mit langem Zufallscode (`npm run zugang`). Der Worker speichert nur dessen Hash. Nach acht Fehlversuchen in 15 Minuten ist die IP gesperrt. Die Anmeldung gilt 30 Tage, ein gelöschter Zugang sofort nicht mehr. |
| Fremde Websites rufen den Worker auf | Der Worker erlaubt Browser-Anfragen nur von deiner GitHub-Pages-Adresse. |
| Fremde starten die Pipeline | Nur der Worker kann sie starten, mit einem Token, das nur Workflows dieses Repositorys auslösen darf. Pull Requests von Fremden bekommen keine Geheimnisse. |
| Pipeline-Ergebnisse gefälscht | Die Pipeline meldet sich beim Worker mit einem eigenen Geheimnis (`PIPELINE_SECRET`). |
| Inhalte in öffentlichen Protokollen | Das Repository ist öffentlich, also auch die Protokolle von GitHub Actions. Die Pipeline schreibt nur Schritte, Zahlen und eigene Fehlertexte hinein, fremde Fehlertexte nur als Fehlerart. Ergebnisse gehen direkt an den Worker. |
| Kosten laufen aus dem Ruder | Siehe „Budget“ unten. |
| Eingeschleuster Code in der App | Eine Content Security Policy erlaubt Skripte nur von der App selbst und Verbindungen nur zum Worker. Die Anmeldung liegt im Browser-Speicher, deshalb sollten andere Seiten auf derselben `github.io`-Adresse keine fremden Skripte laden. |
| Ein Link zeigt auf interne Adressen | Die Pipeline ruft nur öffentliche Web-Adressen ab und prüft jede Weiterleitung. |
| Shownotes oder Transkript enthalten Anweisungen an die KI | Fremdtext wird in jedem Prompt eingezäunt und als Daten gekennzeichnet. Die Ausgabe ist reiner Text, die App rendert kein HTML aus Ergebnissen. |
| Notion-Zugriff zu weit | Die Notion-Integration bekommt nur Zugriff auf die Datenbank „Wissen“. „Rückgängig“ verschiebt eine neu angelegte Seite in den Papierkorb, nichts wird endgültig gelöscht. |

## Budget

Die Grenze steht als `CAP_EUR` in `worker/wrangler.toml` (10 €). So wird sie eingehalten:

1. **Reservierung vor dem Start:** Jede Folge reserviert ihre Höchstkosten. Passt das nicht mehr ins Budget, startet sie nicht. Auch zwei gleichzeitige Folgen können nicht gemeinsam durchrutschen.
2. **Kostengrenze pro Lauf:** Erreicht die Auswertung das Doppelte der geschätzten Kosten, bricht der Lauf ab.
3. **Höchstlänge:** Folgen über drei Stunden werden nicht ausgelesen. Nennt der Feed keine oder eine falsche Länge, wird die Transkription bei drei Stunden abgeschnitten.
4. **Laufende Verbuchung:** Kosten werden während des Laufs gemeldet, nicht erst am Ende.
5. **Vorsichtiger Kurs:** Dollar werden mit 0,95 € gerechnet, damit Kursschwankungen nicht über die Grenze führen.
6. **Frag die Folge:** Fragen werden gesperrt, wenn weniger als 0,10 $ übrig sind.

Was das nicht ausschließt: Kurz vor der Grenze können bereits laufende Aufrufe noch einige Cent verursachen, und ein harter Absturz kann seine letzten Aufrufe nicht mehr melden. Readcast rechnet außerdem nach eigener Preisliste, nicht nach der Rechnung der Anbieter.

Die letzte Sicherung liegt deshalb bei den Anbietern: In der Claude Console nur begrenzt Guthaben aufladen und die automatische Aufladung auslassen, bei AssemblyAI keine Karte hinterlegen und nur das Startguthaben nutzen. Was nicht aufgeladen ist, kann nicht ausgegeben werden.

## Was du wissen solltest

- Der **Code** ist öffentlich, weil GitHub Pages im kostenlosen Tarif ein öffentliches Repository braucht. Das ist unkritisch, solange keine Schlüssel im Code stehen. Das prüft GitHub zusätzlich mit seinem Secret Scanning.
- Die **Web-App selbst** ist für alle erreichbar, zeigt ohne Zugangscode aber nichts.
- **Transkripte** liegen in der Cloudflare-Datenbank, damit „Frag die Folge“ funktioniert. Bei AssemblyAI werden sie direkt nach dem Abruf gelöscht, nach Notion gehen sie nicht.
- **Freigabe Arbeit:** Folgen zu KI, Medien oder Marketing bekommen den Haken automatisch, und der nächtliche Abgleich kopiert sie ins ZEIT-Notion.
- **Teilen:** Alle Zugänge schreiben in dasselbe Notion und nutzen dasselbe Budget. Vor dem Teilen muss das umgebaut werden.
- **GitHub-Konto:** Wer es übernimmt, kommt an fast alles. Zwei-Faktor-Anmeldung einschalten und das Upload-Token nach dem Hochladen löschen.
- Wenn ein Zugangscode verloren geht: Zeile in der Tabelle `users` löschen und neu anlegen. Die Sperre gilt sofort. Wenn ein Schlüssel verloren geht: beim Anbieter widerrufen, neu anlegen, Geheimnis bei GitHub ersetzen, Workflow „Worker veröffentlichen“ neu starten.
