import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisCeilingUsd, claudeCostUsd, episodeCeilingUsd } from '../src/prices.ts';

test('Höchstkosten einer Folge liegen über der Schätzung, aber im Rahmen', () => {
  const ninety = episodeCeilingUsd(5400);
  assert.ok(ninety > 0.97, 'mehr als die geschätzten Kosten');
  assert.ok(ninety < 2.5, 'eine Folge kann das Budget nicht sprengen');
  assert.ok(episodeCeilingUsd(1200) < 0.6);
});

test('teureres Modell, höhere Grenze', () => {
  assert.equal(analysisCeilingUsd(3600, 'claude-opus-5-5'), analysisCeilingUsd(3600, 'claude-sonnet-5-5') * 2);
});

test('unbekanntes Modell wird nicht zu niedrig verbucht', () => {
  const u = { input_tokens: 1000, output_tokens: 1000 };
  assert.equal(claudeCostUsd('unbekannt', u), claudeCostUsd('claude-opus-5-5', u));
});
