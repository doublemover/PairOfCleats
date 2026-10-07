import assert from 'node:assert/strict';

// Only the May 20-22 checkpoint's local evidence is allowed to be absent from a
// clean checkout. This is not a policy for current or future release evidence.
const CHECKPOINT_START = Date.parse('2026-05-20T00:00:00Z');
const CHECKPOINT_END = Date.parse('2026-05-23T00:00:00Z');
const CHECKPOINT_OUTPUTS = new Set([
  'temp/validation',
  'temp/validation/',
  'temp/jscpd',
  'temp/jscpd/',
  'temp/jscpd/jscpd-report.json',
  'temp/jscpd/jscpd-report.md',
  '.testLogs/bench-sweet16.json',
  // Undated filenames explicitly cited by the May 21 duplicate checkpoint.
  'temp/validation/vfs-manifest-writer-fixture.log',
  'temp/validation/node-check-provider-preflight.log',
  'temp/validation/eslint-provider-preflight.log',
  'temp/validation/focused-lsp-provider-tests.log',
  'temp/validation/tree-sitter-process-file-cpu-fixture-validation.log',
  'temp/validation/vscode-runtime-dedupe-node-check.log',
  'temp/validation/vscode-runtime-dedupe-eslint.log',
  'temp/validation/vscode-runtime-dedupe-focused-tests-rerun.log'
]);

export const isHistoricalEvidencePath = (value) => {
  const normalized = value.replace(/\\/g, '/');
  if (CHECKPOINT_OUTPUTS.has(normalized)) return true;
  if (/^temp\/(?:validation|jscpd)\//.test(normalized)
    && /(?:202605(?:20|21|22)|2026-05-(?:20|21|22))/.test(normalized)) return true;
  const run = normalized.match(/^\.testLogs\/run-(\d+)-[a-z0-9]+$/);
  return Boolean(run && Number(run[1]) >= CHECKPOINT_START && Number(run[1]) < CHECKPOINT_END);
};

export const assertEvidenceAvailability = (paths, exists, label) => {
  assert.ok(paths.length > 0, `required evidence bundle has no references: ${label}`);
  const missing = paths.filter((entry) => !exists(entry));
  if (missing.length === paths.length && paths.every(isHistoricalEvidencePath)) return false;
  assert.deepEqual(missing, [], `required evidence bundle is incomplete: ${label}`);
  return true;
};

export const assertEvidencePassingProof = (available, hasPassingProof, label) => {
  if (!available) return;
  assert.equal(hasPassingProof, true, `release evidence row must cite a log with explicit passing proof: ${label}`);
};
