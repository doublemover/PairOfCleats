import assert from 'node:assert/strict';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { createSummaryComponentWorklist } from '../../../src/index/semantic/compiler-summary-worklist.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

// UNVALIDATED: deterministic scheduler counters and identical transfer semantics.
const ref = localId => ({ partitionId: 'sy1:' + 'a'.repeat(64), localId });
const key = canonicalSemanticJson;
const edge = (from, to) => ({ kind: 'flowsTo', from: ref(from), to: ref(to) });
const project = result => ({ converged: result.converged, iterations: result.iterations,
  reasons: result.analysisReasons, ownership: result.ownershipReasons,
  functions: [...result.functions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, summary]) => ({ id,
    dependencies: [...summary.dependencies].sort(), exceptions: [...summary.exceptionDependencies].sort(),
    effects: [...summary.effectDependencies.values()].map(effect => ({ parameter: effect.parameter, path: effect.path,
      refs: effect.refs.map(key).sort(), dependencies: [...effect.dependencies].sort() }))
      .sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0),
    complete: summary.complete, converged: summary.converged, widened: summary.widened })) });
const make = (count, { ring = false, effects = false, unknown = false, rest = false } = {}) => {
  const documents = [];
  for (let index = 0; index < count; index++) {
    const base = index * 20, tail = index === count - 1;
    const summary = { declaration: ref(base), parameters: [ref(base + 1)], returns: [ref(base + 2)],
      exceptions: effects ? [ref(base + 5)] : [], effects: effects && tail ? [{ parameter: 0, path: ['value'], ref: ref(base + 6) }] : [],
      span: [index * 100, index * 100 + 90], complete: true, restIndex: rest ? 0 : -1 };
    const call = { occurrence: ref(base + 4), result: ref(base + 3), targets: [ref(((index + 1) % count) * 20)],
      arguments: [ref(base + 1), ...(rest ? [ref(base + 8)] : [])], receiver: null,
      span: [index * 100 + 10, index * 100 + 20], invocationKind: 'call', hasSpread: false };
    const calls = index < count - 1 || ring ? [call] : [];
    if (unknown && index === 0) calls.push({ ...call, occurrence: ref(base + 9), result: ref(base + 10),
      targets: [ref(99999)], span: [index * 100 + 30, index * 100 + 40] });
    documents.push({ summaries: [summary], calls,
      aliases: effects ? [{ ref: ref(base + 1), root: ref(base + 1), path: [] }] : [],
      callEffects: effects ? [{ result: call.result, reads: [{ root: ref(base + 1), path: ['value'], ref: ref(base + 7) }],
        exceptionTargets: [], exceptionEscapes: true }] : [],
      flowEdges: [edge(base + 3, base + 2), ...(tail ? [edge(base + 1, base + 2)] : []),
        ...(effects ? [edge(base + 7, base + 2), ...(tail ? [edge(base + 1, base + 5), edge(base + 1, base + 6)] : [])] : [])] });
  }
  return documents;
};
for (const [count, options] of [[40, {}], [8, { ring: true }], [8, { ring: true, effects: true }],
  [8, { ring: true, effects: true, unknown: true }], [8, { ring: true, rest: true }], [64, { ring: true, effects: true }]]) {
  const documents = make(count, options), fast = buildCallDependencySummaries(documents);
  const reference = buildCallDependencySummaries(documents, { referenceSchedule: true });
  assert.deepEqual(project(fast), project(reference), 'worklist and scan select identical transfers, metadata and bounded outcomes');
  assert.equal(fast.stats.derives, reference.stats.derives); assert.equal(fast.stats.callInstantiations, reference.stats.callInstantiations);
  assert.ok(fast.stats.componentMembershipChecks <= reference.stats.componentMembershipChecks);
  assert.ok(fast.stats.cachedMemberships <= 65536);
  assert.deepEqual(project(buildCallDependencySummaries([...documents].reverse())), project(fast), 'source-qualified document order is deterministic');
}
for (const maxIterations of [0, 1]) {
  const documents = make(8, { ring: true, effects: true });
  assert.deepEqual(project(buildCallDependencySummaries(documents, { maxIterations })),
    project(buildCallDependencySummaries(documents, { maxIterations, referenceSchedule: true })));
  assert.equal(buildCallDependencySummaries(documents, { maxIterations }).converged, false);
}

// A prospective existing-channel write orders an information dependency even
// when its negative reverse lookup had no predecessor before instantiation.
const functions = [0, 10, 20].map(base => ({ declaration: ref(base), parameters: [ref(base + 1)],
  returns: [ref(base === 0 ? 13 : base + 2)], exceptions: [], effects: [], span: [base * 10, base * 10 + 90], complete: true }));
const information = [{ summaries: functions, calls: [{ occurrence: ref(15), result: ref(13), targets: [ref(20)],
  arguments: [ref(14)], span: [110, 120], invocationKind: 'call', hasSpread: false }],
flowEdges: [edge(1, 14), edge(13, 12), edge(21, 22)] }];
for (const referenceSchedule of [false, true]) {
  const result = buildCallDependencySummaries(information, { referenceSchedule });
  assert.equal(result.converged, true); assert.equal(result.functions.get(key(ref(0))).converged, true);
  assert.deepEqual([...result.functions.get(key(ref(0))).dependencies], [0]);
  assert.deepEqual(result.analysisReasons, []);
  assert.ok(result.informationSchedulingComplete); assert.ok(result.stats.informationDependencyEdges > 0);
}

const drive = reference => {
  const component = Array.from({ length: 64 }, (_, index) => 'node:' + index), dirty = new Set(component);
  const selector = createSummaryComponentWorklist({ component, dirty, roundLimit: 3, reference }), visited = [];
  let invalidate = true, id;
  while ((id = selector.next()) !== null) {
    dirty.delete(id); visited.push(id);
    if (id === component.at(-1) && invalidate) { invalidate = false; dirty.add(component[0]); selector.mark(component[0]); }
  }
  return { ...selector.snapshot(), visited };
};
const fast = drive(false), reference = drive(true);
assert.deepEqual(fast.visited, reference.visited); assert.equal(fast.rounds, reference.rounds);
assert.ok(fast.checks < reference.checks, 'sparse next round selects dirty members without scanning unchanged members');
const duplicate = make(2); duplicate[1].summaries[0].declaration = duplicate[0].summaries[0].declaration;
assert.throws(() => buildCallDependencySummaries(duplicate), { code: 'ERR_COMPILER_SUMMARY_IDENTITY' });
const controller = new AbortController(); controller.abort();
assert.throws(() => buildCallDependencySummaries(make(2), { signal: controller.signal }), { code: 'ABORT_ERR' });
console.log('Fresh summary worklist preserves scan semantics and schedules existing information channels.');
