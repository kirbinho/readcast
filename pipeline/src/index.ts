// Ablauf einer Folge, gestartet von GitHub Actions mit der Auftragsnummer.
// Protokolliert werden nur Schritte und Zahlen, keine Inhalte: Die Protokolle sind öffentlich.

import type { Results, Speaker } from '../../shared/src/types.ts';
import { TRANSCRIPTION_USD_PER_HOUR, estimateEpisodeUsd } from '../../shared/src/prices.ts';
import { claudeSpent } from './claude.ts';
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

async function run() {
  const job = await report.getJob(jobId);
  log('Suche die Folge');
  await report.progress(jobId, { status: 'sucht', progress: 3 });

  const meta = await resolveEpisode(job.link);
  const duration = meta.durationSec ?? 3600;
  const { ok } = await report.budgetCheck(jobId, estimateEpisodeUsd(duration));
  if (!ok) {
    await report.fail(jobId, { status: 'budget', error: 'Das Budget für diesen Monat reicht für diese Folge nicht mehr.', costUsd: 0 });
    return;
  }
  // Grobe Dauer: Transkription etwa ein Zehntel der Laufzeit, Auswertung drei bis sechs Minuten
  const etaTotal = Math.max(120, duration * 0.1) + 240;
  await report.progress(jobId, { status: 'hoert', progress: 8, etaSec: Math.round(etaTotal), meta });

  log('Transkription läuft');
  const tStart = Date.now();
  const transcript = await transcribe(meta, async (elapsed) => {
    const expected = Math.max(90, duration * 0.1);
    const p = 8 + Math.min(40, (elapsed / expected) * 40);
    await report.progress(jobId, { status: 'hoert', progress: Math.round(p), etaSec: Math.max(60, Math.round(etaTotal - (Date.now() - tStart) / 1000)) });
  });
  transcriptionUsd = (transcript.durationSec / 3600) * TRANSCRIPTION_USD_PER_HOUR;
  log(`Transkript fertig: ${transcript.utterances.length} Äußerungen, ${Math.round(transcript.durationSec / 60)} Minuten`);

  let segments = toSegments(transcript.utterances);
  if (!segments.length) throw new Error('Im Transkript steht nichts.');
  await report.progress(jobId, { status: 'liest', progress: 52, etaSec: 240 });

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
    await report.progress(jobId, { status: 'zu_viele', progress: 100, speakers, speakerCount: voices.length });
    await report.fail(jobId, { status: 'zu_viele', error: `${voices.length} Stimmen erkannt.`, costUsd: cost() });
    return;
  }
  await report.progress(jobId, { status: 'liest', progress: 58, etaSec: 200, speakers, speakerCount: voices.length });

  const names = Object.fromEntries(speakers.map((s) => [s.label, s.name ?? `Stimme ${s.label}`]));

  log('Lese Abschnitte');
  const wins = await extractAll(meta, segments, speakers);
  log(`${wins.reduce((a, w) => a + w.claims.length, 0)} Aussagen, ${wins.reduce((a, w) => a + w.quotes.length, 0)} O-Ton-Kandidaten`);
  await report.progress(jobId, { status: 'liest', progress: 74, etaSec: 120 });

  log('Führe Themen zusammen');
  const topics = await mergeTopics(meta, wins, segments, names);
  const sel = scoreTopics(topics, wins, segments);
  for (const t of sel.scored) {
    log(`Thema ${t.topic.id}: ${(t.share * 100).toFixed(1)} % Sendezeit, Gewicht ${t.score.toFixed(2)}, ${sel.main.includes(t) ? 'Schwerpunkt' : sel.shorts.includes(t) ? 'Kurzmeldung' : 'raus'}`);
  }
  await report.progress(jobId, { status: 'schreibt', progress: 82, etaSec: 90 });

  log('Schreibe Auswertungen');
  const quotes = wins.flatMap((w) => w.quotes);
  const [essenzRaw, ...people] = await Promise.all([
    writeEssenz(sel.main, sel.shorts, segments, names),
    ...voices.map((v) => writePerson(v, sel.scored, quotes, segments, names)),
  ]);
  await report.progress(jobId, { status: 'schreibt', progress: 92, etaSec: 40 });

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
  console.error(notFound ? 'Folge nicht gefunden' : `Fehler: ${e instanceof Error ? e.message.slice(0, 300) : 'unbekannt'}`);
  try {
    await report.fail(jobId, {
      status: notFound ? 'nicht_gefunden' : 'fehler',
      error: notFound ? (e as Error).message : 'Beim Auslesen ist etwas schiefgegangen. Versuch es später noch einmal.',
      costUsd: cost(),
    });
  } catch {
    // Worker nicht erreichbar: Der Auftrag bleibt hängen und läuft nach einer Stunde ab
  }
  process.exit(1);
});
