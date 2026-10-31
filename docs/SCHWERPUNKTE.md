# Wie Readcast Schwerpunkte setzt

Das Ziel: Was in der Essenz steht, soll das sein, was **die Folge** wichtig nimmt. Nicht das, was einem Modell gerade auffällt, und nicht das, was Tobi interessiert.

## Was die Forschung dazu sagt

1. **Ein Modell weiß nicht verlässlich, was es selbst für wichtig hält.** Trienes u. a. haben 13 Modelle untersucht: Sie haben ein stabiles inneres Gespür für Wichtigkeit, können es aber nicht benennen, und es deckt sich nur schwach mit dem, was Menschen wichtig finden ([ACL 2025](https://arxiv.org/abs/2502.14613)). Ein Prompt „fass das Wichtigste zusammen“ übernimmt also ungeprüft die Prioritäten des Modells.
2. **Erst Fakten, dann Gewicht, dann Text, in getrennten Schritten.** FRAME zerlegt ein Gespräch in einzelne Aussagen mit Kontext, bewertet sie, baut eine Gliederung und schreibt erst dann. Das senkte erfundene Inhalte und Auslassungen deutlich. Alles in einem Prompt war schlechter ([arXiv 2509.15901](https://arxiv.org/html/2509.15901)).
3. **Die Mitte geht verloren.** Modelle gewichten Anfang und Ende langer Texte stärker als die Mitte ([Found in the Middle](https://research.google/pubs/found-in-the-middle-calibrating-positional-attention-bias-improves-long-context-utilization/)).
4. **Belege lassen sich prüfen.** FActScore zerlegt Texte in einzelne Aussagen und prüft jede gegen die Quelle ([Min u. a.](https://arxiv.org/abs/2305.14251)).
5. **Was Podcast-Zusammenfassungen gut macht:** Bei den Podcast-Wettbewerben von TREC schnitten Zusammenfassungen gut ab, die Hauptthema und Personen nennen und sich nicht wiederholen ([TREC 2020](https://arxiv.org/pdf/2103.15953)).

## Der Ablauf

### 1. Lesen in Fenstern (`pipeline/src/extract.ts`)

Das Transkript wird in Fenster von 15 Minuten geteilt, jedes Fenster wird für sich gelesen. So wird Minute 50 so gründlich gelesen wie Minute 5. Pro Fenster hält Claude fest, ohne zu bewerten:

- **Art jedes Abschnitts**: Inhalt, Hörerfrage, Werbung, Smalltalk, Moderation. Werbung, Smalltalk und Moderation fliegen raus. Hörerfragen bleiben nur, wenn sie ein inhaltliches Thema aufmachen.
- **Aussagen**: einzeln, für sich verständlich, treu am Gesagten, mit Stimme und Belegstelle. Dazu Merkmale: Typ (Fakt, Zahl, Einschätzung, Prognose …), konkret ja/nein, Haltung (betont, Widerspruch, Zustimmung), tragend oder Detail.
- **O-Ton-Kandidaten**: wörtlich, mit Noten für Meinung, Pointe und Zitierbarkeit. Jeder Kandidat wird per Code Zeichen für Zeichen gegen das Transkript geprüft. Was nicht wörtlich dort steht, fliegt raus.

### 2. Themen der ganzen Folge (`pipeline/src/topics.ts`)

Die Themen-Etiketten aller Fenster werden zu den Themen der Folge zusammengeführt, damit ein Thema aus Minute 10 und Minute 70 als eines zählt. Dabei wird markiert, ob Folgentitel, Kapitelmarken, Beschreibung oder Anmoderation das Thema ankündigen.

### 3. Gewichtung (`pipeline/src/salience.ts`)

Hier fällt die Entscheidung, und zwar als nachvollziehbare Rechnung, nicht als Frage an das Modell. Alle Signale stammen aus der Folge selbst:

| Signal | Gewicht | Was es misst |
|---|---|---|
| Sendezeit | 40 % | Anteil an der Inhaltszeit, voll ab einem Viertel |
| Wiederkehr | 15 % | Kommt das Gespräch auf das Thema zurück? |
| Ankündigung | 15 % | Nennen Titel, Kapitel oder Anmoderation das Thema? |
| Gehalt | 15 % | Zahl der tragenden Aussagen |
| Auseinandersetzung | 10 % | Mehrere Stimmen, Widerspruch, ausdrückliche Betonung |
| Konkretheit | 5 % | Anteil an Zahlen, Namen, Beispielen |

- **Schwerpunkt** (eigener Block): Gewicht ab 0,42 und mindestens 5 % der Inhaltszeit oder drei Minuten. Höchstens sieben, mindestens einer.
- **Kurzmeldung**: mindestens 1,5 % der Inhaltszeit oder eine Minute und mindestens eine tragende Aussage. Höchstens sechs.
- Alles darunter fällt weg.

Die Länge eines Blocks folgt seinem Gewicht. So entsteht Form aus Funktion: Eine Folge mit einem großen Thema bekommt einen langen Block, eine Nachrichtenfolge mit zwölf Themen mehrere kurze.

Die O-Töne werden nach Meinung, Pointe und Zitierbarkeit ausgewählt und über die Folge verteilt: Jedes Fünftel bekommt, wenn es einen starken O-Ton hat, mindestens einen, und zwei O-Töne liegen nie dicht beieinander.

Die Sicht pro Stimme nimmt die Themen, zu denen diese Person tragend beiträgt, gewichtet nach ihrem Anteil daran.

### 4. Schreiben (`pipeline/src/write.ts`)

Claude bekommt nur die ausgewählten Themen, ihre Aussagen und die Originalstellen. Reihenfolge und Umfang sind vorgegeben. Jeder Satz muss seine Belegstellen nennen. Meinungen bleiben Meinungen und werden der Person zugeschrieben. Überschriften sind Aussagen, keine Etiketten.

### 5. Gegenprobe (`pipeline/src/verify.ts`)

Jeder Satz wird gegen seine Belegstellen geprüft. Nicht belegt: Er fliegt raus. Teilweise belegt: Er wird auf das Belegte zurückgeschnitten.

### Frag die Folge (`worker/src/ask.ts`)

Antworten kommen nur aus dem Transkript und müssen auf Abschnitte verweisen, die es gibt. Ohne gültigen Beleg steht da: „Dazu kommt in der Folge nichts vor.“

## Stellschrauben

Gewichte und Schwellen stehen oben in `pipeline/src/salience.ts`. Die Tests in `pipeline/test/salience.test.ts` zeigen, wie sie wirken. Wenn sich eine Folge falsch gewichtet anfühlt: Das Protokoll des Laufs in GitHub Actions zeigt pro Thema Sendezeit, Gewicht und Einordnung (ohne Inhalte).
