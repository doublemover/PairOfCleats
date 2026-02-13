#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../../../../src/shared/stable-json.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { USR_DIAGNOSTIC_REMEDIATION_CLASS_BY_CODE } from '../../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');
const loadRows = (fileName) => {
  const payload = JSON.parse(fs.readFileSync(path.join(matrixDir, fileName), 'utf8'));
  return Array.isArray(payload.rows) ? payload.rows : [];
};

const assertSortedBy = (rows, keySelector, label) => {
  const ordered = [...rows].sort((a, b) => keySelector(a).localeCompare(keySelector(b)));
  assert.deepEqual(rows, ordered, `${label} rows must be deterministically sorted`);
};

assertSortedBy(loadRows('usr-language-profiles.json'), (row) => String(row.id || ''), 'language profile');
assertSortedBy(loadRows('usr-framework-profiles.json'), (row) => String(row.id || ''), 'framework profile');
assertSortedBy(loadRows('usr-fixture-governance.json'), (row) => String(row.fixtureId || ''), 'fixture-governance');
assertSortedBy(loadRows('usr-failure-injection-matrix.json'), (row) => String(row.id || ''), 'failure-injection');
assertSortedBy(loadRows('usr-threat-model-matrix.json'), (row) => String(row.id || ''), 'threat-model');
assertSortedBy(loadRows('usr-waiver-policy.json'), (row) => String(row.id || ''), 'waiver-policy');
assertSortedBy(loadRows('usr-benchmark-policy.json'), (row) => String(row.id || ''), 'benchmark-policy');
assertSortedBy(loadRows('usr-parser-runtime-lock.json'), (row) => `${row.parserSource || ''}:${row.languageId || ''}`, 'parser-runtime-lock');

for (const relativePath of [
  'tests/fixtures/usr/canonical-examples/usr-canonical-example-bundle.json',
  'tests/fixtures/usr/framework-canonicalization/usr-framework-canonicalization-bundle.json',
  'tests/fixtures/usr/embedding-bridges/usr-embedding-bridge-bundle.json',
  'tests/fixtures/usr/generated-provenance/usr-generated-provenance-bundle.json',
  'tests/lang/matrix/usr-failure-injection-matrix.json',
  'tests/lang/matrix/usr-security-gates.json',
  'tests/lang/matrix/usr-slo-budgets.json'
]) {
  const raw = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const digestA = sha1(stableStringify(JSON.parse(raw)));
  const digestB = sha1(stableStringify(JSON.parse(raw)));
  assert.equal(digestA, digestB, `serialization must be deterministic across reruns: ${relativePath}`);
}

const failureRows = loadRows('usr-failure-injection-matrix.json');
const capRow = failureRows.find((row) => row.faultClass === 'resolution-ambiguity-overflow');
assert.equal(Boolean(capRow), true, 'failure-injection matrix must include cap-triggered ambiguity scenario');
assert.equal((capRow.requiredDiagnostics || []).includes('USR-W-RESOLUTION-CANDIDATE-CAPPED'), true, 'cap-triggered ambiguity scenario must emit capped-candidate diagnostic');
assert.equal((capRow.requiredReasonCodes || []).includes('USR-R-CANDIDATE-CAP-EXCEEDED'), true, 'cap-triggered ambiguity scenario must emit candidate-cap reason code');
assert.equal(capRow.strictExpectedOutcome, 'degrade-with-diagnostics', 'cap-triggered ambiguity strict outcome must degrade with diagnostics');

const securityGates = loadRows('usr-security-gates.json');
const reportSizeGate = securityGates.find((row) => row.id === 'security-gate-report-size-cap');
assert.equal(Boolean(reportSizeGate), true, 'security gate matrix must include report-size-cap gate');
assert.equal(reportSizeGate.enforcement, 'warn', 'report-size-cap gate must enforce warn behavior');
assert.equal(reportSizeGate.blocking, false, 'report-size-cap gate must remain non-blocking');

assert.equal(USR_DIAGNOSTIC_REMEDIATION_CLASS_BY_CODE['USR-W-TRUNCATED-FLOW'], 'analysis-caps', 'truncated-flow diagnostic must route to analysis-caps remediation class');
assert.equal(USR_DIAGNOSTIC_REMEDIATION_CLASS_BY_CODE['USR-W-RESOLUTION-CANDIDATE-CAPPED'], 'graph-integrity', 'candidate-capped diagnostic must route to graph-integrity remediation class');

const sloRows = loadRows('usr-slo-budgets.json');
const requiredLanes = [
  'ci',
  'ci-long',
  'lang-smoke',
  'lang-framework-canonicalization',
  'lang-batch-javascript-typescript',
  'lang-batch-systems-languages',
  'lang-batch-managed-languages',
  'lang-batch-dynamic-languages',
  'lang-batch-markup-style-template',
  'lang-batch-data-interface-dsl',
  'lang-batch-build-infra-dsl'
];
for (const laneId of requiredLanes) {
  const row = sloRows.find((candidate) => candidate.laneId === laneId && candidate.blocking === true);
  assert.equal(Boolean(row), true, `blocking SLO budget row required for lane: ${laneId}`);
  assert.equal(row.maxDurationMs > 0, true, `SLO maxDurationMs must be positive: ${laneId}`);
  assert.equal(row.maxMemoryMb > 0, true, `SLO maxMemoryMb must be positive: ${laneId}`);
  assert.equal(row.maxParserTimePerSegmentMs > 0, true, `SLO maxParserTimePerSegmentMs must be positive: ${laneId}`);
}

console.log('usr phase-8 hardening readiness validation checks passed');
