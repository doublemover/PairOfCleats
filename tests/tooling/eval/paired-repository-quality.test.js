import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { QUALITY_COMPARISON_VERSION } from '../../../src/contracts/schemas/quality-comparison.js';
import { comparePairedQuality } from '../../../src/retrieval/evaluation/paired-quality.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const requestFor = tasks => ({ schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-comparison',
  metric: { name: 'declared-quality', definitionKey: hash('fixture-unit-quality-v1'), unit: 'quality-unit-interval' },
  baselineKey: hash('baseline'), candidateKey: hash('candidate'), cluster: 'repository', seed: 'enumerated-quality',
  resamples: 64, slices: [],
  ...Object.fromEntries(['baseline', 'candidate'].map(side => [side, tasks.flatMap((task, index) => task[side] === undefined ? [] : [{
    taskKey: hash(`task-${index}`), inputKey: hash(`same-source-query-filter-${index}`), repoId: task.repo,
    familyId: task.family || task.repo, slice: task.slice || 'ordinary',
    status: typeof task[side] === 'number' ? 'complete' : task[side], value: typeof task[side] === 'number' ? task[side] : null
  }])])) });
const constantInput = requestFor([{ repo: 'a', baseline: 0.25, candidate: 0.5 }, { repo: 'b', baseline: 0.25, candidate: 0.5 }]);
const constant = await comparePairedQuality(constantInput);
assert.equal(constant.complete, true); assert.equal(constant.estimates.repositoryMacro.meanDifference, 0.25);
assert.deepEqual(constant.estimates.repositoryMacro.interval95, [0.25, 0.25]);
assert.equal(constant.estimates.clusters, 2); assert.equal(constant.estimates.tasks, 2);
assert.equal(constant.decision, null); assert.equal(constant.latencyInference, 'none');
const identicalInput = structuredClone(constantInput); identicalInput.candidate = structuredClone(identicalInput.baseline);
const identical = await comparePairedQuality(identicalInput);
assert.equal(identical.estimates.repositoryMacro.meanDifference, 0);
assert.deepEqual(identical.estimates.repositoryMacro.interval95, [0, 0]);

const unequal = await comparePairedQuality(requestFor([{ repo: 'a', baseline: 0, candidate: 0.5 },
  ...Array.from({ length: 3 }, () => ({ repo: 'b', baseline: 0.25, candidate: 0.25 }))]));
assert.equal(unequal.estimates.repositoryMacro.meanDifference, 0.25, 'each repository receives equal weight despite task-count imbalance');
assert.equal(unequal.estimates.taskMicro.meanDifference, 0.125, 'task-micro weights are labeled and kept separate');
assert.equal(unequal.estimates.repositories, 2); assert.equal(unequal.estimates.completePairs, 4);
const familyInput = requestFor([{ repo: 'a', family: 'shared', baseline: 0.25, candidate: 0.5 },
  { repo: 'b', family: 'shared', baseline: 0.25, candidate: 0.5 }, { repo: 'c', family: 'independent', baseline: 0.25, candidate: 0.5 }]);
familyInput.cluster = 'family';
const family = await comparePairedQuality(familyInput);
assert.equal(family.estimates.repositories, 3); assert.equal(family.estimates.clusters, 2);
assert.deepEqual(family.estimates.repositoryMacro.interval95, [0.25, 0.25]);
familyInput.baseline.forEach(row => { row.familyId = 'one-dependent-family'; });
familyInput.candidate.forEach(row => { row.familyId = 'one-dependent-family'; });
const oneFamily = await comparePairedQuality(familyInput);
assert.equal(oneFamily.estimates.clusters, 1); assert.equal(oneFamily.estimates.repositoryMacro.interval95, null);
assert.equal(oneFamily.estimates.inference, 'insufficient-independent-clusters');

const missingInput = requestFor([{ repo: 'a', baseline: 0, candidate: 0 }, { repo: 'a', baseline: 0.5 },
  { repo: 'b', baseline: 0.25, candidate: 'timeout' }, { repo: 'b', baseline: 'failed', candidate: 'failed' },
  { repo: 'c', baseline: 0.25, candidate: 'cancelled' }]);
missingInput.slices = ['ordinary', 'declared-empty'];
const missing = await comparePairedQuality(missingInput);
assert.equal(missing.complete, true); assert.equal(missing.estimates.pairingComplete, false);
assert.equal(missing.estimates.completePairs, 1); assert.equal(missing.estimates.repositoryMacro.meanDifference, 0);
assert.deepEqual(missing.estimates.outcomes.candidate, { complete: 1, missing: 1, failed: 1, timeout: 1, cancelled: 1 });
assert.equal(missing.estimates.completionRates.baseline, 4 / 5); assert.equal(missing.estimates.completionRates.candidate, 1 / 5);
assert.equal(missing.estimates.incompletePairs.length, 4, 'missing and censored tasks stay in the paired denominator');
const declaredEmpty = missing.slices.find(slice => slice.id === 'declared-empty');
assert.equal(declaredEmpty.tasks, 0); assert.equal(declaredEmpty.completionRates.paired, null);
assert.equal(declaredEmpty.repositoryMacro.meanDifference, null);
const allFailed = await comparePairedQuality(requestFor([{ repo: 'a', baseline: 'timeout', candidate: 'failed' },
  { repo: 'b', baseline: 'cancelled', candidate: 'missing' }]));
assert.equal(allFailed.estimates.completePairs, 0); assert.equal(allFailed.estimates.repositoryMacro.meanDifference, null);
assert.equal(allFailed.estimates.repositoryMacro.interval95, null); assert.equal(allFailed.estimates.completionRates.paired, 0);
const oneRepo = await comparePairedQuality(requestFor([{ repo: 'a', baseline: 0, candidate: 1 }, { repo: 'a', baseline: 0, candidate: 1 }]));
assert.equal(oneRepo.estimates.tasks, 2); assert.equal(oneRepo.estimates.clusters, 1);
assert.equal(oneRepo.estimates.repositoryMacro.interval95, null, 'dependent queries cannot manufacture independent repositories');

const reordered = structuredClone(constantInput); reordered.baseline.reverse(); reordered.candidate.reverse();
assert.deepEqual(await comparePairedQuality(reordered, { resumeKey: constant.checkpoint.key }), constant);
for (const edit of [value => { value.candidate[0].inputKey = hash('other-source'); },
  value => { value.baseline.push(structuredClone(value.baseline[0])); }, value => { value.candidate[0].familyId = 'different'; },
  value => { value.candidate[0].status = 'timeout'; }, value => { value.candidate[0].value = NaN; },
  value => { value.slices = ['all']; }]) {
  const invalid = structuredClone(constantInput); edit(invalid);
  await assert.rejects(comparePairedQuality(invalid), { code: 'ERR_PAIRED_QUALITY_INPUT' });
}
for (const edit of [value => { value.seed = 'other-seed'; }, value => { value.metric.definitionKey = hash('other-definition'); },
  value => { value.candidateKey = hash('other-model'); }, value => { value.candidate[0].value = 0.75; }]) {
  const changed = structuredClone(constantInput); edit(changed);
  await assert.rejects(comparePairedQuality(changed, { resumeKey: constant.checkpoint.key }), /checkpoint/);
}
let accessors = 0;
const executableInput = structuredClone(constantInput);
Object.defineProperty(executableInput.baseline[0], 'value', { enumerable: true, get() { accessors++; return 0.25; } });
await assert.rejects(comparePairedQuality(executableInput), /accessors/); assert.equal(accessors, 0);
const borrowed = structuredClone(constantInput), pending = comparePairedQuality(borrowed);
borrowed.candidate[0].value = 1;
assert.deepEqual(await pending, constant, 'owned input is fixed before a resampling yield');
const cancelled = new AbortController(); cancelled.abort();
for (const options of [{ signal: cancelled.signal }, { limits: { work: 1 } }, { limits: { inputBytes: 1 } }, { limits: { outputBytes: 256 } }]) {
  const partial = await comparePairedQuality(constantInput, options);
  assert.equal(partial.complete, false); assert.equal(partial.estimates, null); assert.equal(partial.slices, null); assert.equal(partial.decision, null);
  if (options.limits?.outputBytes) assert(Buffer.byteLength(JSON.stringify(partial)) <= options.limits.outputBytes);
}
const during = new AbortController(); setImmediate(() => during.abort());
const interrupted = await comparePairedQuality(constantInput, { signal: during.signal });
assert.equal(interrupted.complete, false); assert.equal(interrupted.reason, 'cancelled'); assert.equal(interrupted.decision, null);
await assert.rejects(comparePairedQuality(constantInput, { limits: { unknown: 1 } }), /bound/);
console.log('paired repository/family quality, completion, identity, bounds and cancellation assertions complete');
