// Die Datenbank „Wissen“ in Tobis Notion: Optionen und Regeln aus dem Notion-Skill.
// Ändern sich Optionen in Notion, hier nachziehen.

export const WISSEN_DATA_SOURCE_ID = '30649306-ef8d-8072-9489-000b64679a0f';

export const THEMEN = [
  'KI & Technologie',
  'Marketing & Kommunikation',
  'Medien & Journalismus',
  'Wirtschaft & Märkte',
  'Organisation & Führung',
  'Recht & Regulierung',
  'Deutsche Politik',
  'Europapolitik',
  'Weltpolitik',
  'Gesellschaft',
  'Klima & Energie',
  'Gesundheit & Medizin',
  'Geld & Finanzen',
  'Sport & Training',
  'Outdoor & Reise',
  'Foto & Video',
  'Handwerk & Praxis',
  'Kultur & Kulinarik',
  'Sprache & Lernen',
] as const;

export const KONTEXTE = ['ZEIT / Beruf', 'Allgemein', 'Privat & Familie', 'varmi', 'Rolling Hekla'] as const;

export const EVIDENZGRADE = ['Daten/Fakt', 'Studie', 'Fachmeinung', 'Meinung/Essay', 'Erfahrung'] as const;

/** Freigabe Arbeit: gesetzt, sobald eines dieser Themen dabei ist (Regel aus dem Notion-Skill). */
export const FREIGABE_THEMEN = ['KI & Technologie', 'Medien & Journalismus', 'Marketing & Kommunikation'];

/** Schreibt nur Felder, die es in der Datenbank gerade gibt. So bricht die Ablage nicht ab, wenn sich Felder in Notion ändern. */
export function keepExistingProperties<T>(props: Record<string, T>, existing: Iterable<string>): { kept: Record<string, T>; dropped: string[] } {
  const names = new Set(existing);
  const kept: Record<string, T> = {};
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(props)) {
    if (names.has(name)) kept[name] = value;
    else dropped.push(name);
  }
  return { kept, dropped };
}

/** Die Regeln, nach denen die Pipeline die Felder einstuft. Wörtlich aus dem Notion-Skill übernommen und gekürzt. */
export const EINSTUFUNGSREGELN = `
- Titel: maximal 60 Zeichen, maximale Aussagekraft. Gute Titel sind Aussagen, keine Etiketten.
- Thema (höchstens 2): die zwei wichtigsten passenden Optionen. Sagt die Folge substanziell etwas über KI oder Technologie, muss „KI & Technologie“ dabei sein.
- Kontext: „ZEIT / Beruf“ für beruflich Verwertbares (Medien, Journalismus, Marketing, KI, Organisation), „Allgemein“ für politischen und gesellschaftlichen Diskurs, „Privat & Familie“ für Privates.
- Sensibel: setzen bei Gesundheit, Diagnosen, Kinderwunsch und Schwangerschaft, Finanzen und Verträgen der Familie, beruflichen Überlegungen zu Wechsel, Exit oder Verhandlung. Allgemeines Sachwissen zu diesen Themen ist nicht sensibel. Bei einem öffentlichen Podcast fast immer nein.
- Evidenzgrad: Zahlen und belegte Fakten = Daten/Fakt. Untersuchungen und Reports = Studie. Einschätzung einer qualifizierten Person = Fachmeinung. Kommentare und Meinungen = Meinung/Essay. Eigene Beobachtungen = Erfahrung. Für ein Gespräch meist Fachmeinung oder Meinung/Essay.
- ZEIT-intern: nur, wenn die Aussagen von einer handelnden Person aus dem ZEIT Verlag stammen (Geschäftsführung, Chefredaktion). Externe Gespräche über die ZEIT zählen nicht. Im Zweifel nein.
- zeitgebunden: zwei bis fünf Begriffe, was in der Essenz konkret veralten kann, etwa „Umfragezahlen, Preisindex“. Zeitgebunden sind Zahlen und Statistiken, Preise und Budgets, Modell-, Produkt- und Toolnamen samt Funktionen, Benchmarks, Rechtsstände und Fristen, Marktanteile, Personalien in Funktionen, Prognosen mit Zeitpunkt. Enthält die Essenz nichts davon (Essay, Denkmodell, Haltung), bleibt die Liste leer. Kein Eintrag aus Vorsicht.
- stand_zusatz: nur wenn die Essenz eine Erhebung nennt, die weit vor der Veröffentlichung liegt, etwa „Befragung April bis Juni 2026“. Sonst null.
`.trim();

export const SCHLUSSSATZ_ANFANG = 'Enthält zeitgebundene Angaben (';

/**
 * Der Schlusssatz aus dem Notion-Skill. Das Datum kommt nicht vom Modell:
 * Monat und Jahr von Publiziert am, ersatzweise vom Erfassungsdatum.
 */
export function schlusssatz(begriffe: string[], published: string | null, today: Date, zusatz: string | null = null): string | null {
  if (!begriffe.length) return null;
  const date = published ? new Date(published) : today;
  const monat = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(date);
  return `${SCHLUSSSATZ_ANFANG}${begriffe.join(', ')}). Stand der Quelle: ${monat}${zusatz ? ` (${zusatz})` : ''}. Vor Weiterverwendung prüfen.`;
}
