// Preise in US-Dollar. Stand 31.10.2026, bei Änderungen hier anpassen.
// Claude: platform.claude.com/pricing · AssemblyAI: assemblyai.com/pricing

export const CLAUDE_MODEL = 'claude-sonnet-5-5';

export const CLAUDE_PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  // Dollar pro Million Token
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

/** Universal-3.5 Pro 0,21 $ plus Sprechererkennung 0,02 $ pro Audiostunde. */
export const TRANSCRIPTION_USD_PER_HOUR = 0.23;

/** Längere Folgen liest Readcast nicht aus. Das begrenzt auch die Kosten eines einzelnen Laufs. */
export const MAX_EPISODE_SEC = 3 * 3600;

/** Geschätzte Auswertung pro Audiostunde mit Sonnet. Die Kostengrenze eines Laufs liegt beim Doppelten. */
const ANALYSIS_USD_PER_HOUR = 0.45;
const ANALYSIS_BASE_USD = 0.15;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function claudeCostUsd(model: string, u: Usage): number {
  // Antwortet nach einer Ablehnung ein anderes Modell, lieber zu hoch als zu niedrig verbuchen
  const p = CLAUDE_PRICES[model] ?? CLAUDE_PRICES['claude-opus-5-5'];
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000
  );
}

/** Höchstens so viel darf die Auswertung kosten, danach bricht der Lauf ab. */
export function analysisCeilingUsd(durationSec: number, model = CLAUDE_MODEL): number {
  const hours = Math.max(durationSec, 600) / 3600;
  const scale = (CLAUDE_PRICES[model] ?? CLAUDE_PRICES['claude-opus-5-5']).output / CLAUDE_PRICES['claude-sonnet-5-5'].output;
  return (ANALYSIS_BASE_USD + 2 * ANALYSIS_USD_PER_HOUR * hours) * scale;
}

/** Höchstkosten einer Folge. Dieser Betrag wird vor dem Start vom Budget reserviert. */
export function episodeCeilingUsd(durationSec: number, model = CLAUDE_MODEL): number {
  return (Math.max(durationSec, 600) / 3600) * TRANSCRIPTION_USD_PER_HOUR + analysisCeilingUsd(durationSec, model);
}
