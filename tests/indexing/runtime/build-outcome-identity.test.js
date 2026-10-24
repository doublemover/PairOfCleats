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
console.log('Build outcomes use selected results and preserve pending/skipped/not-admitted intent.');
