import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { computeBenchProgressConfidence, qualifyBenchProgressObservation } from '../../../tools/bench/language/logging.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const { dir } = await prepareTestCacheDir('bench-language-confidence-missingness');
const report = async (name, rows) => {
  const root = path.join(dir, name), logs = path.join(root, 'logs', 'bench-language');
  await fs.mkdir(logs, { recursive: true });
  for (const scope of ['repo-a', 'all']) await fs.writeFile(path.join(logs, `run-confidence-${scope}.progress-confidence.jsonl`),
    rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const output = await buildReportOutput({ configPath: path.join(root, 'repos.json'), resultsRoot: root, cacheRoot: root,
    results: [], config: {}, runSuffix: 'confidence' });
  assert.equal(output.diagnostics.streamRead.metrics.fileOpens, 2);
  return output.diagnostics.progressConfidence;
};
const unknown = { schemaVersion: 1, label: 'repo-a', ts: '2026-10-26T00:00:00Z', score: null, bucket: 'unknown' };
const known = { ...unknown, ts: '2026-10-26T00:00:01Z', score: 0.8, bucket: 'high' };
const mixed = await report('legacy', [unknown, known]);
assert.equal(mixed.eventCount, 2);
assert.equal(mixed.rawEventCount, 4);
assert.equal(mixed.duplicateEventCount, 2);
assert.equal(mixed.avgScore, 0.8); assert.equal(mixed.minScore, 0.8); assert.equal(mixed.maxScore, 0.8);
assert.deepEqual(mixed.scoreCoverage, { observed: 1, unknown: 1 });
assert.equal(mixed.countsByBucket.unknown, 1);
assert.equal(mixed.lowConfidenceEvents.length, 1, 'unknown is not ranked as measured low confidence');
const zero = await report('zero', [unknown, known, { ...unknown, ts: '2026-10-26T00:00:02Z', score: 0, bucket: 'low' }]);
assert.equal(zero.avgScore, 0.4); assert.equal(zero.minScore, 0);
assert.deepEqual(zero.scoreCoverage, { observed: 2, unknown: 1 });

const measured = computeBenchProgressConfidence({ heartbeatRegularityScore: 0.8, heartbeatSamples: 2 });
const observed = qualifyBenchProgressObservation(measured, { nowMs: 1000, firstObservedAtMs: 0, lastObservedAtMs: 900 });
const stale = qualifyBenchProgressObservation(measured, { nowMs: 31000, firstObservedAtMs: 0, lastObservedAtMs: 900 });
const rows = [false, true, '', '0.8'].map((score, index) => ({ ...unknown, ts: `2026-10-26T00:00:0${index}Z`, score }));
rows.push({ ...observed, label: 'repo-a', ts: '2026-10-26T00:00:05Z', executionId: 'fixture' },
  { ...stale, label: 'repo-a', ts: '2026-10-26T00:00:06Z', executionId: 'fixture' },
  { ...observed, label: 'repo-a', ts: '2026-10-26T00:00:07Z', score: 1, components: {}, executionId: 'fixture' });
const admitted = await report('typed-and-stale', rows);
assert.ok(Math.abs(admitted.avgScore - 0.8) < 1e-12);
assert.ok(Math.abs(admitted.minScore - 0.8) < 1e-12);
assert.deepEqual(admitted.scoreCoverage, { observed: 1, unknown: 6 });
assert.equal(admitted.latestByLabel[0].score, null, 'current unsupported score cannot become measured through replay');
assert.equal(admitted.latestByLabel[0].observation.view, 'last-observed-snapshot');
const staleOnly = await report('stale', [{ ...stale, label: 'repo-a', ts: '2026-10-26T00:00:08Z' }]);
assert.equal(staleOnly.avgScore, null); assert.equal(staleOnly.minScore, null);
assert.equal(staleOnly.latestByLabel[0].observation.state, 'stale');
assert.equal(staleOnly.latestByLabel[0].observation.ageMs, 30100);
assert.equal(staleOnly.lowConfidenceEvents.length, 0);
console.log('benchmark confidence replay preserves unknown and observed zero');
