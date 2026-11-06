import assert from 'node:assert/strict';
import { authoredEvidenceTask, evidenceTaskHash as hash } from '../../helpers/finite-evidence-task.js';
import { evidenceTaskSourceReference } from '../../../src/retrieval/evaluation/tasks/compiler.js';
import { readEvidenceTaskViewPrefix } from '../../../src/retrieval/evaluation/tasks/candidate-view.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/evidence-task-candidate-view/')[1];
assert.ok(['oracle-blind-baselines', 'candidate-view-retirement', 'prefix-budgets-and-authority'].includes(mode));
const adapter = await getOfflineEvaluationAdapter('finite-source-evidence-v1');
const policy = { schemaVersion: 1, seed: 'candidate-view-tests', train: 5000, dev: 2000, calibration: 1000, test: 2000 };
const prepare = input => {
  const task = adapter.compile(input), manifest = adapter.assignSplits([task], policy), view = adapter.materialize({ task, manifest });
  return { task, manifest, view };
};
const request = (method = 'lexical-visible-prefix-v1') => ({ schemaVersion: 1, method, runId: hash('candidate-run'),
  maxReadBytes: 1048576, maxSelectedFiles: 1, maxSelectedSourceBytes: 1048576, maxWorkMs: 250 });
const score = (task, artifact) => adapter.score({ task: task.task, manifest: task.manifest, submission: artifact.submission });
if (mode === 'oracle-blind-baselines') {
  const first = authoredEvidenceTask(); first.spec.problem = 'Find alternative';
  const second = structuredClone(first); second.privateOracle.alternatives = [second.privateOracle.alternatives[0]];
  const left = prepare(first), right = prepare(second);
  const one = adapter.runCandidate({ view: left.view, request: request() }), two = adapter.runCandidate({ view: right.view, request: request() });
  assert.deepEqual(one.submission, two.submission, 'changing private labels cannot alter visible-file scoring or membership');
  assert.equal(one.submission.evidence[0].path, 'src/alternative.js');
  assert.equal(score(left, one).taskResult, 'pass'); assert.equal(score(right, two).taskResult, 'fail', 'the independent private oracle can reject an unchanged candidate');
  const ordered = adapter.runCandidate({ view: left.view, request: request('source-order-files-v1') });
  assert.equal(ordered.submission.evidence[0].path, 'src/alternative.js'); assert.equal(ordered.work.sourceBytesRead, 0);
  assert.equal(ordered.work.inspectedFiles, 0); assert.equal(ordered.observedReadOrUse, 'visible-metadata-only');
  assert.ok(one.work.sourceBytesRead > 0); assert.ok(one.work.featureWork > 0);
  assert.deepEqual(adapter.candidatePacket(left.view), adapter.candidatePacket(right.view));
  assert.deepEqual(Object.keys(left.view).sort(), ['profile', 'publicTaskId']);
  assert.equal(adapter, await getOfflineEvaluationAdapter('finite-source-evidence-v1')); assert.ok(Object.isFrozen(adapter.capabilities));
  adapter.dispose(left.view); adapter.dispose(right.view); adapter.disposeTask(left.task); adapter.disposeTask(right.task);
} else if (mode === 'candidate-view-retirement') {
  const task = prepare(authoredEvidenceTask()), sibling = adapter.materialize({ task: task.task, manifest: task.manifest });
  const packet = adapter.candidatePacket(sibling), file = packet.sources[0], ref = { sourceUnitId: file.sourceUnitId, sourceHash: file.sourceHash,
    path: file.path, span: [0, file.utf16Length], coordinateUnit: 'utf16' };
  const retired = adapter.dispose(task.view); assert.equal(retired.nativeResources, 'none'); assert.equal(adapter.dispose(task.view), retired);
  assert.throws(() => adapter.runCandidate({ view: task.view, request: request() }), { code: 'ERR_EVIDENCE_TASK_VIEW' });
  assert.equal(adapter.readSource(sibling, ref).text, authoredEvidenceTask().sourceSnapshot.find(source => source.path === ref.path).text);
  assert.throws(() => adapter.candidatePacket({ ...sibling }), { code: 'ERR_EVIDENCE_TASK_VIEW' });
  adapter.disposeTask(task.task);
  assert.throws(() => adapter.readSource(sibling, ref), { code: 'ERR_EVIDENCE_TASK_HANDLE' });
  adapter.dispose(sibling);
} else {
  const task = prepare(authoredEvidenceTask()), limited = request(); limited.maxReadBytes = 1;
  const result = adapter.runCandidate({ view: task.view, request: limited });
  assert.deepEqual(result.submission.evidence, []); assert.equal(result.work.sourceBytesRead, 0);
  assert.equal(result.frontier[0].sourceCount, 3); assert.equal(result.frontier[0].nextSourceOffset, 0);
  assert.equal(result.frontier[0].reason, 'source-read-budget'); assert.equal(result.selection, 'bounded-heuristic-not-certified-ranked-prefix');
  const input = authoredEvidenceTask(); input.sourceSnapshot[0].text = '😀x';
  input.privateOracle.units[0].source = evidenceTaskSourceReference({ repositoryNamespace: input.spec.worldRef.repositoryNamespace,
    ...input.sourceSnapshot[0], span: [0, input.sourceSnapshot[0].text.length] });
  const unicode = prepare(input), id = input.privateOracle.units[0].source.sourceUnitId;
  assert.equal(readEvidenceTaskViewPrefix(unicode.view, id, { maxCodeUnits: 1 }).text, '');
  assert.equal(readEvidenceTaskViewPrefix(unicode.view, id, { maxCodeUnits: 2 }).text, '😀');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => adapter.runCandidate({ view: task.view, request: request() }, { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => adapter.runCandidate({ view: task.view, request: { ...request(), execute: () => {} } }));
  const noRead = authoredEvidenceTask(); noRead.spec.allowedActions = ['search-visible-source']; const denied = prepare(noRead);
  assert.throws(() => adapter.runCandidate({ view: denied.view, request: request() }), { code: 'ERR_EVIDENCE_TASK_BASELINE' });
  for (const active of [task, unicode, denied]) { adapter.dispose(active.view); adapter.disposeTask(active.task); }
}
console.log('Registered candidate baselines consume visible capabilities only, with exact read budgets and independent private scoring.');
