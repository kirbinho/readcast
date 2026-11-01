// Transkription mit Sprechererkennung über AssemblyAI. Die Audiodatei lädt AssemblyAI selbst aus dem Feed.

import { MAX_EPISODE_SEC } from '../../shared/src/prices.ts';
import type { EpisodeMeta } from '../../shared/src/types.ts';
import { SafeError } from './errors.ts';

const BASE = 'https://api.assemblyai.com';

export interface Word {
  text: string;
  start: number;
  end: number;
  speaker: string | null;
}

export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  words: Word[];
}

export interface Transcript {
  id: string;
  language: string | null;
  durationSec: number;
  utterances: Utterance[];
}

function headers() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new SafeError('ASSEMBLYAI_API_KEY fehlt.');
  return { authorization: key, 'content-type': 'application/json' };
}

/** Namen und Sendung als Schreibhilfe, damit Eigennamen richtig im Transkript landen. */
function keyterms(meta: EpisodeMeta): string[] {
  const raw = [meta.show, ...(meta.feedAuthor ?? '').split(/,|&|\bund\b|\band\b/)];
  return [...new Set(raw.map((s) => s.trim()).filter((s) => s.length > 2 && s.split(/\s+/).length <= 6))].slice(0, 50);
}

/** Das Transkript bleibt nicht bei AssemblyAI liegen. Scheitert das Löschen, läuft die Auswertung trotzdem weiter. */
async function deleteTranscript(id: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}/v2/transcript/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) console.error(`Transkript nicht gelöscht (${res.status})`);
  } catch {
    console.error('Transkript nicht gelöscht');
  }
}

export async function transcribe(meta: EpisodeMeta, onWait: (elapsedSec: number) => Promise<void>): Promise<Transcript> {
  const submit = await fetch(`${BASE}/v2/transcript`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      audio_url: meta.audioUrl,
      // Schutz, falls der Feed eine falsche oder gar keine Länge nennt
      audio_end_at: MAX_EPISODE_SEC * 1000,
      speech_models: ['universal-3-5-pro', 'universal-2'],
      language_detection: true,
      speaker_labels: true,
      // Obergrenze über vier, damit eine fünfte Stimme erkannt und die Folge abgelehnt werden kann
      speaker_options: { min_speakers_expected: 1, max_speakers_expected: 6 },
      keyterms_prompt: keyterms(meta),
      format_text: true,
      punctuate: true,
    }),
  });
  if (!submit.ok) throw new SafeError(`Transkription nicht gestartet (${submit.status}).`);
  const { id } = (await submit.json()) as { id: string };

  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${BASE}/v2/transcript/${id}`, { headers: headers() });
    if (!res.ok) throw new SafeError(`Transkript nicht abrufbar (${res.status}).`);
    const t = (await res.json()) as {
      status: string;
      error?: string;
      language_code?: string;
      audio_duration?: number;
      utterances?: Utterance[];
    };
    if (t.status === 'completed') {
      await deleteTranscript(id);
      return { id, language: t.language_code ?? null, durationSec: t.audio_duration ?? 0, utterances: t.utterances ?? [] };
    }
    if (t.status === 'error') throw new SafeError(`Transkription fehlgeschlagen: ${t.error ?? 'unbekannt'}`);
    const elapsed = (Date.now() - started) / 1000;
    if (elapsed > 3600) throw new SafeError('Transkription dauert zu lange.');
    await onWait(elapsed);
  }
}
