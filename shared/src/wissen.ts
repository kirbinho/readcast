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

export const HALTBARKEITEN = ['Prinzip', 'Praxis', 'Stand', 'Prognose'] as const;

/** Freigabe Arbeit: gesetzt, sobald eines dieser Themen dabei ist (Regel aus dem Notion-Skill). */
export const FREIGABE_THEMEN = ['KI & Technologie', 'Medien & Journalismus', 'Marketing & Kommunikation'];

/** Die Regeln, nach denen die Pipeline die Felder einstuft. Wörtlich aus dem Notion-Skill übernommen und gekürzt. */
export const EINSTUFUNGSREGELN = `
- Titel: maximal 60 Zeichen, maximale Aussagekraft. Gute Titel sind Aussagen, keine Etiketten.
- Thema (höchstens 2): die zwei wichtigsten passenden Optionen. Sagt die Folge substanziell etwas über KI oder Technologie, muss „KI & Technologie“ dabei sein.
- Kontext: „ZEIT / Beruf“ für beruflich Verwertbares (Medien, Journalismus, Marketing, KI, Organisation), „Allgemein“ für politischen und gesellschaftlichen Diskurs, „Privat & Familie“ für Privates.
- Sensibel: setzen bei Gesundheit, Diagnosen, Kinderwunsch und Schwangerschaft, Finanzen und Verträgen der Familie, beruflichen Überlegungen zu Wechsel, Exit oder Verhandlung. Allgemeines Sachwissen zu diesen Themen ist nicht sensibel. Bei einem öffentlichen Podcast fast immer nein.
- Evidenzgrad: Zahlen und belegte Fakten = Daten/Fakt. Untersuchungen und Reports = Studie. Einschätzung einer qualifizierten Person = Fachmeinung. Kommentare und Meinungen = Meinung/Essay. Eigene Beobachtungen = Erfahrung. Für ein Gespräch meist Fachmeinung oder Meinung/Essay.
- ZEIT-intern: nur, wenn die Aussagen von einer handelnden Person aus dem ZEIT Verlag stammen (Geschäftsführung, Chefredaktion). Externe Gespräche über die ZEIT zählen nicht. Im Zweifel nein.
- Haltbarkeit, nur wenn Thema „KI & Technologie“ enthält, sonst null. Sie sagt, wovon eine Aussage abhängt:
  Prinzip: Konzepte, Denkmodelle, Methodik, Erkenntnisse über Menschen, Organisationen und Ökonomie. Aussagen über Modell- oder Werkzeugverhalten sind nie Prinzip.
  Praxis: Vorgehensweisen, Governance-Muster, Marktlogik, Rollenbilder, Anbieterstrategien.
  Stand: Modellfähigkeiten, Preise, Benchmarks, Toolfeatures, Rechtsstände, konkrete Zahlen.
  Prognose: Aussagen über die Zukunft.
  Im Zweifel die volatilere Klasse. Bei gemischten Inhalten die volatilste vorkommende Klasse.
- Haltbarkeitsnotiz: Begründung in höchstens zehn Wörtern, bei gemischten Inhalten „gemischt, volatilster Teil: …“. Nur mit Haltbarkeit.
- Horizont: nur bei Prognose und nur, wenn ein Zieldatum genannt wird (nur ein Jahr: der 31.12. dieses Jahres), Format JJJJ-MM-TT. Nie schätzen.
- Kernaussagen: nur wenn Thema „KI & Technologie“ enthält und die Aussagen aus mehr als einer Haltbarkeitsklasse stammen. Höchstens 15 tragende Aussagen, je ein Satz, inhaltlich unverändert, je ein Marker: Prinzip, Praxis, Stand oder Prognose (bei Prognose mit Zieljahr, falls genannt, als „Prognose|2027“). Sonst leer.
`.trim();
