import assert from 'node:assert/strict';
import { evaluateTaskSpanTrace } from '../../../src/retrieval/evaluation/task-span-trace.js';
import { compareTaskSpanQuality } from '../../../src/retrieval/evaluation/task-span-quality.js';
import { captureTaskSpanQualityReceipts } from '../../../src/retrieval/evaluation/task-span-quality-inputs.js';
import { makeTaskSpanTrace, taskTraceFixtureHash as hash } from '../../helpers/task-span-trace-fixture.js';

// Actual producer/comparison/paired-quality owners, saved metadata only. These
// are authored controls, not independently qualified source bytes or judgments.
const left = makeTaskSpanTrace(), right = makeTaskSpanTrace({ run: 'candidate' });
right.events.find(event => event.stage === 'delivered').span.end = 20;
const baseline = await evaluateTaskSpanTrace(left), candidate = await evaluateTaskSpanTrace(right);
const compare = (a = baseline, b = candidate) => compareTaskSpanQuality({ baseline: [a], candidate: [b], resamples: 32 });
const control = await compare();
assert.equal(control.complete, true); assert.equal(control.estimates.repositoryMacro.meanDifference, .25);
assert.equal(control.estimates.repositoryMacro.interval95, null);

let accessorCalls = 0;
const executable = (value, name, answer) => Object.defineProperty(value, name, { configurable: true, get() { accessorCalls++; return answer; } });
for (const name of ['schemaVersion', 'kind', 'complete', 'policy', 'traceKey', 'sourceDigest', 'goldDigest',
  'judgmentPolicyKey', 'identity', 'runStatus', 'runComplete', 'metrics']) {
  const row = structuredClone(baseline); executable(row, name, row[name]);
  await assert.rejects(compare(row), { code: 'ERR_TASK_SPAN_TRACE' });
}
for (const name of ['taskKey', 'inputKey', 'queryDigest', 'repoId', 'familyId']) {
  const row = structuredClone(baseline); executable(row.identity, name, row.identity[name]);
  await assert.rejects(compare(row), { code: 'ERR_TASK_SPAN_TRACE' });
}
const metricGetter = structuredClone(baseline); executable(metricGetter.metrics, 'deliveredCoverage', 1);
await assert.rejects(compare(metricGetter), { code: 'ERR_TASK_SPAN_TRACE' });
const inheritedMetric = structuredClone(baseline); delete inheritedMetric.metrics.deliveredCoverage;
Object.setPrototypeOf(inheritedMetric.metrics, { deliveredCoverage: 1 });
await assert.rejects(compare(inheritedMetric), { code: 'ERR_TASK_SPAN_TRACE' });
const inherited = structuredClone(baseline); delete inherited.traceKey; Object.setPrototypeOf(inherited, { traceKey: baseline.traceKey });
await assert.rejects(compare(inherited), { code: 'ERR_TASK_SPAN_TRACE' });
for (const rows of [executable(new Array(1), 0, baseline), new Array(1)]) {
  if (!Object.hasOwn(rows, 0)) Object.setPrototypeOf(rows, Object.create(Array.prototype, { 0: { get() { accessorCalls++; return baseline; } } }));
  await assert.rejects(compareTaskSpanQuality({ baseline: rows, candidate: [candidate], resamples: 32 }), { code: 'ERR_TASK_SPAN_TRACE' });
}
assert.equal(accessorCalls, 0, 'receipt/identity/measurement/membership accessors cannot supply comparison evidence');

for (const edit of [row => { row.complete = 1; }, row => { row.runComplete = false; },
  row => { row.runStatus = 'unknown'; }, row => { row.sourceDigest = { toString() { assert.fail('hash evidence cannot execute coercion'); } }; },
  row => { row.identity.repoId = {}; }, row => { row.identity.familyId = 'x'.repeat(257); }]) {
  const row = structuredClone(baseline); edit(row); await assert.rejects(compare(row), { code: 'ERR_TASK_SPAN_TRACE' });
}
const changing = structuredClone(baseline), descriptors = new Map();
const originalTraceKey = changing.traceKey;
const trapped = new Proxy(changing, {
  get() { assert.fail('live receipt properties are not original comparison evidence'); },
  getOwnPropertyDescriptor(target, name) {
    descriptors.set(name, (descriptors.get(name) || 0) + 1);
    const descriptor = Reflect.getOwnPropertyDescriptor(target, name);
    if (name === 'metrics') target.traceKey = hash('later substituted run');
    return descriptor;
  }
});
const originalRows = [trapped];
originalRows.map = originalRows[Symbol.iterator] = () => assert.fail('caller array methods cannot supply comparison population or run keys');
const actual = await compareTaskSpanQuality({ baseline: originalRows, candidate: [candidate], resamples: 32 });
assert.deepEqual(actual, control); assert.equal(descriptors.get('traceKey'), 1);
assert.notEqual(changing.traceKey, originalTraceKey);
assert([...descriptors.values()].every(count => count === 1), 'each original receipt field is captured once for validation, pairing and run-key hashing');

const membership = [baseline], captured = captureTaskSpanQualityReceipts(membership, 'deliveredCoverage');
membership[0] = candidate; membership.push(candidate);
assert.equal(captured.length, 1); assert.equal(captured[0].traceKey, baseline.traceKey);
assert(Object.isFrozen(captured)); assert(Object.isFrozen(captured[0])); assert(Object.isFrozen(captured[0].identity));

for (const primary of [undefined, null, false, 0, '']) {
  let observed = Symbol('no original failure');
  const opaque = new Proxy(baseline, { getOwnPropertyDescriptor() { throw primary; } });
  try { await compare(opaque); } catch (error) { observed = error; }
  assert.equal(observed, primary, 'original receipt inspection failure cannot fabricate failed/missing quality');
}
const missing = structuredClone(baseline); missing.metrics.deliveredCoverage = null;
const missingReport = await compare(missing);
assert.equal(missingReport.estimates.outcomes.baseline.missing, 1); assert.equal(missingReport.estimates.completePairs, 0);
assert.equal(missingReport.estimates.repositoryMacro.meanDifference, null);
const failedTrace = makeTaskSpanTrace({ run: 'failed' }); failedTrace.status = 'failed'; failedTrace.outcome = 'failed';
const failed = await evaluateTaskSpanTrace(failedTrace);
executable(failed, 'metrics', { deliveredCoverage: 1 });
const failedReport = await compare(failed);
assert.equal(failedReport.estimates.outcomes.baseline.failed, 1); assert.equal(failedReport.estimates.completePairs, 0);
assert.equal(accessorCalls, 0, 'failed-run metrics are not read or promoted to completed quality');
console.log('Actual task-span producer/comparison original receipt controls authored; execution deferred.');
