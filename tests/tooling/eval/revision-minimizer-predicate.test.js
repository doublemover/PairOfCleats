import assert from 'node:assert/strict';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { generateRevisionScenario, sealRevisionEdits } from '../../../tools/eval/revisions/scenario.js';
import { minimizeRevisionSequence } from '../../../tools/eval/revisions/minimize.js';

// Explicit finite boundary model exercises the shared deletion engine, without
// creating a fake production execution handle or claiming a current owner fails.
const scenario = generateRevisionScenario({ worldRef: createRepositoryAnswerInput().queryReceipt.world, family: 'join-cross-term' });
const checkpointId = 'simultaneous-inputs', originalReceipt = { executionId: 'original-model', outcome: 'fail', targetFailure: true };
let runs = 0, retired = 0;
const owner = { originalScenario: scenario, originalReceipt, selection: { checkpointId }, kind: 'finite-minimizer-model', predicate: 'named-model-failure',
  matches: receipt => receipt.outcome === 'fail' && receipt.targetFailure === true,
  seal: sealRevisionEdits, invalidScenario: error => error?.code === 'ERR_REVISION_ORACLE_SCENARIO',
  run(candidate) { runs++; return { candidate }; },
  read() { return { executionId: 'unknown-' + runs, scenarioId: '0'.repeat(64), outcome: 'unknown', targetFailure: true }; },
  dispose() { retired++; } };
const unknown = minimizeRevisionSequence(owner, { checkpointId });
assert.equal(unknown.changed, false); assert.equal(runs, retired);
assert.ok(unknown.attempts.some(row => row.outcome === 'unknown' && !row.accepted));
assert.ok(unknown.attempts.some(row => row.outcome === 'invalid-precondition' && !row.accepted));
for (const replacement of [{ outcome: 'pass', targetFailure: true }, { outcome: 'fail', targetFailure: false }]) {
  const result = minimizeRevisionSequence({ ...owner, read() { return { executionId: 'other', scenarioId: '1'.repeat(64), ...replacement }; } }, { checkpointId });
  assert.equal(result.changed, false); assert.ok(result.attempts.every(row => !row.accepted));
}
const accepted = minimizeRevisionSequence({ ...owner, read() { return { executionId: 'target', scenarioId: '2'.repeat(64), outcome: 'fail', targetFailure: true }; } }, { checkpointId });
assert.equal(accepted.changed, true); assert.equal(accepted.scenario.revisions.length, 1); assert.equal(scenario.revisions.length, 3);
assert.equal(runs, retired, 'every actual modeled proposal is disposed, including nonmatching outcomes');
assert.throws(() => minimizeRevisionSequence({ ...owner, originalReceipt: { outcome: 'pass' } }, { checkpointId }), /no matching independent failure/);
const controller = new AbortController(); controller.abort(null);
assert.throws(() => minimizeRevisionSequence(owner, { checkpointId, signal: controller.signal }), error => error.name === 'AbortError' && error.cause === null);
console.log('Revision minimization preserves original witnesses and rejects unknown, invalid and different failures.');
