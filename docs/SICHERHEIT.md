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
| Fremde nutzen die App | Zugang nur mit langem Zufallscode (`npm run zugang`). Der Worker speichert nur dessen Hash. Nach acht Fehlversuchen in 15 Minuten ist die IP gesperrt. Die Anmeldung gilt 30 Tage. |
| Fremde Websites rufen den Worker auf | Der Worker erlaubt Browser-Anfragen nur von deiner GitHub-Pages-Adresse. |
| Fremde starten die Pipeline | Nur der Worker kann sie starten, mit einem Token, das nur Workflows dieses Repositorys auslösen darf. Pull Requests von Fremden bekommen keine Geheimnisse. |
| Pipeline-Ergebnisse gefälscht | Die Pipeline meldet sich beim Worker mit einem eigenen Geheimnis (`PIPELINE_SECRET`). |
| Inhalte in öffentlichen Protokollen | Das Repository ist öffentlich, also auch die Protokolle von GitHub Actions. Die Pipeline schreibt nur Schritte und Zahlen hinein. Ergebnisse gehen direkt an den Worker. |
| Kosten laufen aus dem Ruder | Harte Grenze von 10 € im Monat im Worker. Zusätzlich empfohlen: eine Ausgabengrenze direkt in der Claude Console (siehe Einrichtung). |
| Ein Link zeigt auf interne Adressen | Die Pipeline ruft nur öffentliche Web-Adressen ab und prüft jede Weiterleitung. |
| Shownotes oder Transkript enthalten Anweisungen an die KI | Fremdtext wird in jedem Prompt eingezäunt und als Daten gekennzeichnet. Die Ausgabe ist reiner Text, die App rendert kein HTML aus Ergebnissen. |
| Notion-Zugriff zu weit | Die Notion-Integration bekommt nur Zugriff auf die Datenbank „Wissen“. „Rückgängig“ verschiebt eine neu angelegte Seite in den Papierkorb, nichts wird endgültig gelöscht. |

## Was du wissen solltest

- Der **Code** ist öffentlich, weil GitHub Pages im kostenlosen Tarif ein öffentliches Repository braucht. Das ist unkritisch, solange keine Schlüssel im Code stehen. Das prüft GitHub zusätzlich mit seinem Secret Scanning.
- Die **Web-App selbst** ist für alle erreichbar, zeigt ohne Zugangscode aber nichts.
- **Transkripte** liegen in der Cloudflare-Datenbank, damit „Frag die Folge“ funktioniert. Sie gehen nicht nach Notion.
- Wenn ein Zugangscode verloren geht: Zeile in der Tabelle `users` löschen und neu anlegen. Wenn ein Schlüssel verloren geht: beim Anbieter widerrufen, neu anlegen, Geheimnis bei GitHub ersetzen, Workflow „Worker veröffentlichen“ neu starten.
