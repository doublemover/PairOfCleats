import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { shadowQueryRoute, simulateShadowAllocation, SHADOW_ROUTING_VERSION } from '../../../src/retrieval/evaluation/shadow-routing.js';
import { evaluateDatasetShadowRouting } from '../../../tools/eval/shadow-routing.js';

const hash = text => createHash('sha256').update(text).digest('hex');
for (const [query, label] of [['src/retrieval/query.js', 'symbol-or-path'], ['readFile', 'symbol-or-path'],
  ['why does this function fail', 'natural-language'], ['雪 😀', 'unknown']]) {
  const report = shadowQueryRoute({ query });
  assert.equal(report.label, label); assert.equal(report.authoritative, false); assert.equal(report.executionChanged, false);
  assert.equal(report.abstained, label === 'unknown'); assert.equal(JSON.stringify(report).includes(query), false);
}
const explicit = shadowQueryRoute({ query: 'alpha OR "quoted phrase"',
  queryAst: { type: 'or', left: { type: 'term' }, right: { type: 'phrase' } } });
assert.equal(explicit.label, 'explicit-boolean-or-phrase'); assert.match(explicit.proposal, /explicit-constraints/);
assert.equal(shadowQueryRoute({ query: 'find OR documents about x' }).abstained, true,
  'explicit-looking syntax without canonical AST evidence cannot become fuzzy natural-language intent');
assert.equal(shadowQueryRoute({ query: 'binding target', requestKind: 'semantic-find' }).label, 'semantic-fact');
const cyclic = { type: 'not' }; cyclic.child = cyclic;
assert.equal(shadowQueryRoute({ query: 'x', queryAst: cyclic }).complete, false);
let accessorCalls = 0;
const accessor = Object.defineProperty({}, 'type', { get() { accessorCalls++; return 'term'; } });
assert.equal(shadowQueryRoute({ query: 'x', queryAst: accessor }).complete, false); assert.equal(accessorCalls, 0);
for (const key of ['type', 'grouped', 'implicit', 'left', 'right', 'child']) {
  const own = { type: 'term' }; Object.defineProperty(own, key, { get() { accessorCalls++; return key === 'type' ? 'phrase' : true; } });
  assert.equal(shadowQueryRoute({ query: 'identifier', queryAst: own }).complete, false);
  const inherited = { type: 'term' }; delete inherited[key];
  Object.setPrototypeOf(inherited, { get [key]() { accessorCalls++; return key === 'type' ? 'phrase' : true; } });
  assert.equal(shadowQueryRoute({ query: 'identifier', queryAst: inherited }).complete, false);
}
assert.equal(accessorCalls, 0, 'own and inherited AST getters cannot become feature evidence');
for (const queryAst of [{}, { type: 'unknown' }, { type: {} }, { type: 'term', grouped: 'yes' },
  { type: 'and', implicit: 1 }, [], { type: 'not', child: false }]) {
  const malformed = shadowQueryRoute({ query: 'identifier', queryAst });
  assert.equal(malformed.complete, false); assert.equal(malformed.proposal, null); assert.equal(malformed.metrics, null);
}
const fields = new Map(), originalAst = { type: 'term' };
const noReread = new Proxy(originalAst, {
  get() { assert.fail('AST property getters are not original shadow feature evidence'); },
  getOwnPropertyDescriptor(target, key) {
    fields.set(key, (fields.get(key) || 0) + 1);
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (key === 'grouped') target.type = 'phrase';
    return descriptor;
  }
});
assert.equal(shadowQueryRoute({ query: 'identifier', queryAst: noReread }).label, 'symbol-or-path');
assert([...fields.values()].every(count => count === 1), 'original supported AST fields are captured once before feature classification');
for (const primary of [undefined, null, false, 0, '']) {
  let observed = Symbol('no original AST inspection failure');
  try { shadowQueryRoute({ query: 'identifier', queryAst: new Proxy({ type: 'term' }, { getOwnPropertyDescriptor() { throw primary; } }) }); }
  catch (error) { observed = error; }
  assert.equal(observed, primary, 'original descriptor failure cannot fabricate feature completion');
}
const duringCapture = new AbortController();
const cancelledAst = new Proxy({ type: 'term' }, { getOwnPropertyDescriptor(target, key) { duringCapture.abort(); return Reflect.getOwnPropertyDescriptor(target, key); } });
assert.equal(shadowQueryRoute({ query: 'identifier', queryAst: cancelledAst, signal: duringCapture.signal }).reason, 'cancelled');
assert.equal(shadowQueryRoute({ query: 'x'.repeat(4097) }).complete, false);
const controller = new AbortController(); controller.abort();
assert.equal(shadowQueryRoute({ query: 'x', signal: controller.signal }).reason, 'cancelled');

const query = 'why does this function fail', workspaceKey = hash('workspace'), queryKey = hash('query-and-filters');
const generationA = hash('generation A'), generationB = hash('generation B');
const candidates = (repo, count, dense) => Array.from({ length: count }, (_, index) => ({
  key: hash(`${repo}:${index}`), sourceRank: index + 1, dense, sparse: !dense, relevance: dense ? 1 : index === 0 ? 4 : 0
}));
const snapshot = { schemaVersion: SHADOW_ROUTING_VERSION, workspaceKey, queryKey, queryTextDigest: hash(query),
  cohorts: [{ id: 'compatible-model-A', signature: hash('compatibility A'), repos: [
    { repoId: 'A', generation: generationA, candidates: candidates('A', 64, true) },
    { repoId: 'B', generation: generationB, candidates: candidates('B', 8, false) }
  ] }] };
const input = { snapshot, expectedWorkspaceKey: workspaceKey, expectedQueryKey: queryKey,
  expectedGenerations: { A: generationA, B: generationB }, queryClass: 'natural-language', budget: 8, floor: 1 };
const original = structuredClone(snapshot), receipt = simulateShadowAllocation(input);
assert.equal(receipt.complete, true); assert.equal(receipt.authoritative, false); assert.equal(receipt.promotion, 'none');
assert.equal(receipt.work.savedCandidates, 72); assert.equal(receipt.target, 8);
const repos = receipt.cohorts[0].repos;
const abstained = simulateShadowAllocation({ ...input, queryClass: 'unknown' });
assert(abstained.cohorts.flatMap(cohort => cohort.repos).every(repo => repo.fixedQuota === repo.proposedQuota),
  'abstention retains fixed allocation rather than inferring effort from out-of-domain features');
assert.equal(repos.reduce((sum, row) => sum + row.proposedQuota, 0), 8);
assert(repos.every(row => row.proposedQuota >= 1));
for (const row of repos) assert.deepEqual(row.selectedKeys, snapshot.cohorts[0].repos.find(repo => repo.repoId === row.repoId)
  .candidates.slice(0, row.proposedQuota).map(candidate => candidate.key));
assert.deepEqual(snapshot, original, 'allocation never mutates authoritative candidate pools');
const reverse = structuredClone(snapshot); reverse.cohorts[0].repos.reverse();
assert.deepEqual(simulateShadowAllocation({ ...input, snapshot: reverse }), receipt, 'input order cannot choose allocation ties');
const labelsChanged = structuredClone(snapshot);
for (const repo of labelsChanged.cohorts[0].repos) for (const row of repo.candidates) row.relevance = 4 - row.relevance;
assert.deepEqual(simulateShadowAllocation({ ...input, snapshot: labelsChanged }).cohorts, receipt.cohorts,
  'judgments score frozen proposals and never select their quotas');
for (const change of [{ expectedWorkspaceKey: hash('stale') }, { expectedQueryKey: hash('other filters') },
  { expectedGenerations: { A: generationA, B: hash('stale') } }, { budget: 1 }, { signal: controller.signal }]) {
  const partial = simulateShadowAllocation({ ...input, ...change });
  assert.equal(partial.complete, false); assert.equal(partial.metrics, null); assert.equal(partial.proposal, null);
}
const unknown = structuredClone(snapshot); unknown.cohorts[0].repos[0].candidates[0].relevance = null;
const unknownReport = simulateShadowAllocation({ ...input, snapshot: unknown });
assert.equal(unknownReport.metrics.proposed.gradedGain, null); assert.equal(unknownReport.metrics.proposed.relevantRepositoryCoverage, null);
const empty = simulateShadowAllocation({ ...input, snapshot: { ...snapshot, cohorts: [] } });
assert.equal(empty.complete, true); assert.equal(empty.target, 0); assert.equal(empty.metrics.proposed.relevantRepositoryCoverage, null);
const datasetCase = { query, shadowRouting: input };
const dataset = evaluateDatasetShadowRouting({ cases: [datasetCase] });
assert.equal(dataset.currentSearchEvidence, false); assert.equal(dataset.reports[0].allocation.complete, true);
const stale = structuredClone(datasetCase); stale.shadowRouting.snapshot.queryTextDigest = hash('different text');
assert.equal(evaluateDatasetShadowRouting({ cases: [stale] }).complete, false, 'shadow refusal cannot abort the existing primary evaluation');
console.log('Non-authoritative shadow taxonomy, frozen generation-qualified allocation and existing-report isolation assertions complete');
