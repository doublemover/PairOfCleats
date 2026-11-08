import assert from 'node:assert/strict';
import { createBuildIndexOutcome, describeBuildIndexOutcome } from '../../../src/integrations/core/build-index/outcome.js';
const selected = { repo: 'fixture', stage: 'stage2', modes: ['code'], buildId: 'selected', buildRoot: 'C:/fixture/selected',
  runtimeAttemptId: 'attempt', validation: { status: 'passed' }, publication: { status: 'published' } };
const outcome = createBuildIndexOutcome({ result: { repo: 'fixture', modes: ['code'], stage2: selected,
  stage3: { embeddings: { skipped: true } } } });
assert.equal(outcome.status, 'index-published');
assert.equal(outcome.generations[0].buildId, 'selected');
assert.equal(outcome.generations[0].attemptId, 'attempt');
assert.equal(outcome.counts, null, 'unqualified preprocess counts cannot enter this outcome');
assert.match(describeBuildIndexOutcome(outcome, 2), /published.*Skipped: stage3/);
for (const [embeddings, expected] of [[{ skipped: true }, 'skipped'], [{ queued: true }, 'pending'],
  [{ skipped: true, notAdmitted: true }, 'not-admitted'], [{ cancelled: true }, 'cancelled'], [{ inline: true }, 'stage-completed']]) {
  assert.equal(createBuildIndexOutcome({ result: { stage: 'stage3', embeddings } }).status, expected);
}
assert.equal(createBuildIndexOutcome({ error: new Error('failed') }).status, 'failed');
const partial = createBuildIndexOutcome({ result: { stage: 'stage3', modes: ['code', 'prose'], embeddings: {
  queued: true, notAdmitted: true, requestedModeCount: 2, admittedModeCount: 1,
  rejectedModes: [{ mode: 'prose', reason: 'queue-full' }], jobs: [{ id: 'queued-code', mode: 'code' }] } } });
assert.equal(partial.status, 'pending');
assert.deepEqual(partial.stages[0].admission, { status: 'partial', requestedModeCount: 2, admittedModeCount: 1,
  rejectedModes: [{ mode: 'prose', reason: 'queue-full' }], jobs: [{ id: 'queued-code', mode: 'code' }] });
assert.match(describeBuildIndexOutcome(partial, 0), /queued.*prose: queue-full/i);
const split = createBuildIndexOutcome({ result: { stage: 'stage3', modeGenerations: [
  { mode: 'code', buildId: 'code-selected', buildRoot: 'C:/code' },
  { mode: 'prose', buildId: 'prior-prose-retained', buildRoot: 'C:/prose' }], embeddings: { skipped: true } } });
assert.deepEqual(split.generations.map(row => [row.buildId, row.modes]), [['code-selected', ['code']], ['prior-prose-retained', ['prose']]]);
console.log('Build outcomes use selected results and preserve pending/skipped/not-admitted intent.');
