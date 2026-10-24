import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveCrossFileFidelity, resolveCrossFilePropagationBudget, orderCrossFileChunks,
  buildCrossFileCoverage, crossFileCoverageWarning
} from '../../../../src/index/cross-file-fidelity.js';
import { buildAnalysisPolicy } from '../../../../src/index/build/runtime/policy.js';
import { buildCrossFileInferenceBudgetPlan, applyCrossFileInferenceBudgetPlan,
  buildCrossFileInferenceRoiMetrics } from '../../../../src/index/build/indexer/steps/relations/cross-file-budget.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';
import { runCrossFilePropagation } from '../../../../src/index/type-inference-crossfile/propagation.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { validateConfig } from '../../../../src/config/validate.js';

const bounded = resolveCrossFileFidelity();
const comprehensive = resolveCrossFileFidelity('comprehensive');
const configSchema = JSON.parse(await fs.readFile(new URL('../../../../docs/config/schema.json', import.meta.url), 'utf8'));
for (const crossFileFidelity of ['bounded', 'comprehensive']) {
  assert.equal(validateConfig(configSchema, { indexing: { crossFileFidelity } }).ok, true);
}
for (const crossFileFidelity of ['max', null, 1, {}]) {
  assert.equal(validateConfig(configSchema, { indexing: { crossFileFidelity } }).ok, false);
}
assert.equal(bounded.mode, 'bounded');
for (const invalid of ['', 'max', true, {}, 'Comprehensive']) {
  assert.throws(() => resolveCrossFileFidelity(invalid), /crossFileFidelity/);
}
assert.deepEqual(buildAnalysisPolicy({ crossFileFidelity: 'comprehensive' }).typeInference.crossFile.fidelity, comprehensive);
assert.equal(resolveCrossFilePropagationBudget({ fidelity: bounded, chunkCount: 2999, fileCount: 499 }), null);
assert.equal(resolveCrossFilePropagationBudget({ fidelity: bounded, chunkCount: 3000, fileCount: 499 }).maxCallSummariesPerChunk, 128);
assert.equal(resolveCrossFilePropagationBudget({ fidelity: bounded, chunkCount: 2999, fileCount: 500 }).maxCallSummariesPerChunk, 128);
assert.equal(resolveCrossFilePropagationBudget({ fidelity: comprehensive, chunkCount: 100000, fileCount: 100000 }), null);

const caller = { file: 'caller.js', name: 'alpha', kind: 'function', lang: 'javascript', chunkUid: 'caller', start: 0, end: 10000,
  codeRelations: { calls: Array.from({ length: 300 }, () => ['alpha', 'beta']),
    callDetails: Array.from({ length: 300 }, (_, i) => ({ callee: 'beta', start: i * 3, end: i * 3 + 2, args: [] })) } };
const target = { file: 'target.js', name: 'beta', kind: 'function', chunkUid: 'target', start: 0, end: 2 };
const chunks = [caller, target, ...Array.from({ length: 2998 }, (_, i) => ({ file: 'padding.js', name: `padding${i}`,
  chunkUid: `padding${i}`, start: i, end: i + 1 }))];
const original = structuredClone(chunks);
const limitedPlan = buildCrossFileInferenceBudgetPlan({ chunks, inferenceLiteEnabled: false, fidelity: bounded });
const limited = applyCrossFileInferenceBudgetPlan({ chunks, plan: limitedPlan });
assert.ok(limited.budgetStats.dropped.callDetailSignals > 0, 'the original first-layer omission remains visible in bounded mode');
assert.equal(caller.codeRelations.callDetails.length, 300, 'canonical occurrences retain the complete tail');
const fullPlan = buildCrossFileInferenceBudgetPlan({ chunks, inferenceLiteEnabled: true, fidelity: comprehensive });
const full = applyCrossFileInferenceBudgetPlan({ chunks, plan: fullPlan });
assert.equal(full.chunks[0].codeRelations.callDetails.length, 300);
assert.deepEqual(full.budgetStats.dropped, { callSignals: 0, callDetailSignals: 0, chunkUsageSignals: 0, fileUsageSignals: 0 });
assert.deepEqual(chunks, original, 'planning neither mutates nor truncates raw signals');

const direct = async (fidelity, input) => runCrossFilePropagation({ rootDir: process.cwd(), chunks: structuredClone(input),
  enableTypeInference: false, enableRiskCorrelation: false, useTooling: false, inferenceLite: false, fidelity });
const boundedStats = await direct(bounded, chunks);
assert.equal(boundedStats.droppedCallSummaries, 172, 'the independent propagation limit is accounted separately');
const fullStats = await direct(comprehensive, chunks);
assert.equal(fullStats.linkedCallSummaries, 300);
assert.equal(fullStats.admission.callDetails.visited, 300);
assert.equal(fullStats.droppedCallSummaries, 0);
const reversedStats = await direct(comprehensive, [...chunks].reverse());
assert.deepEqual(reversedStats.admission, fullStats.admission);
assert.equal(reversedStats.linkedCallSummaries, fullStats.linkedCallSummaries);
const exhaustion = [target, ...Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(caller),
  file: `file-${i % 20}.js`, name: `caller${i}`, chunkUid: `caller${i}`,
  codeRelations: { callDetails: structuredClone(caller.codeRelations.callDetails.slice(0, 128)) } })),
...chunks.slice(2, 2801)];
const exhausted = await direct(bounded, exhaustion);
assert.equal(exhausted.linkedCallSummaries, 25000, 'summary-only input consumes the shared global call quota');
assert.equal(exhausted.droppedCallSummaries, 600);
assert.deepEqual((await direct(bounded, [...exhaustion].reverse())).admission, exhausted.admission,
  'global exhaustion selects the same stable file-round-robin frontier under reordered input');
assert.deepEqual(orderCrossFileChunks(chunks).map(chunk => chunk.chunkUid),
  orderCrossFileChunks([...chunks].reverse()).map(chunk => chunk.chunkUid));
assert.deepEqual(orderCrossFileChunks([{ file: 'a', chunkUid: 'a2' }, { file: 'b', chunkUid: 'b1' },
  { file: 'a', chunkUid: 'a1' }]).map(chunk => chunk.chunkUid), ['a1', 'b1', 'a2'], 'bounded admission interleaves files');

const root = resolveTestCachePath(process.cwd(), 'cross-file-fidelity-replay');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
try {
  const run = async () => {
    const fresh = structuredClone(original);
    const plan = buildCrossFileInferenceBudgetPlan({ chunks: fresh, fidelity: comprehensive });
    const view = applyCrossFileInferenceBudgetPlan({ chunks: fresh, plan });
    const stats = await applyCrossFileInference({ enabled: true, rootDir: root, cacheRoot: path.join(root, 'cache'),
      chunks: view.chunks, fidelity: comprehensive, useTooling: false, enableTypeInference: false, enableRiskCorrelation: false });
    return { stats, chunks: view.chunks, coverage: buildCrossFileCoverage({ fidelity: comprehensive,
      budgetStats: view.budgetStats, propagationStats: stats }) };
  };
  const cold = await run(), warm = await run();
  assert.equal(cold.stats.cacheHit, false);
  assert.equal(warm.stats.cacheHit, true);
  assert.deepEqual(warm.coverage, cold.coverage, 'warm replay preserves omission evidence unchanged');
  assert.deepEqual(warm.chunks, cold.chunks, 'complete replay preserves every admitted occurrence and target');
  assert.equal(cold.coverage.admission.status, 'complete');
  assert.equal(cold.coverage.analysis.status, 'unknown', 'admission does not invent complete program analysis');
  assert.ok(crossFileCoverageWarning(cold.coverage));
  const roi = buildCrossFileInferenceRoiMetrics({ crossFileStats: boundedStats, budgetStats: limited.budgetStats });
  assert.equal(roi.droppedCallSummaries, 172);
  assert.deepEqual(roi.propagationAdmission, boundedStats.admission);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(runCrossFilePropagation({ rootDir: root, chunks: structuredClone(chunks),
    fidelity: comprehensive, abortSignal: canceled.signal }), /abort/i);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Cross-file fidelity layers, canonical preservation and durable warm replay controls passed.');
