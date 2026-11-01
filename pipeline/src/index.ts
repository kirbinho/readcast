// Ablauf einer Folge, gestartet von GitHub Actions mit der Auftragsnummer.
// Protokolliert werden nur Schritte und Zahlen, keine Inhalte: Die Protokolle sind öffentlich.

import type { Results, Speaker } from '../../shared/src/types.ts';
import { MAX_EPISODE_SEC, TRANSCRIPTION_USD_PER_HOUR, analysisCeilingUsd, episodeCeilingUsd } from '../../shared/src/prices.ts';
import { MODEL, claudeSpent, setRunLimit } from './claude.ts';
import { RunLimitError, SafeError } from './errors.ts';
import { classify } from './classify.ts';
import { extractAll } from './extract.ts';
import * as report from './report.ts';
import { NotFoundError, resolveEpisode } from './resolve.ts';
import { pickQuotes, scoreTopics } from './salience.ts';
import { toSegments, voiceStats } from './segments.ts';
import { mergeSameNames, nameSpeakers } from './speakers.ts';
import { mergeTopics } from './topics.ts';
import { transcribe } from './transcribe.ts';
import { verifyEssenz, verifyItems } from './verify.ts';
import { writeEssenz, writePerson } from './write.ts';

const MAX_VOICES = 4;

const jobId = process.argv[2];
if (!jobId || !/^[a-z0-9-]{8,40}$/.test(jobId)) {
  console.error('Aufruf: tsx src/index.ts <auftrag>');
  process.exit(2);
}

let transcriptionUsd = 0;
const cost = () => transcriptionUsd + claudeSpent();
const log = (step: string) => console.log(`[${new Date().toISOString()}] ${step}`);
const BUDGET_TEXT = 'Das Budget für diesen Monat reicht für diese Folge nicht mehr. Ab dem 1. geht es weiter.';
const TOO_LONG_TEXT = 'Folgen über drei Stunden liest Readcast nicht aus.';
const COST_LIMIT_TEXT = 'Die Auswertung dieser Folge wäre zu teuer geworden und wurde gestoppt.';

async function run() {
  const job = await report.getJob(jobId);
  log('Suche die Folge');
  await report.progress(jobId, { status: 'sucht', progress: 3, costUsd: 0 });

  const meta = await resolveEpisode(job.link);
  if ((meta.durationSec ?? 0) > MAX_EPISODE_SEC) {
    await report.fail(jobId, { status: 'fehler', error: TOO_LONG_TEXT, costUsd: 0 });
    return;
  }
  // Ohne Längenangabe im Feed wird die Höchstlänge reserviert
  const duration = meta.durationSec ?? MAX_EPISODE_SEC;
  if (!(await report.reserve(jobId, episodeCeilingUsd(duration, MODEL))).ok) {
    await report.fail(jobId, { status: 'budget', error: BUDGET_TEXT, costUsd: 0 });
    return;
  }
  // Grobe Dauer: Transkription etwa ein Zehntel der Laufzeit, Auswertung drei bis sechs Minuten
  const etaTotal = Math.max(120, duration * 0.1) + 240;
  await report.progress(jobId, { status: 'hoert', progress: 8, costUsd: 0, etaSec: Math.round(etaTotal), meta });

  log('Transkription läuft');
  const tStart = Date.now();
  const transcript = await transcribe(meta, async (elapsed) => {
    const expected = Math.max(90, duration * 0.1);
    const p = 8 + Math.min(40, (elapsed / expected) * 40);
    await report.progress(jobId, { status: 'hoert', progress: Math.round(p), costUsd: 0, etaSec: Math.max(60, Math.round(etaTotal - (Date.now() - tStart) / 1000)) });
  });
  transcriptionUsd = (transcript.durationSec / 3600) * TRANSCRIPTION_USD_PER_HOUR;
  log(`Transkript fertig: ${transcript.utterances.length} Äußerungen, ${Math.round(transcript.durationSec / 60)} Minuten`);

  // Kosten sofort verbuchen, damit sie auch bei einem späteren Absturz zählen
  await report.progress(jobId, { status: 'liest', progress: 50, costUsd: cost(), etaSec: 240 });

  // Der Feed kann eine falsche Länge nennen: lieber abbrechen als nur einen Teil auswerten
  if (transcript.durationSec > MAX_EPISODE_SEC) {
    await report.fail(jobId, { status: 'fehler', error: TOO_LONG_TEXT, costUsd: cost() });
    return;
  }

  // Jetzt ist die echte Länge bekannt: Reservierung und Kostengrenze darauf einstellen
  if (!(await report.reserve(jobId, transcriptionUsd + analysisCeilingUsd(transcript.durationSec, MODEL))).ok) {
    await report.fail(jobId, { status: 'budget', error: BUDGET_TEXT, costUsd: cost() });
    return;
  }
  setRunLimit(analysisCeilingUsd(transcript.durationSec, MODEL));

  let segments = toSegments(transcript.utterances);
  if (!segments.length) throw new SafeError('Im Transkript steht nichts.');
  await report.progress(jobId, { status: 'liest', progress: 52, costUsd: cost(), etaSec: 240 });

  // Stimmen benennen, doppelte Kennungen zusammenlegen, dann zählen
  const named = await nameSpeakers(meta, segments, voiceStats(segments));
  const merged = mergeSameNames(segments, named);
  segments = merged.segments;
  const stats = voiceStats(segments);
  const speakers: Speaker[] = merged.speakers.map((s) => {
    const v = stats.find((x) => x.label === s.label);
    return { ...s, shareOfTalk: v?.share ?? s.shareOfTalk, role: v && !v.significant ? 'sonstige' : s.role };
  });
  const voices = speakers.filter((s) => s.role !== 'sonstige');
  log(`${voices.length} Stimmen`);
  if (voices.length > MAX_VOICES) {
    await report.progress(jobId, { status: 'zu_viele', progress: 100, costUsd: cost(), speakers, speakerCount: voices.length });
    await report.fail(jobId, { status: 'zu_viele', error: `${voices.length} Stimmen erkannt.`, costUsd: cost() });
    return;
  }
  await report.progress(jobId, { status: 'liest', progress: 58, costUsd: cost(), etaSec: 200, speakers, speakerCount: voices.length });

  const names = Object.fromEntries(speakers.map((s) => [s.label, s.name ?? `Stimme ${s.label}`]));

  log('Lese Abschnitte');
  const wins = await extractAll(meta, segments, speakers);
  log(`${wins.reduce((a, w) => a + w.claims.length, 0)} Aussagen, ${wins.reduce((a, w) => a + w.quotes.length, 0)} O-Ton-Kandidaten`);
  await report.progress(jobId, { status: 'liest', progress: 74, costUsd: cost(), etaSec: 120 });

  log('Führe Themen zusammen');
  const topics = await mergeTopics(meta, wins, segments, names);
  const sel = scoreTopics(topics, wins, segments);
  for (const t of sel.scored) {
    log(`Thema ${t.topic.id}: ${(t.share * 100).toFixed(1)} % Sendezeit, Gewicht ${t.score.toFixed(2)}, ${sel.main.includes(t) ? 'Schwerpunkt' : sel.shorts.includes(t) ? 'Kurzmeldung' : 'raus'}`);
  }
  await report.progress(jobId, { status: 'schreibt', progress: 82, costUsd: cost(), etaSec: 90 });

  log('Schreibe Auswertungen');
  const quotes = wins.flatMap((w) => w.quotes);
  const [essenzRaw, ...people] = await Promise.all([
    writeEssenz(sel.main, sel.shorts, segments, names),
    ...voices.map((v) => writePerson(v, sel.scored, quotes, segments, names)),
  ]);
  await report.progress(jobId, { status: 'schreibt', progress: 92, costUsd: cost(), etaSec: 40 });

  log('Prüfe gegen das Transkript');
  const [essenz, ...checkedPeople] = await Promise.all([
    verifyEssenz(essenzRaw, segments, names),
    ...people.map((p, i) => verifyItems(`Person ${i + 1}`, p.blocks, segments, names)),
  ]);

  const segStart = new Map(segments.map((s) => [s.id, s.start]));
  const results: Results = {
    essenz,
    zehn: pickQuotes(quotes, segments).map((q) => ({ text: q.text, spk: q.spk, ts: segStart.get(q.seg) ?? 0 })),
    personen: Object.fromEntries(voices.map((v, i) => [v.label, { blocks: checkedPeople[i] }])),
  };

  log('Stufe für Notion ein');
  const notionMeta = await classify(meta, results, speakers);

  await report.finish(jobId, { results, speakers, segments, notionMeta, costUsd: cost() });
  log(`Fertig. Kosten ${cost().toFixed(3)} $`);
}

run().catch(async (e: unknown) => {
  const notFound = e instanceof NotFoundError;
  const overLimit = e instanceof RunLimitError;
  // Das Protokoll ist öffentlich: fremde Fehlertexte könnten Inhalte enthalten, deshalb nur ihre Art
  const text = e instanceof SafeError ? e.message : e instanceof Error ? e.name : 'unbekannt';
  console.error(notFound ? 'Folge nicht gefunden' : `Fehler: ${text}`);
  try {
    await report.fail(jobId, {
      status: notFound ? 'nicht_gefunden' : overLimit ? 'budget' : 'fehler',
      error: notFound ? (e as Error).message : overLimit ? COST_LIMIT_TEXT : 'Beim Auslesen ist etwas schiefgegangen. Versuch es später noch einmal.',
      costUsd: cost(),
    });
  } catch {
    // Worker nicht erreichbar: Der Auftrag bleibt hängen und läuft nach 90 Minuten ab
  }
  process.exit(1);
});
