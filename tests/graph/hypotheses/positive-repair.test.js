import assert from 'node:assert/strict';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { bootstrapPositiveRuleView, positiveRuleSupportId } from '../../../src/index/semantic/views/positive-rules.js';
import { createPositiveRuleRepairProblem, describePositiveRuleRepair, replayPositiveRuleRepair,
  POSITIVE_REPAIR_RETENTION_BYTES } from '../../../src/graph/hypotheses/positive-repair.js';
import { createPositiveRuleRepairService } from '../../../src/graph/hypotheses/repair-search.js';
import { createSemanticContinuationBudget } from '../../../src/semantic/continuation-budget.js';
import { publishSemanticPage } from '../../../src/semantic/page-publication.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('graph/hypotheses/positive-repair/')[1];
assert.ok(['support-changing-repair-oracle', 'preservation-and-cost', 'private-continuations', 'strict-domain-and-cancellation'].includes(mode));
const worldRef = createRepositoryAnswerInput().queryReceipt.world;
const support = factId => ({ factId, originId: '1'.repeat(64), sourceRef: null });
const names = ['A', 'B', 'X', 'Y', 'P', 'F1', 'F2'];
const rules = [{ id: 'p-a', head: 'P', body: ['A'] }, { id: 'p-b', head: 'P', body: ['B'] },
  { id: 'f1', head: 'F1', body: ['P', 'X'] }, { id: 'f2', head: 'F2', body: ['P', 'Y'] }];
const baseline = bootstrapPositiveRuleView({ worldRef, definition: { schemaVersion: 1,
  facts: names.map((id, index) => ({ id, kind: index < 4 ? 'edb' : 'idb' })), rules }, supports: [support('A')] });
const request = preservedFacts => ({ schemaVersion: 1, expectedBaselineRootId: baseline.rootId,
  context: { investigationId: 'rollback-example', taskRevision: 'task-1', branchId: 'branch-1', assumptionSetId: 'assumptions-1' },
  proposedEdits: [{ id: 'a-remove-a', kind: 'remove-support', supportId: positiveRuleSupportId(support('A')), revertAllowed: true, userCost: 1 },
    ...['B', 'X', 'Y'].map(id => ({ id: id.toLowerCase() + '-add-' + id.toLowerCase(), kind: 'add-support', support: support(id),
      revertAllowed: true, userCost: id === 'B' ? 100 : 2 }))], forbiddenFacts: ['F1', 'F2'], preservedFacts,
  objective: 'revert-cardinality-then-user-cost-then-stable-edit-ids' });
const make = (preserve = []) => createPositiveRuleRepairProblem({ baseline, request: request(preserve) });
const page = (service, problem, cursor = null, limits = {}, options = {}) => service({ problem,
  request: { problemId: problem.problemId, cursor, limits: { candidates: 256, ...limits } }, ...options });
const finish = (service, problem) => {
  let result = page(service, problem); let pages = 1;
  while (result.cursor) { assert.ok(pages++ < 20); result = page(service, problem, result.cursor); } return result;
};
// Independent model-theoretic oracle: enumerate every IDB valuation, retain
// those satisfying the Horn implications, and intersect them. No production
// replay, delta owner or fixpoint routine supplies expected candidate outcomes.
const oracle = (mask, preserve = []) => {
  const edb = new Set([...(mask & 1 ? ['A'] : []), ...(mask & 2 ? [] : ['B']), ...(mask & 4 ? [] : ['X']), ...(mask & 8 ? [] : ['Y'])]);
  const closed = [];
  for (let bits = 0; bits < 8; bits++) {
    const state = new Set([...edb, ...names.slice(4).filter((_, index) => bits & (1 << index))]);
    if (rules.every(rule => !rule.body.every(id => state.has(id)) || state.has(rule.head))) closed.push(state);
  }
  const actual = new Set(names.filter(id => closed.every(state => state.has(id))));
  return { actual, valid: !actual.has('F1') && !actual.has('F2') && preserve.every(id => actual.has(id)) };
};

if (mode === 'support-changing-repair-oracle' || mode === 'preservation-and-cost') {
  const preserve = mode === 'preservation-and-cost' ? ['P'] : [], problem = make(preserve), description = describePositiveRuleRepair(problem);
  assert.equal(description.truthChangedFacts.includes('P'), false); assert.equal(description.producerChangedFacts.includes('P'), true);
  assert.equal(description.candidateCount, 16);
  const expected = [];
  for (let mask = 0; mask < 16; mask++) {
    const ids = description.admissibleRevertIds.filter((_, index) => mask & (1 << index));
    const checked = replayPositiveRuleRepair(problem, { problemId: problem.problemId, revertEditIds: ids });
    const reference = oracle(mask, preserve);
    assert.equal(checked.valid, reference.valid, 'all sixteen declared reversions require independent complete replay');
    for (const check of checked.checks) assert.equal(check.actualPresent, reference.actual.has(check.factId));
    if (reference.valid) expected.push({ ids, cost: ids.reduce((sum, id) => sum + request(preserve).proposedEdits.find(edit => edit.id === id).userCost, 0) });
  }
  expected.sort((a, b) => a.ids.length - b.ids.length || a.cost - b.cost || (a.ids.join(',') < b.ids.join(',') ? -1 : 1));
  const service = createPositiveRuleRepairService(), result = finish(service, problem);
  assert.equal(result.status, 'optimal-in-declared-domain'); assert.equal(result.checkedCandidates, 16);
  assert.equal(result.feasibleCandidates, expected.length); assert.deepEqual(result.candidate.revertEditIds, expected[0].ids);
  assert.equal(result.candidate.score.cardinality, preserve.length ? 2 : 1);
  assert.deepEqual(result.candidate.revertEditIds, preserve.length ? ['x-add-x', 'y-add-y'] : ['b-add-b']);
  assert.equal(result.execution, 'none'); assert.equal(result.programSemantics, 'not-established');
  assert.equal(result.candidate.optimality, 'not-assessed', 'candidate replay and complete-search optimality are separate receipts');
  assert.equal(result.work.replays, 16); assert.ok(result.work.preparation.proposedReplay.ruleChecks > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) + 1 <= result.work.serializedByteUpperBound);
  if (preserve.length) {
    const costRequest = request([]); costRequest.forbiddenFacts = ['F1'];
    const costProblem = createPositiveRuleRepairProblem({ baseline, request: costRequest }), cheaper = finish(service, costProblem);
    assert.deepEqual(cheaper.candidate.revertEditIds, ['x-add-x'], 'user cost breaks equal-cardinality repair ties');
    assert.notEqual(costProblem.problemId, problem.problemId);
    const inadmissible = request([]); inadmissible.proposedEdits.forEach(edit => { edit.revertAllowed = false; });
    const impossible = finish(service, createPositiveRuleRepairProblem({ baseline, request: inadmissible }));
    assert.equal(impossible.status, 'infeasible-in-declared-domain'); assert.equal(impossible.checkedCandidates, 1); assert.equal(impossible.candidate, null);
  }
  service.dispose();
} else if (mode === 'private-continuations') {
  const problem = make(), service = createPositiveRuleRepairService();
  const initial = page(service, problem, null, { candidates: 3 }, { deferPublication: true });
  assert.equal(initial.status, 'partial'); assert.deepEqual(initial.candidate.revertEditIds, ['b-add-b']);
  assert.equal(initial.optimality, 'unresolved'); assert.equal(service.continuationStats().cursors, 0);
  assert.throws(() => page(service, problem, initial.cursor), { code: 'ERR_POSITIVE_RULE_REPAIR_CURSOR_EXPIRED' });
  publishSemanticPage(initial); const next = page(service, problem, initial.cursor, { candidates: 1 });
  const replay = page(service, problem, initial.cursor, { candidates: 1 });
  assert.equal(next.checkedCandidates, replay.checkedCandidates); assert.deepEqual(next.candidate.revertEditIds, replay.candidate.revertEditIds);
  assert.equal(next.checkedCandidates, initial.checkedCandidates + 1, 'cursor replay forks the checked prefix instead of mutating it');
  assert.throws(() => page(service, make(['P']), initial.cursor), { code: 'ERR_POSITIVE_RULE_REPAIR_CURSOR_EXPIRED' });
  service.dispose(); assert.equal(service.continuationStats().retainedBytes, 0);
  const budget = createSemanticContinuationBudget({ maxBytes: POSITIVE_REPAIR_RETENTION_BYTES + 16384 });
  const bounded = createPositiveRuleRepairService({ retentionBudget: budget });
  const first = page(bounded, problem, null, { candidates: 1 }), second = page(bounded, problem, first.cursor, { candidates: 1 });
  assert.ok(second.cursor); assert.throws(() => page(bounded, problem, first.cursor), { code: 'ERR_POSITIVE_RULE_REPAIR_CURSOR_EXPIRED' });
  assert.equal(bounded.continuationStats().cursors, 1); bounded.dispose(); assert.equal(budget.stats().retainedBytes, 0);
  const stagedService = createPositiveRuleRepairService(), staged = page(stagedService, problem, null, { candidates: 1 }, { deferPublication: true });
  stagedService.dispose(); assert.throws(() => publishSemanticPage(staged), { code: 'ERR_POSITIVE_RULE_REPAIR_CURSOR_EXPIRED' });
} else {
  const problem = make(), service = createPositiveRuleRepairService();
  for (const mutate of [value => { value.expectedBaselineRootId = '0'.repeat(64); }, value => { value.forbiddenFacts = ['missing']; },
    value => { value.preservedFacts = ['F1']; }, value => { value.proposedEdits[1].id = value.proposedEdits[0].id; },
    value => { value.proposedEdits[0].supportId = '0'.repeat(64); }, value => { value.proposedEdits[1].userCost = -1; },
    value => { value.proposedEdits[1].support = support('A'); }, value => { value.proposedEdits[1].support.factId = 'P'; },
    value => { value.proposedEdits[1].evaluate = () => true; }]) {
    const invalid = request([]); mutate(invalid); assert.throws(() => createPositiveRuleRepairProblem({ baseline, request: invalid }));
  }
  assert.throws(() => describePositiveRuleRepair({ ...problem }), { code: 'ERR_POSITIVE_RULE_REPAIR_HANDLE' });
  assert.throws(() => replayPositiveRuleRepair(problem, { problemId: make(['P']).problemId, revertEditIds: [] }), { code: 'ERR_POSITIVE_RULE_REPAIR_BASE_MISMATCH' });
  assert.throws(() => replayPositiveRuleRepair(problem, { problemId: problem.problemId, revertEditIds: ['not-an-action'] }));
  assert.throws(() => page(service, problem, null, { bytes: 1024 }), { code: 'ERR_POSITIVE_RULE_REPAIR_OUTPUT_LIMIT' });
  assert.equal(service.continuationStats().cursors, 0);
  let getterReads = 0;
  assert.throws(() => createPositiveRuleRepairProblem({ baseline, request: { ...request([]), get context() { getterReads++; return {}; } } }));
  assert.equal(getterReads, 0);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => page(service, problem, null, {}, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(service.continuationStats().retainedBytes, 0);
  assert.throws(() => describePositiveRuleRepair(problem).preservedFacts.push('P'), TypeError); service.dispose();
}
console.log('Finite support-aware repair replays every checked candidate and separates validity from bounded-domain optimality.');
