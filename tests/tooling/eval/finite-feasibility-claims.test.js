import assert from 'node:assert/strict';
import { finiteBooleanFixture, finiteBooleanBlock, finishFiniteRefinement } from '../../helpers/finite-feasibility.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { refinePredicate, readCheckedFiniteFeasibilityClaim, invalidateFiniteFeasibilityTarget,
  retireFiniteFeasibilityTarget } from '../../../src/semantic/finite-feasibility.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/finite-feasibility-claims/')[1];
assert.ok(['exact-scope-and-original-receipts', 'offline-adapter-and-versioned-state'].includes(mode));
const scopeFor = (result, request) => ({ targetIdentity: result.targetIdentity, sourceSetId: result.sourceSetId,
  world: request.world, predicate: request.predicate, scope: 'supplied-finite-model-only' });
if (mode === 'exact-scope-and-original-receipts') {
  const fixture = finiteBooleanFixture(), target = fixture.create(), result = await finishFiniteRefinement(target);
  const scope = scopeFor(result, fixture.request), claim = readCheckedFiniteFeasibilityClaim(result, scope);
  assert.equal(claim.outcome, 'exists-in-finite-input-domain'); assert.equal(claim.sourceProgram, 'not-established');
  assert.deepEqual(claim.witness.input, [{ input: 'input', value: true }]); assert.equal(claim.totalAssignments, 2);
  assert.equal(readCheckedFiniteFeasibilityClaim(result, scope), claim);
  const second = await finishFiniteRefinement(fixture.create()), secondClaim = readCheckedFiniteFeasibilityClaim(second, scope);
  assert.equal(second.targetIdentity, result.targetIdentity); assert.notEqual(second.executionId, result.executionId);
  assert.equal(secondClaim.claimId, claim.claimId, 'equivalent finite judgments retain their semantic identity');
  assert.notEqual(secondClaim.receiptId, claim.receiptId, 'separate actual executions never collapse as one receipt');
  assert.throws(() => readCheckedFiniteFeasibilityClaim(structuredClone(result), scope), /Original finite/u);
  assert.throws(() => readCheckedFiniteFeasibilityClaim(result, { ...scope, predicate: { ...scope.predicate, value: false } }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  assert.throws(() => readCheckedFiniteFeasibilityClaim(result, { ...scope, scope: 'source-program' }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  assert.throws(() => readCheckedFiniteFeasibilityClaim(result, { ...scope, targetIdentity: '0'.repeat(64) }), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  assert.throws(() => readCheckedFiniteFeasibilityClaim(result, { ...scope, sourceSetId: '0'.repeat(64) }), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  assert.throws(() => readCheckedFiniteFeasibilityClaim(result, { ...scope, world: { ...scope.world, contextKey: 'different-context' } }), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  const pending = await refinePredicate(fixture.create(), { limits: { assignments: 1, workMs: 250 } });
  assert.throws(() => readCheckedFiniteFeasibilityClaim(pending, scopeFor(pending, fixture.request)), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
  invalidateFiniteFeasibilityTarget(target, { sourceUnitId: fixture.source.manifest.sourceUnitId, newSourceHash: 'f'.repeat(64) });
  assert.throws(() => readCheckedFiniteFeasibilityClaim(result, scope), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  assert.equal(claim.sourceProgram, 'not-established', 'retained historical bytes never gain a broader claim');
  retireFiniteFeasibilityTarget(target);
} else {
  const adapter = await getOfflineEvaluationAdapter('finite-boolean-acyclic-v1');
  assert.equal(adapter, await getOfflineEvaluationAdapter('finite-boolean-acyclic-v1'));
  assert.equal(Object.isFrozen(adapter), true); assert.equal(Object.isFrozen(adapter.capabilities), true);
  assert.deepEqual(adapter.capabilities, ['createTarget', 'refine', 'resume', 'explain', 'claim', 'invalidate', 'dispose']);
  await assert.rejects(getOfflineEvaluationAdapter('unregistered-boolean-profile'), { code: 'ERR_INTERVENTION_ADAPTER_UNAVAILABLE' });
  const fixture = finiteBooleanFixture();
  fixture.request.blocks = [finiteBooleanBlock('entry', [
    { id: 'observedOld', kind: 'copy', operand: 'input' }, { id: 'nextState', kind: 'not', operand: 'input' },
    { id: 'changed', kind: 'xor', left: 'observedOld', right: 'nextState' }
  ], { kind: 'return', value: 'changed' })];
  fixture.request.predicate = { kind: 'return-value', block: 'entry', value: false };
  const target = adapter.createTarget({ request: fixture.request, sourceSnapshots: [fixture.source] });
  const result = await finishFiniteRefinement(target, { refinePredicate: adapter.refine, resumeRefinement: adapter.resume });
  assert.equal([false, true].every(old => old !== !old), true, 'tiny versioned old-read/new-write transition oracle');
  const claim = adapter.claim(result, scopeFor(result, fixture.request));
  assert.equal(claim.outcome, 'absent-in-finite-input-domain'); assert.equal(claim.totalAssignments, 2);
  assert.equal(claim.witness, null); assert.equal(adapter.explain(result).programExecution, 'none');
  assert.equal(adapter.dispose(target), true);
  assert.throws(() => adapter.claim(result, scopeFor(result, fixture.request)), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  fixture.request.blocks[0].operations.push({ id: 'input', kind: 'constant', value: true });
  assert.throws(() => adapter.createTarget({ request: fixture.request, sourceSnapshots: [fixture.source] }), /Unique SSA/u);
}
console.log('Checked finite claims retain original execution, exact scope and offline-only authority.');
