import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { CACHE_MEASUREMENT_SHAPE } from '../../fixtures/benchmarks/tree-sitter-cache-workload.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
if (!process.argv[2]) throw new Error('Explicit fresh receipt directory required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output, { recursive: false });
const source = captureSweepSource(process.cwd()), observations = [];
for (let repetition = 1; repetition <= CACHE_MEASUREMENT_SHAPE.repetitions; repetition++) {
  const cohorts = CACHE_MEASUREMENT_SHAPE.queryModes.flatMap(useQueries => CACHE_MEASUREMENT_SHAPE.workerCounts.map(workers => ({ useQueries, workers })));
  for (const cohort of repetition % 2 ? cohorts : cohorts.toReversed()) {
    const name = `${cohort.useQueries ? 'query' : 'walk'}-${cohort.workers}-workers-${repetition}`;
    const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/tree-sitter-cache-process.js', JSON.stringify(cohort)],
      receiptPath: path.join(output, name + '-invocation.json'), maxOutputBytes: 4 * 1024 * 1024 });
    assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
    const report = JSON.parse(result.stdout); assert.equal(report.state, 'qualified-native-cache-observations');
    assert.equal(report.generatedWork.state, 'completed');
    const row = { repetition, ...cohort, capsuleMs: result.durationMs, report }; observations.push(row);
    await atomicWriteJson(path.join(output, name + '.json'), { historicalAuthorWorkspace: true, source, ...row }, { createOnly: true });
    console.log(JSON.stringify({ name, capsuleMs: result.durationMs, nativeProcessHighWaterBytes: report.memory.processLifetimeRss.bytes }));
  }
}
assert.equal(observations.length, 12); assert.deepEqual(captureSweepSource(process.cwd()), source);
const products = observations.flatMap(row => row.report.reports);
assert.equal(new Set(products.map(row => row.corpusHash)).size, 1, 'all worker/query/walk/repetition cohorts retain one original source corpus');
assert.equal(new Set(products.map(row => row.semanticCorpusHash)).size, 1,
  'full native row/metadata parity across worker/query/walk cohorts;no stripping fields to force comparable meaning');
const multiplication = [];
for (let repetition = 1; repetition <= CACHE_MEASUREMENT_SHAPE.repetitions; repetition++) for (const useQueries of CACHE_MEASUREMENT_SHAPE.queryModes) {
  const one = observations.find(row => row.repetition === repetition && row.useQueries === useQueries && row.workers === 1).report;
  const two = observations.find(row => row.repetition === repetition && row.useQueries === useQueries && row.workers === 2).report;
  assert.equal(two.perWorkerMultiplication.sumChargedBytes, one.perWorkerMultiplication.sumChargedBytes * 2,
    'two simultaneously retained original isolates conserve twice the same logical cache charges');
  multiplication.push({ repetition, useQueries, one: one.perWorkerMultiplication, two: two.perWorkerMultiplication,
    oneNativeRssBytes: one.memory.processLifetimeRss.bytes, twoNativeRssBytes: two.memory.processLifetimeRss.bytes,
    claim: 'observed per-isolate charge multiplication;RSS is whole-process and has no asserted ratio' });
}
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source, observations,
  multiplication,
  scope: '12 independent <=30s capsules;32 original calls per clean latency mode/isolate;three repetitions per1/2-worker query/walk cohort',
  limitations: ['instrumented work CPU/bytes separate from clean latency', 'clone bytes are logical UTF8 equivalents',
    'RSS high-water belongs to the whole fresh process, not any isolate or parse phase', 'no historical-reader, OS-cache-controlled or performance-gain claim'] }, { createOnly: true });
