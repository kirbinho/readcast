// Stimmen Namen zuordnen: aus Shownotes, Feed und dem, was im Gespräch gesagt wird.
// Ein Name gilt nur, wenn er in einer dieser Quellen tatsächlich vorkommt.

import { z } from 'zod';
import type { EpisodeMeta, Segment, Speaker } from '../../shared/src/types.ts';
import { normalizeForMatch } from '../../shared/src/text.ts';
import { UNTRUSTED_NOTE, callJson, fence } from './claude.ts';
import { renderTranscript, type VoiceStat } from './segments.ts';

const Schema = z.object({
  besetzung: z.array(z.object({ name: z.string(), rolle: z.enum(['host', 'gast']) })),
  stimmen: z.array(
    z.object({
      label: z.string(),
      name: z.string().nullable(),
      rolle: z.enum(['host', 'gast', 'sonstige']),
      quelle: z.enum(['shownotes', 'feed', 'titel', 'gespraech', 'keine']),
      beleg: z.string(),
    }),
  ),
});

const INTRO = /\b(ich bin|mein name|ich heiße|mein gast|zu gast|willkommen|begrüße|hallo|herzlich|neben mir|mit mir|i'm|i am|my name|my guest|welcome|joining me|with me)\b/i;

function samplesFor(label: string, segments: Segment[]): Segment[] {
  const own = segments.filter((s) => s.spk === label);
  const picks = new Set<Segment>(own.slice(0, 4));
  for (const s of own) if (INTRO.test(s.text) && picks.size < 9) picks.add(s);
  return [...picks].sort((a, b) => a.start - b.start);
}

export async function nameSpeakers(meta: EpisodeMeta, segments: Segment[], stats: VoiceStat[]): Promise<Speaker[]> {
  const opening = segments.filter((s) => s.start < 240_000);
  const perVoice = stats
    .map((v) => `Stimme ${v.label} (${Math.round(v.share * 100)} % Sprechzeit, ${v.turns} Redebeiträge, davon ${v.shortTurns} kurze):\n${renderTranscript(samplesFor(v.label, segments), {})}`)
    .join('\n\n');

  const res = await callJson({
    stage: 'Stimmen',
    effort: 'low',
    maxTokens: 8000,
    schema: Schema,
    system: `Du ordnest den Stimmen eines Podcasts Namen zu. ${UNTRUSTED_NOTE}

Regeln:
- besetzung: alle, die laut Folgentitel, Shownotes oder Autor im Feed an diesem Gespräch teilnehmen, mit rolle host oder gast, auch wenn du sie noch keiner Stimme zuordnen kannst. Beispiel: „Christian Sewing im Gespräch mit Rainer Esser“ in einer Reihe, in der Rainer Esser spricht, ergibt Esser als host und Sewing als gast. Nicht dazu gehören Personen, über die nur gesprochen wird, die Produktion und Einspieler.
- Vergib einen Namen nur, wenn er in den Shownotes, im Feed, im Folgentitel oder im Gespräch steht und klar dieser Stimme gehört (sie stellt sich vor, wird mit Namen angesprochen oder begrüßt, oder die Shownotes nennen genau diese Rolle).
- Nennen die Shownotes genau einen Host, gehört dieser Name der Stimme, die durch die Folge führt.
- Rate sonst nie. Ohne klaren Beleg: name = null, quelle = "keine".
- beleg: die Fundstelle wörtlich, kurz.
- rolle: Entscheidend ist, wer wirklich an diesem Gespräch teilnimmt.
  host: führt durch die Folge. Steht in den Shownotes nur ein Host, gibt es genau einen.
  gast: spricht im selben Gespräch mit dem Host, antwortet und wird angesprochen.
  sonstige: alles, was nur eingeblendet oder eingespielt wird und nicht am Gespräch teilnimmt: Konferenzredner, O-Töne, Interviewausschnitte und Archivmaterial, Nachrichten, Zitate von Sprechern, Werbesprecher, Jingles.
  Viele Stimmen mit wenigen, längeren Beiträgen, die der Host einordnet, sind Einspieler und keine Gäste. Im Zweifel sonstige.
- Wer in den Shownotes nur zur Produktion genannt wird, ist keine Stimme.
- Auch ein Einspieler bekommt nur dann einen Namen, wenn er klar belegt ist.
- Gib jede Stimme genau einmal zurück, mit ihrem label.`,
    user: [
      `Sendung: ${meta.show}`,
      `Folge: ${meta.title}`,
      `Autor im Feed: ${meta.feedAuthor ?? '–'}`,
      fence('shownotes', meta.description.slice(0, 4000)),
      fence('anfang', renderTranscript(opening, {})),
      fence('stimmen', perVoice),
    ].join('\n\n'),
  });

  const corpus = normalizeForMatch([meta.show, meta.title, meta.feedAuthor ?? '', meta.description, ...segments.map((s) => s.text)].join(' '));
  const byLabel = new Map(res.stimmen.map((s) => [s.label, s]));

  const loudest = stats[0]?.label;
  const speakers: Speaker[] = stats.map((v) => {
    const r = byLabel.get(v.label);
    let name = r?.name?.trim() || null;
    // Gegenprobe: Der Nachname muss im Material vorkommen
    if (name) {
      const last = normalizeForMatch(name).split(' ').filter((t) => t.length >= 3).pop();
      if (!last || !corpus.includes(last)) name = null;
    }
    const role = decideRole(v, v.label === loudest, r?.rolle);
    return {
      label: v.label,
      name,
      short: name ?? (role === 'sonstige' ? 'Einspieler' : `Stimme ${v.label}`),
      role,
      source: name ? (r?.quelle ?? null) : null,
      shareOfTalk: v.share,
    };
  });

  applyCast(speakers, stats, res.besetzung.filter((c) => {
    const last = normalizeForMatch(c.name).split(' ').filter((t) => t.length >= 3).pop();
    return !!last && corpus.includes(last);
  }));

  // Nennen die Shownotes genau einen Host, ist das die Stimme, die durch die Folge führt
  const hosts = hostsFromShownotes(meta.description);
  const lead = speakers[0];
  if (hosts.length === 1 && lead && !lead.name && !speakers.some((s) => s.name === hosts[0])) {
    lead.name = hosts[0];
    lead.short = hosts[0];
    lead.source = 'shownotes';
  }

  // Kurzname: Nachname, außer zwei Stimmen teilen ihn
  const lastNames = speakers.map((s) => s.name?.split(/\s+/).pop() ?? null);
  speakers.forEach((s, i) => {
    if (!s.name) return;
    const ln = lastNames[i]!;
    s.short = lastNames.filter((x) => x === ln).length > 1 ? s.name : ln;
  });
  return speakers;
}

/** So heißt eine Stimme im Text: Name, sonst „Einspieler“ oder „Stimme B“. */
export function displayName(s: Speaker): string {
  return s.name ?? (s.role === 'sonstige' ? 'Einspieler' : `Stimme ${s.label}`);
}

/**
 * Liest die Moderation aus den Shownotes, etwa „Host: Khesrau Behroz“ oder „Moderation: A und B“.
 * Zeilen zur Produktion zählen nicht.
 */
export function hostsFromShownotes(description: string): string[] {
  const line = description.match(/^\s*(?:hosts?|moderation|moderiert von|hosted by|presented by|von und mit)\s*:?\s+(.+)$/im)?.[1];
  if (!line) return [];
  return line
    .split(/,|&|\bund\b|\band\b/)
    .map((n) => n.trim().replace(/[.;]$/, ''))
    .filter((n) => /^\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}?[\p{L}'’.-]+){1,3}$/u.test(n));
}

const MIN_SHORT_TURNS = 3;
const MIN_TURNS = 6;

/**
 * Gesprächspartner ist nur, wer laut Einschätzung Host oder Gast ist und auch wirklich im Wechsel mit anderen spricht:
 * oft kurz oder, wie Gäste mit langen Antworten, immer wieder.
 * Die lauteste Stimme führt immer durch die Folge. Alles andere sind Einspieler: Konferenzredner, O-Töne, Archivmaterial, Werbung.
 */
export function decideRole(v: VoiceStat, isLoudest: boolean, modelRole: Speaker['role'] | undefined): Speaker['role'] {
  if (isLoudest) return modelRole === 'gast' || modelRole === 'host' ? modelRole : 'host';
  if (!v.significant || (modelRole !== 'host' && modelRole !== 'gast')) return 'sonstige';
  return v.shortTurns >= MIN_SHORT_TURNS || v.turns >= MIN_TURNS ? modelRole : 'sonstige';
}

/**
 * Trägt die Besetzung aus Shownotes und Titel ein, wenn die Zuordnung zur Stimme offen blieb.
 * Das Gespräch verrät die Rollen: Der Host fragt, der Gast antwortet.
 * Mit mehr als einem Host oder Gast gibt es diesen eindeutigen Schluss nicht, dann bleibt es bei der Einschätzung.
 */
export function applyCast(speakers: Speaker[], stats: VoiceStat[], cast: { name: string; rolle: 'host' | 'gast' }[]): void {
  const taken = new Set(speakers.flatMap((s) => (s.name ? [normalizeForMatch(s.name)] : [])));
  const open = cast.filter((c) => !taken.has(normalizeForMatch(c.name)));
  const hosts = open.filter((c) => c.rolle === 'host');
  const guests = open.filter((c) => c.rolle === 'gast');
  if (hosts.length > 1 || guests.length > 1) return;
  const statOf = new Map(stats.map((v) => [v.label, v]));
  const free = speakers.filter((s) => !s.name && statOf.get(s.label)?.significant);
  const put = (s: Speaker | undefined, name: string, role: Speaker['role']) => {
    if (!s) return;
    s.name = name;
    s.short = name;
    s.role = role;
    s.source = 'shownotes';
  };
  if (hosts.length === 1 && guests.length === 1) {
    // Die beiden Stimmen mit der meisten Sprechzeit führen das Gespräch, wer mehr fragt, ist der Host
    const [a, b] = [...free].sort((x, y) => statOf.get(y.label)!.ms - statOf.get(x.label)!.ms);
    if (!a || !b) return;
    const aAsks = statOf.get(a.label)!.questionShare >= statOf.get(b.label)!.questionShare;
    put(aAsks ? a : b, hosts[0].name, 'host');
    put(aAsks ? b : a, guests[0].name, 'gast');
  } else if (hosts.length === 1) {
    const named = speakers.some((s) => s.name && s.role === 'gast');
    // Steht der Gast schon fest, ist der Host die verbleibende Stimme mit den meisten Fragen, sonst die lauteste
    const pick = named ? [...free].sort((x, y) => statOf.get(y.label)!.questionShare - statOf.get(x.label)!.questionShare)[0] : free[0];
    put(pick, hosts[0].name, 'host');
  } else if (guests.length === 1) {
    const pick = [...free].sort((x, y) => statOf.get(x.label)!.questionShare - statOf.get(y.label)!.questionShare)[0];
    put(pick, guests[0].name, 'gast');
  }
}

/**
 * Bekommt dieselbe Person zwei Kennungen (die Sprechererkennung trennt manchmal eine Stimme),
 * werden sie zusammengelegt.
 */
export function mergeSameNames(segments: Segment[], speakers: Speaker[]): { segments: Segment[]; speakers: Speaker[] } {
  const keep = new Map<string, Speaker>();
  const remap = new Map<string, string>();
  for (const s of [...speakers].sort((a, b) => b.shareOfTalk - a.shareOfTalk)) {
    const key = s.name ? normalizeForMatch(s.name) : `#${s.label}`;
    const first = keep.get(key);
    if (first) {
      remap.set(s.label, first.label);
      first.shareOfTalk += s.shareOfTalk;
      if (s.role !== 'sonstige') first.role = first.role === 'sonstige' ? s.role : first.role;
    } else keep.set(key, { ...s });
  }
  return {
    segments: segments.map((seg) => (remap.has(seg.spk) ? { ...seg, spk: remap.get(seg.spk)! } : seg)),
    speakers: [...keep.values()].sort((a, b) => b.shareOfTalk - a.shareOfTalk),
  };
}
