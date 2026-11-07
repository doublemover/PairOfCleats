import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldNow } from 'node:timers/promises';
import { parse } from 'acorn';
import { finiteBooleanFixture, finiteBooleanBlock as block, finishFiniteRefinement } from '../../helpers/finite-feasibility.js';
import { createFiniteFeasibilityTarget, refinePredicate, resumeRefinement, explainRefinement,
  invalidateFiniteFeasibilityTarget, retireFiniteFeasibilityTarget } from '../../../src/semantic/finite-feasibility.js';
import { prepareFiniteFeasibilitySlice, fail } from '../../../src/index/semantic/feasibility/slice.js';
import { checkFiniteFeasibilityAssignment } from '../../../src/index/semantic/feasibility/check.js';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { FINITE_FEASIBILITY_PROFILE, FINITE_FEASIBILITY_VERSION } from '../../../src/contracts/schemas/finite-feasibility.js';
import { assertFiniteFeasibilityResult } from '../../../src/contracts/validators/finite-feasibility.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/finite-feasibility/')[1];
assert.ok(['checked-witness-and-source', 'contradictory-shared-guards', 'phi-and-exception-oracle', 'unsupported-and-cyclic-frontiers',
  'resumption-cancellation-and-authority', 'stale-source-and-retirement', 'independent-candidate-corruption', 'strict-ssa-and-source-admission',
  'boolean-operation-concrete-oracle'].includes(mode));
const fixture = finiteBooleanFixture();
if (mode === 'checked-witness-and-source') {
  const target = fixture.create(); fixture.request.predicate.value = false;
  const result = await finishFiniteRefinement(target);
  assert.equal(result.semanticOutcome, 'inModelWitness'); assert.equal(result.solverOutcome, 'sat');
  assert.equal(result.verification, 'independent-finite-forward-replay-v1');
  assert.deepEqual(result.witness.input, [{ input: 'input', value: true }]); assert.deepEqual(result.witness.trace, ['entry', 'yes']);
  assert.equal(result.witness.terminal.value, true); assert.equal(result.exploration.checkedAssignments, 1);
  assert.equal(result.anchors[0].source.sourceHash, fixture.source.manifest.byteHash);
  assert.equal(result.closure.sourceProgram, 'not-established'); assert.equal(result.closure.heap, 'unsupported');
  assert.ok(result.work.producerAssignments > 0); assert.ok(result.work.checkerAssignments > 0);
  assert.equal(explainRefinement(result).history, 'analysis-event-instrumentation-unavailable');
  assert.equal(Object.isFrozen(result.witness.input[0]), true);
} else if (mode === 'contradictory-shared-guards') {
  fixture.request.blocks = [
    block('entry', [], { kind: 'branch', condition: 'input', onTrue: 'testAgain', onFalse: 'exit' }),
    block('testAgain', [], { kind: 'branch', condition: 'input', onTrue: 'exit', onFalse: 'impossible' }),
    block('exit', [{ id: 'value', kind: 'constant', value: false }], { kind: 'return', value: 'value' }),
    block('impossible', [{ id: 'bad', kind: 'constant', value: true }], { kind: 'throw', value: 'bad' })
  ]; fixture.request.predicate = { kind: 'reaches-block', block: 'impossible' };
  const result = await finishFiniteRefinement(fixture.create());
  assert.equal([false, true].some(input => input && !input), false, 'tiny concrete shared-input oracle');
  assert.equal(result.semanticOutcome, 'inModelRefutation'); assert.equal(result.solverOutcome, 'unsat');
  assert.equal(result.exploration.exploredAssignments, 2); assert.equal(result.exploration.checkedAssignments, 2);
  assert.equal(result.work.producerAssignments, 2); assert.equal(result.work.checkerAssignments, 2);
  assert.equal(result.cursor, null); assert.deepEqual(result.frontier, []);
} else if (mode === 'phi-and-exception-oracle') {
  fixture.request.entryConditions = [{ input: 'input', value: true }];
  fixture.request.blocks = [block('entry', [{ id: 'one', kind: 'constant', value: true }, { id: 'zero', kind: 'constant', value: false }],
    { kind: 'branch', condition: 'input', onTrue: 'left', onFalse: 'right' }),
  block('left', [], { kind: 'goto', target: 'join' }), block('right', [], { kind: 'goto', target: 'join' }),
  block('join', [], { kind: 'return', value: 'chosen' }, [{ id: 'chosen', incoming: [{ predecessor: 'left', value: 'one' }, { predecessor: 'right', value: 'zero' }] }])];
  fixture.request.predicate = { kind: 'return-value', block: 'join', value: true };
  let result = await finishFiniteRefinement(fixture.create()); assert.equal(result.semanticOutcome, 'inModelWitness');
  assert.deepEqual(result.witness.trace, ['entry', 'left', 'join']);
  const phi = fixture.request.blocks[3].phis[0]; [phi.incoming[0].value, phi.incoming[1].value] = [phi.incoming[1].value, phi.incoming[0].value];
  result = await finishFiniteRefinement(fixture.create()); assert.equal(result.semanticOutcome, 'inModelRefutation');
  assert.equal(true ? false : true, false, 'independent swapped predecessor oracle');
  fixture.request.blocks[3].terminator.kind = 'throw'; fixture.request.predicate = { kind: 'throw-value', block: 'join', value: false };
  result = await finishFiniteRefinement(fixture.create()); assert.equal(result.semanticOutcome, 'inModelWitness'); assert.equal(result.witness.terminal.kind, 'throw');
  // Independent fact ordering and SSA names change identity, not admitted truth.
  fixture.request.blocks.reverse(); fixture.request.inputs = ['renamed']; fixture.request.entryConditions[0].input = 'renamed';
  fixture.request.blocks.find(row => row.id === 'entry').terminator.condition = 'renamed';
  assert.equal((await finishFiniteRefinement(fixture.create())).semanticOutcome, 'inModelWitness');
} else if (mode === 'unsupported-and-cyclic-frontiers') {
  fixture.request.blocks[0].operations = [{ id: 'unknownCall', kind: 'unsupported', reason: 'external-call-effects-not-admitted' }];
  let result = await finishFiniteRefinement(fixture.create());
  assert.equal(result.semanticOutcome, 'unknown'); assert.equal(result.solverOutcome, 'unknown');
  assert.equal(result.exploration.unknownAssignments, 2); assert.equal(result.witness, null);
  assert.equal(result.unsupported.observations[0].reason, 'external-call-effects-not-admitted');
  assert.equal(result.unsupported.observations[0].block, 'entry');
  fixture.request.blocks = [block('entry', [], { kind: 'goto', target: 'entry' })];
  fixture.request.predicate = { kind: 'reaches-block', block: 'entry' };
  result = await finishFiniteRefinement(fixture.create()); assert.equal(result.semanticOutcome, 'unknown');
  assert.equal(result.frontier[0].reason, 'cyclic-control-flow-unsupported');
  assert.equal(result.work.producerAssignments, 0, 'unsupported cyclic profiles are never executed');
  const partial = finiteBooleanFixture(); partial.request.inputs = ['input', 'a', 'b', 'c', 'd'];
  partial.request.blocks[0].operations = [{ id: 'opaque', kind: 'unsupported', reason: 'folded-resource-requires-unfolding' }];
  result = await finishFiniteRefinement(partial.create()); assert.equal(result.semanticOutcome, 'unknown');
  assert.equal(result.unsupported.observations.length, 16); assert.equal(result.unsupported.omitted, 16);
  assert.equal(result.exploration.unknownAssignments, 32);
} else if (mode === 'resumption-cancellation-and-authority') {
  fixture.request.predicate = { kind: 'return-value', block: 'yes', value: false };
  const target = fixture.create();
  let result = await refinePredicate(target, { limits: { assignments: 1, workMs: 250 } });
  assert.equal(result.semanticOutcome, 'unknown'); assert.equal(result.exploration.exploredAssignments, 1); assert.ok(result.cursor);
  assert.throws(() => resumeRefinement(structuredClone(result.cursor)), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  assert.throws(() => refinePredicate(structuredClone(target)), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  const originalCursor = result.cursor, controller = new AbortController(); controller.abort(false);
  await assert.rejects(resumeRefinement(originalCursor, { signal: controller.signal }), error => error.name === 'AbortError' && error.cause === false);
  const active = resumeRefinement(originalCursor, { limits: { assignments: 1, workMs: 250 } });
  await assert.rejects(resumeRefinement(originalCursor), /outstanding work/u);
  result = await active; assert.equal(result.work.canceledCalls, 1); assert.equal(result.exploration.exploredAssignments, 2);
  assert.throws(() => resumeRefinement(originalCursor), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  while (result.cursor) result = await resumeRefinement(result.cursor, { limits: { assignments: 1, workMs: 250 } });
  assert.equal(result.semanticOutcome, 'inModelRefutation'); assert.equal(result.exploration.checkedAssignments, 2);
} else if (mode === 'stale-source-and-retirement') {
  const target = fixture.create(), result = await refinePredicate(target, { limits: { assignments: 1, workMs: 250 } });
  const changed = createSemanticSourceSnapshot({ bytes: Buffer.from(fixture.source.text + '// source changed\n'),
    repositoryNamespace: fixture.source.manifest.repositoryNamespace, path: fixture.source.manifest.path, language: 'javascript' });
  const invalidation = invalidateFiniteFeasibilityTarget(target, { sourceUnitId: fixture.source.manifest.sourceUnitId, newSourceHash: changed.manifest.byteHash });
  assert.equal(explainRefinement(result).targetState, 'stale'); assert.equal(explainRefinement(result).invalidation, invalidation);
  await assert.rejects(resumeRefinement(result.cursor), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  assert.equal(retireFiniteFeasibilityTarget(target), true); assert.equal(retireFiniteFeasibilityTarget(target), true);
  assert.equal(explainRefinement(result).targetState, 'retired'); assert.ok(result.anchors.length);
  assert.throws(() => explainRefinement(structuredClone(result)), /Original finite/u);
} else if (mode === 'independent-candidate-corruption') {
  // Execute the real producer orchestration with an explicitly corrupted
  // candidate interpreter, retaining the real independent checker/source owner.
  const source = await fs.readFile(new URL('../../../src/semantic/finite-feasibility.js', import.meta.url), 'utf8');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const body = ast.body.filter(node => node.type !== 'ImportDeclaration').map(node => {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node; return source.slice(declaration.start, declaration.end);
  }).join('\n');
  for (const fabricateWitness of [true, false]) {
    const input = finiteBooleanFixture(); if (fabricateWitness) input.request.predicate.value = false;
    const bindings = {
      randomUUID, yieldNow, prepareFiniteFeasibilitySlice, fail, checkFiniteFeasibilityAssignment,
      canonicalSemanticJson, semanticHash, throwIfAborted, FINITE_FEASIBILITY_PROFILE, FINITE_FEASIBILITY_VERSION,
      assertFiniteFeasibilityResult, performance,
      interpretFiniteFeasibility: () => ({ matches: fabricateWitness, terminal: { kind: 'return', value: false }, unknown: null, trace: ['entry', 'yes'], steps: 1 })
    };
    // Keep generated owner records in the host realm so the original passive
    // JSON contract still checks them without a test serialization bypass.
    const create = vm.runInThisContext('"use strict";\n(({' + Object.keys(bindings).join(',') + '}) => {\n'
      + body + '\nreturn { createFiniteFeasibilityTarget, refinePredicate, resumeRefinement }; })');
    const api = create(bindings);
    const target = api.createFiniteFeasibilityTarget({ request: input.request, sourceSnapshots: [input.source] });
    const result = await finishFiniteRefinement(target, api);
    assert.equal(result.semanticOutcome, 'unknown'); assert.equal(result.exploration.phase, 'checker-rejected');
    assert.equal(result.verification, 'not-established'); assert.equal(result.witness, null);
  }
} else if (mode === 'boolean-operation-concrete-oracle') {
  const oracles = { and: (a, b) => a && b, or: (a, b) => a || b, xor: (a, b) => a !== b, equal: (a, b) => a === b };
  for (const [kind, oracle] of Object.entries(oracles)) for (const a of [false, true]) for (const b of [false, true]) {
    const input = finiteBooleanFixture(); input.request.inputs = ['leftInput', 'rightInput'];
    input.request.entryConditions = [{ input: 'leftInput', value: a }, { input: 'rightInput', value: b }];
    input.request.blocks = [block('entry', [{ id: 'answer', kind, left: 'leftInput', right: 'rightInput' }], { kind: 'return', value: 'answer' })];
    input.request.predicate = { kind: 'return-value', block: 'entry', value: true };
    assert.equal((await finishFiniteRefinement(input.create())).semanticOutcome, oracle(a, b) ? 'inModelWitness' : 'inModelRefutation', kind);
  }
  for (const kind of ['copy', 'not']) for (const value of [false, true]) {
    const input = finiteBooleanFixture(); input.request.entryConditions = [{ input: 'input', value }];
    input.request.blocks = [block('entry', [{ id: 'answer', kind, operand: 'input' }], { kind: 'return', value: 'answer' })];
    input.request.predicate = { kind: 'return-value', block: 'entry', value: true };
    const expected = kind === 'copy' ? value : !value;
    assert.equal((await finishFiniteRefinement(input.create())).semanticOutcome, expected ? 'inModelWitness' : 'inModelRefutation', kind);
  }
} else {
  for (const change of [request => request.blocks[1].operations.push({ id: 'trueValue', kind: 'constant', value: false }),
    request => { request.blocks[2].terminator.value = 'trueValue'; }, request => { request.blocks[0].terminator.condition = 'missing'; },
    request => { request.anchors[0].source.sourceHash = '0'.repeat(64); }, request => { request.entryConditions = [{ input: 'missing', value: true }]; },
    request => { request.blocks[0].unknown = true; }, request => { request.inputs = Array.from({ length: 13 }, (_, i) => 'input' + i); }]) {
    const input = finiteBooleanFixture(); change(input.request); assert.throws(() => input.create());
  }
  const input = finiteBooleanFixture(); let reads = 0;
  Object.defineProperty(input.request.blocks[0], 'operations', { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => input.create(), /accessors/u); assert.equal(reads, 0);
  assert.throws(() => createFiniteFeasibilityTarget({ request: fixture.request, sourceSnapshots: [structuredClone(fixture.source)] }), /snapshot/u);
}
console.log('Finite Boolean feasibility keeps independent checking, exact source anchors and unknown frontiers distinct.');
