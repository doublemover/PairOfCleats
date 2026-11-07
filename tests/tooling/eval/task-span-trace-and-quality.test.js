import assert from 'node:assert/strict';
import { evaluateTaskSpanTrace } from '../../../src/retrieval/evaluation/task-span-trace.js';
import { compareTaskSpanQuality } from '../../../src/retrieval/evaluation/task-span-quality.js';
import { evaluateDatasetTaskSpans } from '../../../tools/eval/task-spans.js';
import { makeTaskSpanTrace, taskTraceFixtureHash as hash, TASK_TRACE_FIXTURE_QUERY as query } from '../../helpers/task-span-trace-fixture.js';

const input = makeTaskSpanTrace(), original = structuredClone(input), receipt = await evaluateTaskSpanTrace(input);
assert.equal(receipt.complete, true); assert.equal(receipt.runComplete, true); assert.deepEqual(input, original);
assert.equal(receipt.goldBytes, 40); assert.equal(receipt.stages.retrieved.observedBytes, 20, 'overlapping and repeated hits receive no double credit');
assert.equal(receipt.stages.explored.observedBytes, 10, 'identical names in distinct files retain independent source identity');
assert.equal(receipt.stages.delivered.observedBytes, 10); assert.equal(receipt.stages.used.observedBytes, 5);
assert.deepEqual(receipt.metrics, { retrievalOverlap: 0.5, exploredOverlap: 0.25, deliveredCoverage: 0.25,
  claimedUtilization: 0.5, atomicSupportRate: 1, taskSuccess: 1 });
assert.equal(receipt.trace.events[2].rank, 3, 'raw rank/displayed original bounds remain independently recomputable');
assert.equal(receipt.claims[0].citations[0].delivered, true); assert.equal(receipt.decision, null);
const unknownUse = makeTaskSpanTrace(); unknownUse.events = unknownUse.events.filter(event => event.stage !== 'used'); unknownUse.stages.used = 'unknown';
assert.equal((await evaluateTaskSpanTrace(unknownUse)).metrics.claimedUtilization, null, 'delivery cannot imply observed use');
const noOpening = makeTaskSpanTrace(); noOpening.events = noOpening.events.filter(event => event.stage !== 'explored');
assert.equal((await evaluateTaskSpanTrace(noOpening)).metrics.exploredOverlap, 0, 'instrumented empty exploration is a measured zero');
noOpening.stages.explored = 'unknown';
assert.equal((await evaluateTaskSpanTrace(noOpening)).metrics.exploredOverlap, null);
const noGold = makeTaskSpanTrace(); noGold.gold = []; noGold.claims = []; noGold.events = noGold.events.filter(event => event.stage !== 'used');
const abstention = await evaluateTaskSpanTrace(noGold);
assert.equal(abstention.metrics.retrievalOverlap, null); assert.equal(abstention.metrics.atomicSupportRate, null);
const freeForm = makeTaskSpanTrace(); freeForm.stages.retrieved = 'partial';
freeForm.events.push({ id: 'free-form-unmappable', sequence: 7, stage: 'retrieved', adapter: 'cli', status: 'unknown',
  span: null, rank: null, attribution: null, referenceId: null });
const partialStage = await evaluateTaskSpanTrace(freeForm);
assert.equal(partialStage.metrics.retrievalOverlap, null); assert.equal(partialStage.stages.retrieved.observedBytes, 20);
assert.equal(partialStage.stages.retrieved.complete, false, 'unknown free-form reads never expand to whole-file coverage');

const wrongRevision = makeTaskSpanTrace(); wrongRevision.claims[0].citations[0].generation = hash('wrong-source-revision');
const invalidCitation = await evaluateTaskSpanTrace(wrongRevision);
assert.equal(invalidCitation.claims[0].rawLabel, 'supported'); assert.equal(invalidCitation.claims[0].effectiveLabel, 'invalid-citation');
assert.deepEqual(invalidCitation.claims[0].reasons, ['wrong-generation']); assert.equal(invalidCitation.metrics.atomicSupportRate, 0);
assert.equal(invalidCitation.events.find(event => event.stage === 'used').accepted, false);
const nonexistent = makeTaskSpanTrace(); nonexistent.claims[0].citations[0].sourceKey = hash('nonexistent');
assert.equal((await evaluateTaskSpanTrace(nonexistent)).claims[0].deterministicValidity, 'invalid');
const related = makeTaskSpanTrace(); related.claims[0].label = 'insufficient';
assert.equal((await evaluateTaskSpanTrace(related)).metrics.atomicSupportRate, 0, 'an independently labeled merely related citation earns no support');
const unjudged = makeTaskSpanTrace(); unjudged.claims[0].label = 'unknown'; unjudged.claims[0].judge = { kind: 'unjudged', identityKey: null };
assert.equal((await evaluateTaskSpanTrace(unjudged)).metrics.atomicSupportRate, null);
const unseenCitation = makeTaskSpanTrace(); unseenCitation.claims[0].citations[0].start = 15; unseenCitation.claims[0].citations[0].end = 20;
assert.equal((await evaluateTaskSpanTrace(unseenCitation)).claims[0].citations[0].delivered, false, 'citation support and actual delivered exposure remain different facts');
const cancelledTrace = makeTaskSpanTrace(); cancelledTrace.status = 'cancelled'; cancelledTrace.terminalSequence = 3; cancelledTrace.outcome = 'unknown';
const cancelledRun = await evaluateTaskSpanTrace(cancelledTrace);
assert.equal(cancelledRun.complete, true); assert.equal(cancelledRun.runComplete, false); assert.equal(cancelledRun.metrics, null);
assert.equal(cancelledRun.stages.delivered.observedBytes, 0); assert.equal(cancelledRun.events.filter(event => event.reason === 'after-terminal').length, 3);

for (const edit of [value => { value.sources[0].generation = hash('mixed-generation'); },
  value => { value.sources[0].file = '../outside.ts'; }, value => { value.gold[0].end = 101; },
  value => { value.events.push(structuredClone(value.events[0])); }, value => { value.events[6].attribution = null; },
  value => { value.events[0].span.unit = 'line'; }, value => { value.claims[0].judge = { kind: 'unjudged', identityKey: null }; }]) {
  const invalid = makeTaskSpanTrace(); edit(invalid);
  await assert.rejects(evaluateTaskSpanTrace(invalid), { code: 'ERR_TASK_SPAN_TRACE' });
}
let getterCalls = 0;
const executable = makeTaskSpanTrace(); Object.defineProperty(executable.sources[0], 'file', { enumerable: true, get() { getterCalls++; return 'unsafe.ts'; } });
await assert.rejects(evaluateTaskSpanTrace(executable), /accessors/); assert.equal(getterCalls, 0);
const reordered = makeTaskSpanTrace(); reordered.events.reverse(); reordered.sources.reverse(); reordered.gold.reverse();
assert.deepEqual(await evaluateTaskSpanTrace(reordered, { resumeKey: receipt.traceKey }), receipt);
const changed = makeTaskSpanTrace(); changed.claims[0].label = 'contradicted';
await assert.rejects(evaluateTaskSpanTrace(changed, { resumeKey: receipt.traceKey }), /checkpoint/);
const before = new AbortController(); before.abort();
for (const options of [{ signal: before.signal }, { limits: { inputBytes: 1 } }, { limits: { outputBytes: 256 } }, { limits: { work: 1 } }]) {
  const incomplete = await evaluateTaskSpanTrace(input, options);
  assert.equal(incomplete.complete, false); assert.equal(incomplete.metrics, null); assert.equal(incomplete.decision, null);
  if (options.limits?.outputBytes) assert(Buffer.byteLength(JSON.stringify(incomplete)) <= options.limits.outputBytes);
}
const many = makeTaskSpanTrace(); many.events = Array.from({ length: 300 }, (_, sequence) => ({ ...many.events[0], id: `many-${sequence}`, sequence })); many.terminalSequence = 300;
const during = new AbortController(); setImmediate(() => during.abort());
assert.equal((await evaluateTaskSpanTrace(many, { signal: during.signal })).reason, 'cancelled');

const baseline = [], candidate = [], cases = [];
for (const repoId of ['repository-a', 'repository-b']) {
  const left = makeTaskSpanTrace({ repoId }), right = makeTaskSpanTrace({ repoId, run: 'candidate' });
  right.events.find(event => event.stage === 'delivered').span.end = 20;
  baseline.push(await evaluateTaskSpanTrace(left)); candidate.push(await evaluateTaskSpanTrace(right));
  cases.push({ query, taskTraceBaseline: left, taskTrace: right });
}
const compared = await compareTaskSpanQuality({ baseline, candidate, resamples: 64 });
assert.equal(compared.estimates.repositoryMacro.meanDifference, 0.25); assert.deepEqual(compared.estimates.repositoryMacro.interval95, [0.25, 0.25]);
const failed = makeTaskSpanTrace({ repoId: 'repository-b', run: 'cancelled' }); failed.status = 'timeout'; failed.outcome = 'unknown';
const withTimeout = await compareTaskSpanQuality({ baseline, candidate: [candidate[0], await evaluateTaskSpanTrace(failed)], resamples: 64 });
assert.equal(withTimeout.estimates.outcomes.candidate.timeout, 1); assert.equal(withTimeout.estimates.completePairs, 1);
assert.equal(withTimeout.estimates.repositoryMacro.interval95, null);
const wrongInput = makeTaskSpanTrace(); wrongInput.identity.inputKey = hash('different-task-input');
await assert.rejects(compareTaskSpanQuality({ baseline: [receipt], candidate: [await evaluateTaskSpanTrace(wrongInput)] }), /mismatched/);
const otherRubric = makeTaskSpanTrace(); otherRubric.judgmentPolicyKey = hash('different-labeling-policy');
await assert.rejects(compareTaskSpanQuality({ baseline: [receipt], candidate: [await evaluateTaskSpanTrace(otherRubric)] }), /rubric/);
const report = await evaluateDatasetTaskSpans({ cases });
assert.equal(report.currentSearchEvidence, false); assert.equal(report.summary.metrics.deliveredCoverage.repositoryMacro, 0.5);
assert.equal(report.pairedQuality.estimates.repositoryMacro.meanDifference, 0.25);
assert.equal(await evaluateDatasetTaskSpans({ cases: [{ query }] }), null);
const malformed = await evaluateDatasetTaskSpans({ cases: [{ query: 'other query', taskTrace: input }] });
assert.equal(malformed.complete, false); assert.equal(malformed.summary, null); assert.equal(malformed.tasks.length, 1);
const bounded = await evaluateDatasetTaskSpans({ cases, limits: { tasks: 1 } }); assert.equal(bounded.complete, false); assert.equal(bounded.summary, null);
console.log('Task-stage original span union, unknown states, atomic citation validity, paired quality and saved report assertions complete');
