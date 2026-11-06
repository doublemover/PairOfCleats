import assert from 'node:assert/strict';
import { authoredEvidenceTask, evidenceTaskHash as hash } from '../../helpers/finite-evidence-task.js';
import { compileEvidenceTask, inspectEvidenceTaskCompilation, projectCandidateEvidenceTask,
  readCandidateEvidenceSource, disposeEvidenceTask } from '../../../src/retrieval/evaluation/tasks/compiler.js';
import { assignEvidenceTaskSplits, evidenceTaskSplitMembership, projectRunnableEvidenceTask } from '../../../src/retrieval/evaluation/tasks/splits.js';
import { scoreEvidenceTask, inspectEvidenceTaskOutcome } from '../../../src/retrieval/evaluation/tasks/score.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/finite-evidence-task/')[1];
assert.ok(['private-oracle-visible-packets', 'alternative-and-q-of-oracle', 'unknown-and-verified-empty', 'lineage-splits-and-quarantine', 'source-authority-and-failures'].includes(mode));
const policy = { schemaVersion: 1, seed: 'frozen-author-split-v1', train: 5000, dev: 2000, calibration: 1000, test: 2000 };
const prepare = (input = authoredEvidenceTask()) => {
  const task = compileEvidenceTask(input), manifest = assignEvidenceTaskSplits([task], policy); return { input, task, manifest };
};
const submission = (task, evidence, extra = {}) => ({ schemaVersion: 1, publicTaskId: inspectEvidenceTaskCompilation(task).publicTaskId,
  candidateId: hash('candidate'), runId: hash('run'), status: 'completed', evidence, abstain: false, ...extra });
const score = ({ task, manifest }, evidence, extra = {}) => scoreEvidenceTask({ task, manifest, submission: submission(task, evidence, extra) });
if (mode === 'private-oracle-visible-packets') {
  const original = authoredEvidenceTask(), first = prepare(original), revised = authoredEvidenceTask();
  revised.privateOracle.units[0].id = hash('private-label-secret'); revised.privateOracle.alternatives[0].groups[0].unitIds = [hash('private-label-secret')];
  const second = prepare(revised), left = projectRunnableEvidenceTask(first.manifest, first.task), right = projectRunnableEvidenceTask(second.manifest, second.task);
  assert.deepEqual(left, right, 'private oracle changes do not leak through a public dictionary-searchable identity');
  assert.notEqual(inspectEvidenceTaskCompilation(first.task).compilationId, inspectEvidenceTaskCompilation(second.task).compilationId);
  const visible = JSON.stringify(left);
  for (const secret of [original.privateOracle.units[0].id, 'private-label-secret', 'privateOracle', 'privateOracleId', 'labelCoverage', 'alternatives', 'splitManifestId']) assert.equal(visible.includes(secret), false);
  assert.deepEqual(Object.keys(first.task), ['version']); assert.equal(left.sources.length, 3);
  const ref = first.input.privateOracle.units[0].source;
  const expectedSourceText = original.sourceSnapshot[0].text;
  assert.equal(readCandidateEvidenceSource(first.task, ref).text, expectedSourceText);
  original.sourceSnapshot[0].text = 'caller mutation'; assert.equal(readCandidateEvidenceSource(first.task, ref).text, expectedSourceText);
  assert.throws(() => projectCandidateEvidenceTask({ ...first.task }), { code: 'ERR_EVIDENCE_TASK_HANDLE' });
  assert.throws(() => projectRunnableEvidenceTask(first.manifest, second.task), { code: 'ERR_EVIDENCE_TASK_SPLIT' });
  const retirement = disposeEvidenceTask(first.task); assert.equal(retirement.status, 'retired');
  assert.equal(disposeEvidenceTask(first.task), retirement); assert.equal(retirement.nativeResources, 'none');
  assert.throws(() => readCandidateEvidenceSource(first.task, ref), { code: 'ERR_EVIDENCE_TASK_HANDLE' });
} else if (mode === 'alternative-and-q-of-oracle') {
  for (const qOf of [false, true]) {
    const input = authoredEvidenceTask();
    if (qOf) input.privateOracle.alternatives = [{ id: 'two-of-three', groups: [{ id: 'q', require: 2, unitIds: input.privateOracle.units.map(unit => unit.id) }] }];
    const task = prepare(input);
    for (let mask = 0; mask < 8; mask++) {
      const evidence = input.privateOracle.units.filter((_, index) => mask & (1 << index)).map(unit => unit.source);
      const result = score(task, evidence), count = [0, 1, 2].filter(index => mask & (1 << index)).length;
      const independentlySufficient = qOf ? count >= 2 : Boolean(mask & 2) || Boolean(mask & 1) && Boolean(mask & 4);
      assert.equal(result.taskResult, independentlySufficient ? 'pass' : 'fail', 'all subsets obey the independent finite requirement expression');
      assert.equal(result.executedCandidateProgram, false); assert.equal(result.axes.observedReadOrUse, 'not-established');
      assert.equal(inspectEvidenceTaskOutcome(result), result);
    }
  }
  const task = prepare(), [main, , helper] = task.input.privateOracle.units.map(unit => unit.source);
  const overlap = { ...main, span: [0, 5] }, result = score(task, [main, overlap, helper]);
  assert.equal(result.taskResult, 'pass'); assert.equal(result.evidence.coveredOracleUnits, 2);
  assert.equal(result.evidence.unionSourceBytes, Buffer.byteLength(task.input.sourceSnapshot[0].text) + Buffer.byteLength(task.input.sourceSnapshot[2].text));
  const partialMain = [{ ...main, span: [0, 5] }, { ...main, span: [5, main.span[1]] }, helper];
  assert.equal(score(task, partialMain).taskResult, 'pass', 'contiguous verified pieces can cover one original oracle interval');
  const first = score(task, [main, helper]), repeated = score(task, [main, helper]);
  assert.equal(first.semanticOutcomeId, repeated.semanticOutcomeId, 'equivalent results keep a stable semantic identity');
  assert.notEqual(first.receiptId, repeated.receiptId, 'actual repeated scoring must not collide as one immutable execution receipt');
  assert.notEqual(first.work.executionId, repeated.work.executionId);
  assert.equal(first.work.compilation.executionId, repeated.work.compilation.executionId, 'the original preparation remains shared');
  assert.equal(first.work.split.executionId, repeated.work.split.executionId);
} else if (mode === 'unknown-and-verified-empty') {
  for (const coverage of ['partial', 'unknown']) {
    const input = authoredEvidenceTask(); input.privateOracle.labelCoverage = coverage; input.privateOracle.units = [];
    input.privateOracle.alternatives = []; input.privateOracle.noLocalAnswer = 'unknown';
    const task = prepare(input); assert.equal(score(task, []).taskResult, 'unknown'); assert.equal(score(task, [], { abstain: true }).taskResult, 'unknown');
  }
  const negative = authoredEvidenceTask(); negative.privateOracle.units = []; negative.privateOracle.alternatives = [];
  negative.privateOracle.noLocalAnswer = 'verified-in-supplied-model'; const task = prepare(negative);
  assert.equal(score(task, [], { abstain: true }).taskResult, 'pass'); assert.equal(score(task, []).taskResult, 'fail');
  const unverified = authoredEvidenceTask(); unverified.privateOracle.validation.status = 'unverified';
  assert.equal(score(prepare(unverified), [unverified.privateOracle.units[1].source]).taskResult, 'unknown');
  for (const status of ['not-run', 'timeout', 'canceled', 'tool-error']) {
    const outcome = score(task, [], { status, abstain: true }); assert.equal(outcome.executionStatus, status); assert.equal(outcome.taskResult, 'unknown');
  }
} else if (mode === 'lineage-splits-and-quarantine') {
  const inputs = ['one', 'two', 'three', 'four', 'five'].map(authoredEvidenceTask);
  inputs[0].lineage.cloneFamilyIds = [hash('clone-one-two')]; inputs[1].lineage.cloneFamilyIds = [hash('clone-one-two')];
  inputs[1].lineage.issueFixFamilyIds = [hash('fix-two-three')]; inputs[2].lineage.issueFixFamilyIds = [hash('fix-two-three')];
  inputs[4].sourceSnapshot[0].text = inputs[3].sourceSnapshot[0].text;
  // Recompile its source-bound private reference after the exact text change.
  const publicFour = prepare(inputs[3]); inputs[4].privateOracle.units[0].source = publicFour.input.privateOracle.units[0].source;
  const tasks = inputs.map(input => compileEvidenceTask(input)), manifest = assignEvidenceTaskSplits(tasks, policy), reverse = assignEvidenceTaskSplits([...tasks].reverse(), policy);
  assert.equal(manifest.manifestId, reverse.manifestId); assert.deepEqual(manifest.assignments, reverse.assignments);
  const members = tasks.map(task => evidenceTaskSplitMembership(manifest, task));
  assert.equal(members[0].groupId, members[1].groupId); assert.equal(members[1].groupId, members[2].groupId);
  assert.equal(members[3].groupId, members[4].groupId); assert.notEqual(members[0].groupId, members[3].groupId);
  assert.equal(manifest.audit.nearDuplicateCoverage, 'unchecked'); assert.equal(manifest.audit.trainingContamination, 'not-established');
  assert.equal(manifest.work.sourceIdentityReuse, 'compiler-owned-digests; no-text-rehash');
  const future = authoredEvidenceTask(); future.sourceSnapshot[0].availableAt = future.spec.cutoffAt + 1;
  const quarantined = prepare(future); assert.equal(inspectEvidenceTaskCompilation(quarantined.task).state, 'quarantined');
  assert.throws(() => projectRunnableEvidenceTask(quarantined.manifest, quarantined.task), { code: 'ERR_EVIDENCE_TASK_SPLIT' });
  assert.equal(score(quarantined, []).executionStatus, 'invalid-fixture');
  const metadata = authoredEvidenceTask(); metadata.sourceSnapshot[0].path = '.git/config';
  assert.equal(inspectEvidenceTaskCompilation(compileEvidenceTask(metadata)).state, 'quarantined');
  const historical = authoredEvidenceTask(); historical.spec.historyRegime = 'declared-history-permitted';
  assert.equal(inspectEvidenceTaskCompilation(compileEvidenceTask(historical)).state, 'quarantined');
  assert.throws(() => evidenceTaskSplitMembership({ ...manifest }, tasks[0]), { code: 'ERR_EVIDENCE_TASK_SPLIT' });
} else {
  const task = prepare(), ref = task.input.privateOracle.units[1].source;
  const changed = { ...ref, sourceHash: '0'.repeat(64) }, invalid = score(task, [ref, changed]);
  assert.equal(invalid.taskResult, 'fail'); assert.equal(invalid.reason, 'invalid-source-evidence');
  const input = authoredEvidenceTask(); input.spec.limits.maxSelectedSourceBytes = 1;
  assert.equal(score(prepare(input), [input.privateOracle.units[1].source]).reason, 'declared-evidence-budget-exceeded');
  const unicode = task.input.privateOracle.units[2].source, text = task.input.sourceSnapshot[2].text, middle = text.indexOf('😀') + 1;
  assert.equal(score(task, [{ ...unicode, span: [middle, unicode.span[1]] }]).axes.sourceValidity, 'invalid');
  assert.throws(() => readCandidateEvidenceSource(task.task, { ...unicode, span: [middle, unicode.span[1]] }), { code: 'ERR_EVIDENCE_TASK_SOURCE' });
  const noRead = authoredEvidenceTask(); noRead.spec.allowedActions = ['search-visible-source']; const unavailable = prepare(noRead);
  assert.throws(() => readCandidateEvidenceSource(unavailable.task, noRead.privateOracle.units[0].source), { code: 'ERR_EVIDENCE_TASK_ACTION_UNAVAILABLE' });
  assert.throws(() => scoreEvidenceTask({ ...task, submission: submission(task.task, [], { publicTaskId: '0'.repeat(64) }) }), { code: 'ERR_EVIDENCE_TASK_SCOPE' });
  const nextWorld = authoredEvidenceTask(); nextWorld.spec.worldRef.generation.semanticRevision++;
  const nextTask = prepare(nextWorld);
  assert.equal(nextWorld.privateOracle.units[1].source.sourceUnitId, ref.sourceUnitId, 'unchanged bytes can retain source identity across worlds');
  assert.throws(() => scoreEvidenceTask({ ...nextTask, submission: submission(task.task, [ref]) }), { code: 'ERR_EVIDENCE_TASK_SCOPE' });
  const controller = new AbortController(); controller.abort();
  assert.throws(() => compileEvidenceTask(authoredEvidenceTask(), { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => scoreEvidenceTask({ ...task, submission: submission(task.task, [ref]) }, { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => scoreEvidenceTask({ ...task, submission: submission(task.task, [ref]) }, { maxBytes: 1024 }), { code: 'ERR_EVIDENCE_TASK_OUTPUT_LIMIT' });
  let reads = 0; const accessor = { ...authoredEvidenceTask(), get privateOracle() { reads++; return {}; } };
  assert.throws(() => compileEvidenceTask(accessor)); assert.equal(reads, 0);
}
console.log('Finite evidence tasks keep private oracles out of visible packets and retain alternate solutions, unknowns and exact leakage groups.');
