import assert from 'node:assert/strict';
import { compileRepositoryQuestion, QUESTION_PREDICATES } from '../../../src/semantic/questions/compile.js';
import { executeFiniteRepositoryQuestion } from '../../../src/semantic/questions/reference.js';
import { assertRepositoryQuestion } from '../../../src/contracts/validators/repository-question.js';
import { REPOSITORY_QUESTION_VERSION } from '../../../src/contracts/schemas/repository-question.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/compiler-reference/')[1];
assert.ok(['correlated-typed-facts', 'exhaustive-small-models', 'compiler-contract', 'identity-and-inputs',
  'bounds-and-unknowns', 'positions-and-determinism'].includes(mode));
const world = { repositoryNamespace: 'fixture-repository', generation: { baseBuildId: 'fixture-build', semanticRevision: 0 },
  sourceSnapshotId: 'source-snapshot', contextKey: 'context', domainId: 'selected-source-domain', producerId: 'finite-fixture' };
const ref = localId => ({ partitionId: 'sy1:' + 'a'.repeat(64), localId });
const source = start => ({ sourceUnitId: 'su1:' + 'b'.repeat(64), sourceHash: 'c'.repeat(64), path: 'src/http/handler.js',
  span: [start, start + 1], coordinateUnit: 'utf16' });
const entity = (id, sort, data, start = id) => ({ ref: ref(id), sort, source: source(start), ...data });
const request = () => ({ schemaVersion: REPOSITORY_QUESTION_VERSION, world, semantics: 'retained-facts',
  bind: [{ id: 'c', sort: 'Invocation', scan: { sourcePrefix: 'src/http/', invocationKind: 'call' } },
    { id: 'd', sort: 'Declaration' }, { id: 'a', sort: 'Literal' }],
  where: { all: [{ id: 'target', predicate: 'recordedTargetCandidate', args: ['$c', '$d'] },
    { id: 'name', predicate: 'declaredNameEquals', args: ['$d', 'parseRequest'] },
    { id: 'arg', predicate: 'operandAt', args: ['$c', 'argument', 1, '$a'] },
    { id: 'zero', predicate: 'parserLiteralEquals', args: ['$a', { type: 'number', representation: '0' }] }] },
  select: ['$c', '$d', '$a'], distinctBy: ['$c', '$d', '$a'], order: { kind: 'source-order' } });
const model = () => ({ schemaVersion: REPOSITORY_QUESTION_VERSION, world, domain: { state: 'complete', meaning: 'supplied-finite-input' },
  entities: [entity(0, 'Invocation', { invocationKind: 'call' }, 2), entity(1, 'Invocation', { invocationKind: 'call' }, 10),
    entity(10, 'Declaration', { name: 'parseRequest' }, 30), entity(11, 'Declaration', { name: 'other' }, 40),
    entity(20, 'Literal', { scalar: { type: 'number', representation: '0' } }, 4),
    entity(21, 'Literal', { scalar: { type: 'number', representation: '1' } }, 12)],
  targets: [{ id: 'target-0', invocation: ref(0), declaration: ref(10), certainty: 'modeled' },
    { id: 'target-1', invocation: ref(1), declaration: ref(11), certainty: 'heuristic' }],
  operands: [{ id: 'arg-0', invocation: ref(0), role: 'argument', ordinal: 1, child: ref(20), flags: [] },
    { id: 'arg-1', invocation: ref(1), role: 'argument', ordinal: 1, child: ref(21), flags: [] }] });
const plan = compileRepositoryQuestion(request()); assert.equal(plan.status, 'compiled');
const ids = result => result.rows.map(row => row.bindings.map(binding => binding.ref.localId));
if (mode === 'correlated-typed-facts') {
  assert.deepEqual(ids(executeFiniteRepositoryQuestion(plan, model())), [[0, 10, 20]]);
  const split = model(); split.entities[4].scalar.representation = '1'; split.entities[5].scalar.representation = '0';
  assert.deepEqual(ids(executeFiniteRepositoryQuestion(plan, split)), [], 'target and argument on different invocations cannot satisfy one correlated tuple');
  for (const scalar of [{ type: 'boolean', representation: 'false' }, { type: 'string', representation: '0' }]) {
    const different = model(); different.entities[4].scalar = scalar;
    assert.deepEqual(ids(executeFiniteRepositoryQuestion(plan, different)), [], 'falsey/printed spelling cannot coerce to numeric zero');
  }
  const unknown = model(); unknown.entities[4].scalar = null;
  const answer = executeFiniteRepositoryQuestion(plan, unknown);
  assert.deepEqual(ids(answer), []); assert.equal(answer.status, 'partial');
  assert.ok(answer.frontier.some(row => row.reason === 'parser-scalar-unavailable'));
  assert.equal(answer.completion.programSemantics, 'not-established');
} else if (mode === 'exhaustive-small-models') {
  // Independent truth table: only target bit 0 and the first typed scalar are
  // accepted; production query/normalization functions do not build the oracle.
  const values = [{ type: 'number', representation: '0' }, { type: 'number', representation: '1' },
    { type: 'boolean', representation: 'false' }, { type: 'string', representation: '0' }];
  let cases = 0;
  for (let targets = 0; targets < 16; targets++) for (let first = 0; first < 4; first++) for (let second = 0; second < 4; second++) {
    const input = model(); input.entities[4].scalar = values[first]; input.entities[5].scalar = values[second]; input.targets = [];
    for (let call = 0; call < 2; call++) for (let declaration = 0; declaration < 2; declaration++) {
      if (targets & (1 << (call * 2 + declaration))) input.targets.push({ id: 't-' + call + '-' + declaration,
        invocation: ref(call), declaration: ref(10 + declaration), certainty: 'modeled' });
    }
    const expected = [];
    if ((targets & 1) && first === 0) expected.push([0, 10, 20]);
    if ((targets & 4) && second === 0) expected.push([1, 10, 21]);
    const answer = executeFiniteRepositoryQuestion(plan, input);
    assert.deepEqual(ids(answer), expected); assert.equal(answer.status, 'complete-in-supplied-model');
    assert.equal(answer.counts.totalInSuppliedModel, expected.length); assert.equal(answer.counts.programTotal, null); cases++;
  }
  assert.equal(cases, 256);
} else if (mode === 'compiler-contract') {
  const renamed = request(), rename = { '$c': '$call', '$d': '$target', '$a': '$argument' };
  renamed.bind.forEach((binder, index) => { binder.id = ['call', 'target', 'argument'][index]; });
  for (const atom of renamed.where.all) atom.args = atom.args.map(value => typeof value === 'string' && rename[value] ? rename[value] : value);
  renamed.select = renamed.select.map(value => rename[value]); renamed.distinctBy = [...renamed.select];
  const alpha = compileRepositoryQuestion(renamed);
  assert.equal(alpha.logicalPlanId, plan.logicalPlanId); assert.equal(alpha.physicalPlanId, plan.physicalPlanId);
  assert.notEqual(alpha.requestDigest, plan.requestDigest);
  const repeated = request(); repeated.where.all.push({ ...repeated.where.all[3], id: 'zero-again' });
  const coalesced = compileRepositoryQuestion(repeated);
  assert.equal(coalesced.logicalPlanId, plan.logicalPlanId);
  assert.equal(coalesced.originMap.find(row => row.authored.length === 2).authored[1].clauseId, 'zero-again');
  const reordered = request(); reordered.where.all.reverse();
  assert.equal(compileRepositoryQuestion(reordered).logicalPlanId, plan.logicalPlanId);
  assert.deepEqual(ids(executeFiniteRepositoryQuestion(compileRepositoryQuestion(reordered), model())), [[0, 10, 20]]);
  const bad = request(); bad.where.all[0].predicate = 'actualRuntimeInvocation';
  assert.ok(compileRepositoryQuestion(bad).diagnostics.some(row => row.code === 'unsupported-predicate'));
  const wrongSort = request(); wrongSort.where.all[0].args[1] = '$a';
  assert.ok(compileRepositoryQuestion(wrongSort).diagnostics.some(row => row.code === 'binder-sort'));
  const unbound = request(); unbound.where.all = unbound.where.all.filter(atom => atom.predicate !== 'operandAt');
  assert.equal(compileRepositoryQuestion(unbound).status, 'rejected');
  assert.equal(compileRepositoryQuestion(request(), [{ id: 'operandAt', version: 1, executionClass: 'write' }]).status, 'rejected');
  const inherited = request(); inherited.where.all[0].predicate = 'toString';
  assert.equal(compileRepositoryQuestion(inherited).status, 'rejected');
  assert.throws(() => QUESTION_PREDICATES.operandAt.inputs.push(3), TypeError);
  assert.throws(() => { plan.logical.scan.sourcePrefix = 'other'; }, TypeError);
} else if (mode === 'identity-and-inputs') {
  const input = model(); input.world = { ...world, contextKey: 'other' };
  assert.throws(() => executeFiniteRepositoryQuestion(plan, input), { code: 'ERR_REPOSITORY_QUESTION_MODEL' });
  let reads = 0;
  const getter = Object.defineProperty({}, 'schemaVersion', { enumerable: true, get() { reads++; return 1; } });
  assert.throws(() => compileRepositoryQuestion(getter)); assert.equal(reads, 0);
  assert.throws(() => executeFiniteRepositoryQuestion({ ...plan }, getter), /original compiled/); assert.equal(reads, 0);
  const duplicate = model(); duplicate.entities.push(duplicate.entities[0]);
  assert.throws(() => executeFiniteRepositoryQuestion(plan, duplicate), /Duplicate entity/);
  const missing = model(); missing.targets[0].declaration = ref(999);
  assert.throws(() => executeFiniteRepositoryQuestion(plan, missing), /Declaration endpoint/);
  for (const prefix of ['../outside', '/outside', 'C:/outside', 'src//http', 'src/../http']) {
    const changed = request(); changed.bind[0].scan.sourcePrefix = prefix;
    assert.equal(compileRepositoryQuestion(changed).status, 'rejected');
  }
  const adjacent = model(); adjacent.entities[0].source = { ...source(2), sourceUnitId: 'su1:' + 'd'.repeat(64), path: 'src/http-other/handler.js' };
  assert.deepEqual(ids(executeFiniteRepositoryQuestion(plan, adjacent)), [], 'prefix matching is segment-aware');
  const invalidAst = request(); invalidAst.where = { not: invalidAst.where };
  assert.throws(() => compileRepositoryQuestion(invalidAst), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
} else if (mode === 'bounds-and-unknowns') {
  const partial = model(); partial.domain.state = 'partial';
  const answer = executeFiniteRepositoryQuestion(plan, partial);
  assert.equal(answer.status, 'partial'); assert.equal(answer.counts.totalInSuppliedModel, null);
  assert.equal(answer.completion.enumeration, 'complete-in-supplied-input'); assert.equal(answer.completion.domain, 'partial');
  const limited = executeFiniteRepositoryQuestion(plan, model(), { maxWork: 1 });
  assert.equal(limited.status, 'partial'); assert.ok(limited.frontier.some(row => row.reason === 'work-budget'));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => executeFiniteRepositoryQuestion(plan, model(), { signal: controller.signal }), { name: 'AbortError' });
  const many = model(); many.targets[1].declaration = ref(10); many.entities[5].scalar.representation = '0';
  const capped = executeFiniteRepositoryQuestion(plan, many, { maxRows: 1 });
  assert.equal(capped.rows.length, 1); assert.equal(capped.counts.totalInSuppliedModel, null);
  assert.ok(capped.frontier.some(row => row.reason === 'response-budget'));
  assert.ok(Buffer.byteLength(JSON.stringify(capped)) + 1 <= 65536);
  const empty = model(); empty.entities = []; empty.targets = []; empty.operands = [];
  const vacuous = executeFiniteRepositoryQuestion(plan, empty);
  assert.equal(vacuous.counts.totalInSuppliedModel, 0); assert.equal(vacuous.counts.programTotal, null);
  assert.equal(vacuous.verification, 'supplied-finite-model');
  assert.throws(() => assertRepositoryQuestion('finiteResult', { ...vacuous, verification: 'live-source-qualified' }));
} else {
  const input = model(); input.entities[3].name = 'parseRequest'; input.entities[5].scalar.representation = '0';
  input.targets.push({ id: 'another-target', invocation: ref(0), declaration: ref(11), certainty: 'exact-static' });
  const first = executeFiniteRepositoryQuestion(plan, input);
  assert.deepEqual(ids(first), [[0, 10, 20], [0, 11, 20], [1, 11, 21]], 'numeric source positions and distinct same-name declarations retain stable bindings');
  const reordered = structuredClone(input); reordered.entities.reverse(); reordered.targets.reverse(); reordered.operands.reverse();
  assert.deepEqual(executeFiniteRepositoryQuestion(plan, reordered).rows, first.rows);
  input.entities[0].source.span[0] = 999;
  assert.equal(first.rows[0].bindings[0].source.span[0], 2, 'the interpreter owns its input coordinate containers');
  const wrong = model(); wrong.entities[4].scalar.representation = '2';
  const explanation = executeFiniteRepositoryQuestion(plan, wrong).refutations.find(row => row.reason === 'typed-scalar-differs');
  assert.equal(plan.originMap[explanation.operatorId].authored[0].clauseId, 'zero');
  assert.equal(first.diagnosticSelection, 'bounded-observed-clause-failures');
}
