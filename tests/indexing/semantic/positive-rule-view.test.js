import assert from 'node:assert/strict';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { bootstrapPositiveRuleView, describePositiveRuleView, applyPositiveRuleSupportDelta, positiveRuleSupportId,
  readPositiveRuleModelInput } from '../../../src/index/semantic/views/positive-rules.js';
import { describeOccurrenceRelation } from '../../../src/semantic/relations/factor.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/positive-rule-view/')[1];
assert.ok(['finite-model-oracle', 'producer-only-deltas', 'recursive-retraction', 'contract-and-authority'].includes(mode));
const worldRef = createRepositoryAnswerInput().queryReceipt.world;
const support = (factId, origin = 1) => ({ factId, originId: String(origin).padStart(64, '0'), sourceRef: null });
const facts = (edb, idb) => [...edb.map(id => ({ id, kind: 'edb' })), ...idb.map(id => ({ id, kind: 'idb' }))];
const input = (edb, idb, rules, supports) => ({ worldRef, definition: { schemaVersion: 1, facts: facts(edb, idb), rules }, supports });
const present = view => describePositiveRuleView(view).facts.filter(fact => fact.present).map(fact => fact.id).sort();
if (mode === 'finite-model-oracle') {
  const edb = ['A', 'B', 'C'], idb = ['P', 'Q', 'R'], names = [...edb, ...idb];
  // Independent model-theoretic oracle: intersect every Horn-closed valuation
  // satisfying the fixed EDB, rather than implementing the production fixpoint.
  for (let program = 0; program < 32; program++) {
    const rules = Array.from({ length: 6 }, (_, index) => ({ id: 'r' + index, head: idb[(program + index) % 3],
      body: [...new Set(Array.from({ length: (program + index) % 4 }, (_, offset) => names[(program * 3 + index + offset * 2) % names.length]))] }));
    for (let seed = 0; seed < 8; seed++) {
      const selected = edb.filter((_, index) => seed & (1 << index)), closed = [];
      for (let valuation = 0; valuation < 8; valuation++) {
        const state = new Set([...selected, ...idb.filter((_, index) => valuation & (1 << index))]);
        if (rules.every(rule => !rule.body.every(id => state.has(id)) || state.has(rule.head))) closed.push(state);
      }
      assert.ok(closed.length);
      const expected = names.filter(id => closed.every(state => state.has(id))).sort();
      const view = bootstrapPositiveRuleView(input(edb, idb, rules, selected.map(id => support(id))));
      assert.deepEqual(present(view), expected);
      assert.equal(describePositiveRuleView(view).qualification.programSemantics, 'not-established');
    }
  }
} else if (mode === 'producer-only-deltas') {
  const rules = [{ id: 'p-a', head: 'P', body: ['A'] }, { id: 'p-b', head: 'P', body: ['B'] },
    { id: 'f1', head: 'F1', body: ['P', 'X'] }, { id: 'f2', head: 'F2', body: ['P', 'Y'] }];
  const initial = input(['A', 'B', 'X', 'Y'], ['P', 'F1', 'F2'], rules, [support('A')]), before = bootstrapPositiveRuleView(initial);
  const after = applyPositiveRuleSupportDelta(before, { expectedRootId: before.rootId, removeSupportIds: [positiveRuleSupportId(support('A'))],
    addSupports: [support('B'), support('X'), support('Y')] });
  assert.deepEqual(present(before), ['A', 'P']); assert.deepEqual(present(after.view), ['B', 'F1', 'F2', 'P', 'X', 'Y']);
  assert.equal(after.truthChanges.some(change => change.factId === 'P'), false);
  const changed = after.producerChanges.find(change => change.factId === 'P'); assert.ok(changed); assert.notDeepEqual(changed.before, changed.after);
  const rebuilt = bootstrapPositiveRuleView({ ...initial, supports: [support('B'), support('X'), support('Y')] });
  assert.equal(after.view.rootId, rebuilt.rootId); assert.deepEqual(describePositiveRuleView(after.view), describePositiveRuleView(rebuilt));
  assert.notEqual(after.view.rootId, before.rootId);
} else if (mode === 'recursive-retraction') {
  const initial = input(['S'], ['P', 'Q'], [{ id: 'seed', head: 'P', body: ['S'] }, { id: 'p-q', head: 'Q', body: ['P'] }, { id: 'q-p', head: 'P', body: ['Q'] }],
    [support('S', 1), support('S', 2)]);
  const first = bootstrapPositiveRuleView(initial), second = applyPositiveRuleSupportDelta(first, { expectedRootId: first.rootId,
    removeSupportIds: [positiveRuleSupportId(support('S', 1))], addSupports: [] });
  assert.deepEqual(present(second.view), ['P', 'Q', 'S']); assert.equal(second.truthChanges.length, 0);
  assert.ok(second.producerChanges.some(change => change.factId === 'S'));
  const last = applyPositiveRuleSupportDelta(second.view, { expectedRootId: second.view.rootId,
    removeSupportIds: [positiveRuleSupportId(support('S', 2))], addSupports: [] });
  assert.deepEqual(present(last.view), [], 'a recursive component cannot keep itself true after its last extensional seed disappears');
  assert.deepEqual(present(first), ['P', 'Q', 'S'], 'immutable older views remain unchanged');
  const report = describePositiveRuleView(first), p = report.facts.find(fact => fact.id === 'P');
  assert.equal(p.producers.length, 2); assert.deepEqual(p.firstGroundedWitness.body, ['S']);
  assert.match(report.qualification.provenance, /not-all-proofs/);
  assert.equal(describeOccurrenceRelation(first.relation).capturedDomainComplete, true);
  assert.throws(() => report.facts.push({}), TypeError); assert.throws(() => { readPositiveRuleModelInput(first).supports[0].factId = 'other'; }, TypeError);
} else {
  const value = input(['A'], ['P'], [{ id: 'r', head: 'P', body: ['A'] }], [support('A')]), view = bootstrapPositiveRuleView(value);
  for (const mutate of [v => { v.definition.facts.push({ id: 'A', kind: 'edb' }); }, v => { v.definition.rules[0].head = 'A'; },
    v => { v.definition.rules[0].body = ['missing']; }, v => { v.supports = [support('P')]; }, v => { v.supports.push(support('A')); },
    v => { v.definition.rules[0].evaluate = () => true; }, v => { v.definition.schemaVersion = 0; }]) {
    const invalid = structuredClone(value); mutate(invalid); assert.throws(() => bootstrapPositiveRuleView(invalid));
  }
  assert.throws(() => applyPositiveRuleSupportDelta({ ...view }, { expectedRootId: view.rootId, removeSupportIds: [], addSupports: [] }), { code: 'ERR_POSITIVE_RULE_MODEL_HANDLE' });
  assert.throws(() => applyPositiveRuleSupportDelta(view, { expectedRootId: '0'.repeat(64), removeSupportIds: [], addSupports: [] }), { code: 'ERR_POSITIVE_RULE_MODEL_BASE_MISMATCH' });
  assert.throws(() => applyPositiveRuleSupportDelta(view, { expectedRootId: view.rootId, removeSupportIds: ['0'.repeat(64)], addSupports: [] }));
  let reads = 0;
  assert.throws(() => bootstrapPositiveRuleView({ ...value, get definition() { reads++; return value.definition; } })); assert.equal(reads, 0);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => bootstrapPositiveRuleView(value, { signal: controller.signal }), { name: 'AbortError' }); assert.deepEqual(present(view), ['A', 'P']);
}
console.log('Finite positive-rule views retain exact membership and changing direct support independently.');
