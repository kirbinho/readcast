// Datenformen, die Pipeline, Worker und Web-App gemeinsam nutzen.

export type Status =
  | 'wartet' // angelegt, Pipeline noch nicht gestartet
  | 'sucht' // Link wird aufgelöst, Feed wird gelesen
  | 'hoert' // Transkription läuft
  | 'liest' // Schwerpunkte werden ausgelesen
  | 'schreibt' // Auswertungen werden geschrieben und geprüft
  | 'fertig'
  | 'nicht_gefunden' // kein öffentlicher Feed zur Folge
  | 'zu_viele' // mehr als vier Stimmen
  | 'budget' // Monatsbudget reicht nicht
  | 'fehler';

export const LAUFEND: Status[] = ['wartet', 'sucht', 'hoert', 'liest', 'schreibt'];

export interface ShownoteLink {
  title: string;
  url: string;
  domain: string;
}

export interface EpisodeMeta {
  show: string;
  title: string;
  published: string | null; // ISO-Datum
  durationSec: number | null;
  audioUrl: string;
  image: string | null;
  description: string; // Shownotes als Klartext
  links: ShownoteLink[];
  feedUrl: string;
  feedAuthor: string | null;
  episodeUrl: string | null;
  language: string | null; // aus dem Feed, z. B. "de"
}

/** Ein Abschnitt des Transkripts: eine Äußerung oder ein Teil davon. */
export interface Segment {
  id: string; // "s0042"
  spk: string; // Sprecherkennung der Diarisierung, z. B. "A"
  start: number; // ms
  end: number; // ms
  text: string;
}

export interface Speaker {
  label: string;
  name: string | null; // nur, wenn belegt
  short: string; // Anzeige auf dem Button, z. B. "Klöckner" oder "Stimme B"
  role: 'host' | 'gast' | 'sonstige';
  source: string | null; // woher der Name stammt
  shareOfTalk: number; // Anteil an der Sprechzeit, 0–1
}

export interface Sentence {
  text: string;
  segs: string[]; // Belege im Transkript
}

export interface Block {
  heading: string;
  sentences: Sentence[];
  ts: number; // ms, erste Fundstelle
  quote: { text: string; spk: string; ts: number } | null;
}

export interface Short {
  heading: string;
  sentences: Sentence[];
  ts: number;
}

export interface OTon {
  text: string;
  spk: string;
  ts: number;
}

export interface Results {
  essenz: { blocks: Block[]; shorts: Short[] };
  zehn: OTon[];
  personen: Record<string, { blocks: Block[] }>; // Schlüssel: Sprecherkennung
}

/** Was nach Notion geht, bereits nach den Regeln der Datenbank Wissen eingestuft. */
export interface NotionMeta {
  titel: string;
  themen: string[];
  kontext: string;
  evidenzgrad: string;
  sensibel: boolean;
  zeitIntern: boolean;
  haltbarkeit: string | null;
  haltbarkeitsnotiz: string | null;
  horizont: string | null;
  kernaussagen: { marker: string; text: string }[];
}

export interface QaEntry {
  q: string;
  found: boolean;
  answer: string;
  cites: { ts: number; spk: string }[];
  at: string;
}

/** Auswertungen, die nach Notion übertragen werden können. */
export type ModeKey = 'essenz' | 'zehn' | 'frag' | `p:${string}`;

export interface EpisodeView {
  id: string;
  link: string;
  status: Status;
  progress: number; // 0–100
  etaSec: number | null;
  error: string | null;
  meta: EpisodeMeta | null;
  speakers: Speaker[];
  speakerCount: number | null;
  results: Results | null;
  qa: QaEntry[];
  notion: { pageUrl: string | null; modes: ModeKey[]; canUndo: boolean };
  createdAt: string;
}

export interface RecentItem {
  id: string;
  show: string | null;
  title: string | null;
  published: string | null;
  durationSec: number | null;
  status: Status;
  inNotion: boolean;
  image: string | null;
}

export interface Budget {
  spentEur: number;
  capEur: number;
}
