import { captureEvaluationJudgment } from './judgments.js';
import { captureEvaluationHit } from './hit-evidence.js';

const MATCH_MODES = new Set(['substring', 'exact']);

export function resolveMatchMode(raw) {
  if (raw == null) return 'substring';
  const mode = String(raw).trim();
  if (!MATCH_MODES.has(mode)) {
    throw new Error(`Invalid match mode "${mode}". Use exact|substring.`);
  }
  return mode;
}

export function matchExpected(hit, expected, matchMode) {
  expected = captureEvaluationJudgment(expected);
  matchMode = resolveMatchMode(matchMode);
  if (!hit) return false;
  hit = captureEvaluationHit(hit);
  if (expected.file && hit.file !== expected.file) return false;
  if (expected.name) {
    const hitName = typeof hit.name === 'string' ? hit.name.toLowerCase() : '';
    const expectedName = expected.name.toLowerCase();
    if (matchMode === 'exact') {
      if (hitName !== expectedName) return false;
    } else {
      if (!hitName.includes(expectedName)) return false;
    }
  }
  if (expected.kind) {
    if (typeof hit.kind !== 'string' || hit.kind.toLowerCase() !== expected.kind.toLowerCase()) {
      return false;
    }
  }
  return true;
}

