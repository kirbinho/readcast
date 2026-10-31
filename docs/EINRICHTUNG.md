# Einrichtung

Einmalig, etwa 45 Minuten. Du brauchst fünf Konten. Alle Schlüssel landen am Ende an genau einer Stelle: in den Geheimnissen des GitHub-Repositorys.

## 1. GitHub-Repository

1. Neues **öffentliches** Repository `readcast` anlegen und diesen Ordner hochladen.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## 2. Cloudflare (kostenlos)

1. Konto auf [dash.cloudflare.com](https://dash.cloudflare.com) anlegen. Unter **Workers & Pages** einmal die workers.dev-Subdomain bestätigen.
2. **Storage & Databases → D1 → Create database**, Name `readcast`. Die **Database ID** notieren.
3. **Account ID** notieren (rechts auf der Übersichtsseite).
4. **My Profile → API Tokens → Create Token → Vorlage „Edit Cloudflare Workers“**, zusätzlich die Berechtigung **Account · D1 · Edit** hinzufügen. Token notieren.

## 3. AssemblyAI (Transkription)

Konto auf [assemblyai.com](https://www.assemblyai.com) anlegen (50 $ Startguthaben), API-Schlüssel notieren.

## 4. Claude

1. In der [Claude Console](https://platform.claude.com) einen API-Schlüssel anlegen.
2. **Empfohlen:** unter **Limits** eine monatliche Ausgabengrenze setzen, etwa 12 $. Das ist die zweite Sicherung neben der 10-€-Grenze in Readcast.

## 5. Notion

1. [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **Neue Integration**, Name „Readcast“, Typ intern. Fähigkeiten: Inhalte lesen, einfügen, aktualisieren. Das **Token** notieren.
2. Die Datenbank **Wissen** öffnen → **···** → **Verbindungen** → **Readcast** hinzufügen. Nur diese Datenbank, sonst nichts.

## 6. GitHub-Token für den Start der Pipeline

**GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token**
- Repository access: **Only select repositories → readcast**
- Permissions: **Actions: Read and write**, sonst nichts
- Ablauf: ein Jahr (Erinnerung setzen)

## 7. Zwei Zufallsgeheimnisse

Im Ordner dieses Projekts zweimal ausführen und beide Werte notieren:

```bash
npm run geheimnis
```

## 8. Alles bei GitHub eintragen

**Repository → Settings → Secrets and variables → Actions**

Unter **Secrets**:

| Name | Wert |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token aus Schritt 2.4 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID aus Schritt 2.3 |
| `ANTHROPIC_API_KEY` | Schlüssel aus Schritt 4 |
| `ASSEMBLYAI_API_KEY` | Schlüssel aus Schritt 3 |
| `NOTION_TOKEN` | Token aus Schritt 5 |
| `DISPATCH_TOKEN` | Token aus Schritt 6 |
| `PIPELINE_SECRET` | erstes Zufallsgeheimnis |
| `TOKEN_SECRET` | zweites Zufallsgeheimnis |

Unter **Variables**:

| Name | Wert |
|---|---|
| `D1_DATABASE_ID` | Database ID aus Schritt 2.2 |
| `READCAST_API_URL` | kommt in Schritt 9 |

## 9. Veröffentlichen

1. **Actions → Worker veröffentlichen → Run workflow**. Im Protokoll steht am Ende die Adresse, etwa `https://readcast-api.<name>.workers.dev`.
2. Diese Adresse als Variable `READCAST_API_URL` eintragen.
3. **Actions → Web-App veröffentlichen → Run workflow**. Danach liegt die App unter `https://<dein-github-name>.github.io/readcast/`.

Ab jetzt veröffentlichen sich Worker und App bei jeder Änderung auf `main` selbst.

## 10. Zugangscode anlegen

```bash
npm run zugang -- Tobi
```

Das gibt einen Zugangscode und eine Zeile SQL aus. Die SQL-Zeile in Cloudflare unter **D1 → readcast → Console** einfügen und ausführen. Den Code gut aufheben, er wird nicht gespeichert. Mit ihm meldest du dich in der App an.

Für jede weitere Person, mit der du die App teilen willst, dasselbe mit ihrem Namen.

## Wenn etwas nicht geht

- **„Das Auslesen ließ sich nicht starten“**: `DISPATCH_TOKEN` prüfen (Repository richtig, Actions: Read and write).
- **Anmelden geht nicht**: Stimmt `READCAST_API_URL`? Wurde die SQL-Zeile ausgeführt?
- **Notion lehnt ab**: Ist die Integration mit der Datenbank Wissen verbunden?
- **Eine Folge hängt**: Unter **Actions → Folge auslesen** den letzten Lauf öffnen. Nach 90 Minuten ohne Fortschritt bricht Readcast von selbst ab.
