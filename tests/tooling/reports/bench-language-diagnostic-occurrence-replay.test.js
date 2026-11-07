import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { createDiagnosticReplay } from '../../../tools/bench/language/diagnostic-replay.js';
import { BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION } from '../../../tools/bench/language/logging.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const { dir } = await prepareTestCacheDir('bench-language-diagnostic-occurrence-replay');
const execA = '00000000-0000-4000-8000-000000000001', execB = '00000000-0000-4000-8000-000000000002';
const event = (label, occurrence, executionId = execA, timeCostMs = 10) => ({
  schemaVersion: BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION, executionId, occurrence, costSemantics: 'occurrence-delta',
  label, ts: '2026-10-26T00:00:00Z', eventType: 'provider_request_failed', eventId: 'same-diagnostic-fingerprint',
  signature: 'same-failure-class', message: 'independent repeated observation', source: 'progress-event',
  severity: 'warn', timeCostMs, requestedCount: 2, reusedCount: null, fetchedCount: null, chunkCount: null
});
const replay = async (name, files) => {
  const root = path.join(dir, name), logs = path.join(root, 'logs', 'bench-language');
  await fs.mkdir(logs, { recursive: true });
  for (const [scope, rows] of files) await fs.writeFile(path.join(logs, `run-replay-${scope}.diagnostics.jsonl`),
    rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const output = await buildReportOutput({ configPath: path.join(root, 'repos.json'), cacheRoot: root,
    resultsRoot: root, results: [], config: {}, runSuffix: 'replay' });
  assert.equal(output.diagnostics.streamRead.metrics.fileOpens, files.length, 'transport remains single-pass');
  assert.equal(output.diagnostics.streamRead.incomplete, false);
  return output.diagnostics.stream;
};
const a1 = event('repo-a', 1), a2 = event('repo-a', 2);
const repeated = await replay('occurrences', [['repo-a', [a1, a2]], ['all', [a1, a2]]]);
assert.equal(repeated.eventCount, 1, 'fingerprint presence remains one for parity');
assert.equal(repeated.occurrenceCount, 2);
assert.equal(repeated.rawEventCount, 4);
assert.equal(repeated.duplicateEventCount, 2);
assert.equal(repeated.mirrorDuplicateCount, 2);
assert.equal(repeated.cost.timeCostMs, 20, 'independent process-summary oracle: two 10ms deltas');
assert.equal(repeated.cost.requestedCount, 4);
assert.equal(repeated.cost.reusedCount, null, 'unknown work does not become zero');
assert.equal(repeated.costCoverage.timeCostMs.state, 'complete');
assert.equal(repeated.costCoverage.reusedCount.unknown, 2);
assert.equal(repeated.identityCoverage.state, 'qualified');
assert.equal(repeated.countsByType.provider_request_failed, 1);

const b1 = event('repo-b', 1, execB);
const masterOnly = await replay('master-only', [['all', [a1, b1]]]);
assert.equal(masterOnly.eventCount, 2);
assert.equal(masterOnly.repoCountsByType.provider_request_failed, 2);
assert.equal(masterOnly.cost.timeCostMs, 20);
const fallback = await replay('fallback', [['all', [a1, b1]], ['repo-a', [a1]]]);
assert.equal(fallback.occurrenceCount, 2);
assert.equal(fallback.duplicateEventCount, 1);
assert.equal(fallback.cost.timeCostMs, 20);
assert.equal(fallback.repoCountsByType.provider_request_failed, 2, 'master B survives repo A having the same fingerprint');
const restart = event('repo-a', 1, execB, 7);
const restarted = await replay('restart', [['repo-a', [a1, a2, a1, restart]], ['all', [a1, a2, restart]]]);
assert.equal(restarted.eventCount, 1);
assert.equal(restarted.occurrenceCount, 3, 'reset local counter belongs to another execution');
assert.equal(restarted.cost.timeCostMs, 27);
assert.equal(restarted.duplicateEventCount, 4);
assert.equal(restarted.repeatedFingerprintOccurrenceCount, 2);
const reordered = await replay('reordered', [['repo-a', [a2, restart, a1]], ['all', [restart, a1, a2]]]);
assert.equal(reordered.cost.timeCostMs, 27);
assert.equal(reordered.occurrenceCount, 3);
assert.equal(reordered.eventCount, 1);

const legacy = [a1, a2].map(row => { const copy = { ...row, schemaVersion: 2 }; delete copy.executionId; delete copy.costSemantics; return copy; });
const old = await replay('legacy', [['repo-a', legacy], ['all', legacy]]);
assert.equal(old.cost.timeCostMs, 20);
assert.equal(old.occurrenceCount, 2);
assert.equal(old.duplicateEventCount, 2);
assert.equal(old.identityCoverage.state, 'legacy-unqualified');
assert.equal(old.identityCoverage.legacyOccurrences, 2);
const coercedProducer = await replay('previous-coercing-producer', [['repo-a', [a1, a2].map(row => ({ ...row, schemaVersion: 3 }))]]);
assert.equal(coercedProducer.eventCount, 1, 'historical fingerprint presence remains available');
assert.equal(coercedProducer.cost.timeCostMs, null, 'version 3 cannot supply corrected missing-cost authority');
assert.equal(coercedProducer.identityCoverage.invalidSemantics, 2);
assert.equal(coercedProducer.incomplete, true);
const unknown = await replay('unknown-label', [['repo-a', [a1]], ['all', [{ ...b1, label: null }]]]);
assert.equal(unknown.occurrenceCount, 2);
assert.equal(unknown.unknownRepoCountsByType.provider_request_failed, 1);
assert.equal(unknown.eventCount, 2, 'unknown master evidence cannot be merged into known repo A');

const context = { scope: 'repo-a', filePath: '/fixture/repo-a', masterFile: false };
const bounded = createDiagnosticReplay({ maxIdentities: 1 });
bounded.observe(a1, context); bounded.observe(a2, context);
assert.equal(bounded.summary().incomplete, true);
assert.equal(bounded.summary().identityCoverage.rejected, 1);
assert.equal(bounded.summary().costCoverage.timeCostMs.state, 'incomplete');
const conflict = createDiagnosticReplay();
conflict.observe(a1, context); conflict.observe({ ...a1, timeCostMs: 99 }, { ...context, filePath: '/fixture/master', masterFile: true });
assert.equal(conflict.summary().identityCoverage.conflictingCopies, 1);
assert.equal(conflict.summary().incomplete, true, 'conflicting same-occurrence copies cannot become complete evidence');
const cumulative = createDiagnosticReplay();
cumulative.observe({ ...a1, costSemantics: 'cumulative' }, context);
assert.equal(cumulative.summary().cost.timeCostMs, null);
assert.equal(cumulative.summary().identityCoverage.invalidSemantics, 1);
const future = createDiagnosticReplay();
future.observe({ ...a1, schemaVersion: 999 }, context);
assert.equal(future.summary().cost.timeCostMs, null);
assert.equal(future.summary().incomplete, true);
const numeric = createDiagnosticReplay();
for (const [index, value] of [null, '10', false, -1, Infinity, 0].entries()) numeric.observe(event('repo-a', index + 1, execA, value), context);
assert.equal(numeric.summary().cost.timeCostMs, 0);
assert.equal(numeric.summary().costCoverage.timeCostMs.observed, 1);
assert.equal(numeric.summary().costCoverage.timeCostMs.unknown, 5);
console.log('benchmark diagnostic repository/occurrence replay test passed');
