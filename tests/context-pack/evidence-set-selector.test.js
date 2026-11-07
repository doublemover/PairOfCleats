import assert from 'node:assert/strict';
import { selectContextEvidenceSet } from '../../src/context-pack/evidence-set-selector.js';
import { resolveEvidenceSelectionPolicy } from '../../src/context-pack/evidence-selection-policy.js';
import { createWorkBudget } from '../../src/graph/work-budget.js';

// UNVALIDATED: hand-enumerated controls over the identical immutable pool.
// Synthetic admission below tests the selector; real exact rendering has its
// own source/worker controls in evidence-selection-source.test.js.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['top-k', 'mmr', 'role-coverage', 'facility-location', 'empty-facility', 'relevance-wins', 'ties', 'low-budget', 'zero',
  'missing-roles', 'empty-similarity', 'pair-cap', 'work-cap', 'deadline', 'measurement-cap', 'non-additive-cost',
  'cancellation', 'unknown-failure', 'invalid-policy'].includes(selected));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const source = [{ id: 'a', text: 'alpha shared', roles: ['call'], relevance: 1 },
  { id: 'b', text: 'alpha shared', roles: ['call'], relevance: 0.9 },
  { id: 'c', text: 'beta unique', roles: ['import'], relevance: 0.8 }];
if (selected === 'ties') source.forEach(row => { row.relevance = 1; row.roles = ['call']; row.text = 'same'; });
if (selected === 'missing-roles') source.forEach(row => { row.roles = []; });
if (['empty-similarity', 'empty-facility'].includes(selected)) source.forEach(row => { row.text = '😀!!!'; });
const pool = freeze({ stopReason: null, candidates: source.map((row, rank) => ({ rank, priority: row.roles.includes('call') ? 0 : 3,
  relevance: row.relevance, entry: { id: row.id, excerpt: row.text, roles: row.roles } })),
decisions: source.map(row => ({ id: row.id, status: 'deferred', reason: 'not-selected', roles: row.roles,
  marginalGain: null, tokenDelta: null, sourceIdentity: null })) });
const before = JSON.stringify(pool), controller = new AbortController();
const algorithm = ['mmr', 'role-coverage', 'facility-location'].includes(selected) ? selected
  : selected === 'pair-cap' ? 'mmr' : selected === 'empty-facility' ? 'facility-location' : 'top-k';
const input = { schemaVersion: 1, algorithm, maxSelected: 2, maxMeasurements: 8,
  ...(selected === 'zero' ? { maxSelected: 0 } : {}), ...(selected === 'pair-cap' ? { maxPairwise: 0 } : {}),
  ...(selected === 'work-cap' ? { maxWorkUnits: 1 } : {}), ...(selected === 'measurement-cap' ? { maxMeasurements: 1 } : {}) };
if (selected === 'invalid-policy') {
  for (const bad of [null, [], {}, { ...input, extra: 1 }, { ...input, maxSelected: 17 }, { ...input, lambda: NaN },
    { ...input, maxMeasurements: 0 }, new Proxy(input, { ownKeys() { throw new Error('do not inspect'); } })]) {
    assert.throws(() => resolveEvidenceSelectionPolicy(bad), error => error.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST');
  }
  let called = false; const accessor = { ...input };
  Object.defineProperty(accessor, 'algorithm', { enumerable: true, get() { called = true; } });
  assert.throws(() => resolveEvidenceSelectionPolicy(accessor)); assert.equal(called, false);
} else {
  const policy = resolveEvidenceSelectionPolicy(input);
  let clock = 0;
  const budget = createWorkBudget({ ...policy, checkEvery: 1, now: () => selected === 'deadline' ? clock++ * 10000 : 0 });
  const failure = new Error('original tokenizer failure'), accepted = [];
  const initial = { fits: true, tokens: 10, renderedContext: 'mandatory', publish() {} };
  const measure = async entries => {
    if (selected === 'cancellation') { controller.abort(); return initial; }
    if (selected === 'unknown-failure') throw failure;
    accepted.push(entries.map(row => row.id));
    const tokens = selected === 'non-additive-cost' ? entries.length === 1 ? 12 : 11 : 10 + entries.length * 5;
    return { fits: selected !== 'low-budget' || entries.length <= 1, tokens,
      reason: 'ERR_CONTEXT_PACK_TOKEN_BUDGET', renderedContext: 'mandatory+' + entries.map(row => row.id).join(','), publish() {} };
  };
  const run = () => selectContextEvidenceSet({ pool, policy, budget, initial, measure, signal: controller.signal });
  if (selected === 'cancellation') await assert.rejects(run(), error => error.code === 'ABORT_ERR');
  else if (selected === 'unknown-failure') await assert.rejects(run(), error => error === failure);
  else {
    const result = await run(), ids = result.selected.map(row => row.id);
    if (['mmr', 'role-coverage', 'facility-location'].includes(selected)) assert.deepEqual(ids, ['a', 'c']);
    else if (['zero', 'work-cap', 'deadline', 'measurement-cap', 'empty-facility'].includes(selected)) assert.deepEqual(ids, []);
    else if (['low-budget', 'pair-cap'].includes(selected)) assert.deepEqual(ids, ['a']);
    else assert.deepEqual(ids, ['a', 'b']);
    if (selected === 'relevance-wins') assert.equal(ids.filter(id => ['a', 'b'].includes(id)).length, 2,
      'gold relevance can favor redundant evidence; gold labels never enter selector features');
    if (selected === 'missing-roles') assert.deepEqual(result.coverage.unknownRoleIds, ['a', 'b', 'c']);
    if (selected === 'empty-similarity') assert.deepEqual(result.similarity.emptyIds, ['a', 'b', 'c']);
    if (selected === 'pair-cap') { assert.equal(result.stats.pairwise, 0); assert.equal(result.stopReason, 'maxPairwise'); }
    if (selected === 'work-cap') assert.equal(budget.getUsed(), 1);
    if (selected === 'deadline') assert.equal(result.stopReason, 'maxWallClockMs');
    if (selected === 'measurement-cap') { assert.equal(result.stats.measurements, 1); assert.equal(accepted.length, 0); }
    if (selected === 'non-additive-cost') assert.equal(result.decisions.find(row => row.id === 'b').tokenDelta, -1);
    assert.equal(result.history.length, result.selected.length + 1);
    assert.ok(result.stats.measurements <= policy.maxMeasurements);
  }
}
assert.equal(JSON.stringify(pool), before, 'scores and decisions must not mutate shared candidates');
console.log(`Bounded evidence selector: ${selected}`);
