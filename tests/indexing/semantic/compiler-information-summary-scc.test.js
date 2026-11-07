import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { indexSummaryInformationDependencies } from '../../../src/index/semantic/compiler-summary-information-dependencies.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { admitCompilerSummaryManifest, readPersistedCompilerSummaryManifest } from '../../../src/index/semantic/compiler-summary-admission.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';

// UNVALIDATED: scheduling changes no transfer or cross-generation reuse policy.
const ref = localId => ({ partitionId: 'sy1:' + 'a'.repeat(64), localId });
const key = canonicalSemanticJson;
const edge = (from, to) => ({ kind: 'flowsTo', from: ref(from), to: ref(to) });
const model = (seedA = true, seedB = true, alternatives = false) => {
  const summaries = [0, 10, 20, 30].map(base => ({ declaration: ref(base), parameters: [ref(base + 1)],
    returns: [ref(base === 0 ? 13 : base === 10 ? 3 : base + 2)], exceptions: [], effects: [],
    span: [base * 10, base * 10 + 90], complete: true }));
  const calls = [0, 10].map(base => ({ occurrence: ref(base + 5), result: ref(base + 3),
    targets: [ref(base === 0 ? 20 : 30), ...(alternatives && base === 0 ? [ref(30)] : [])],
    arguments: [ref(base + 4)], span: [base * 10 + 10, base * 10 + 20], invocationKind: 'call', hasSpread: false }));
  return [{ summaries, calls, flowEdges: [edge(1, 14), edge(11, 4),
    ...(seedA ? [edge(21, 22)] : []), ...(seedB ? [edge(31, 32)] : [])] }];
};
const payload = result => [...result.functions].map(([id, summary]) => ({ id, dependencies: [...summary.dependencies].sort(),
  complete: summary.complete, converged: summary.converged }));
for (const referenceSchedule of [false, true]) {
  const initial = buildCallDependencySummaries(model(), { referenceSchedule });
  assert.equal(initial.converged, true);
  assert.ok(initial.schedulingComponents.some(component => component.length === 2
    && component.includes(key(ref(0))) && component.includes(key(ref(10)))), 'information cycle joins two call-graph-independent owners');
  assert.deepEqual([...initial.functions.get(key(ref(0))).dependencies], [0]);
  assert.deepEqual([...initial.functions.get(key(ref(10))).dependencies], [0]);
  const removed = buildCallDependencySummaries(model(false, false), { referenceSchedule });
  assert.equal(removed.converged, true);
  assert.ok([...removed.functions.values()].every(summary => summary.dependencies.size === 0),
    'fresh recomputation begins at bottom and cannot retain cyclic support from the prior solve');
  const one = buildCallDependencySummaries(model(false, true, true), { referenceSchedule });
  assert.deepEqual([...one.functions.get(key(ref(10))).dependencies], [0], 'remaining alternative external support survives');
  assert.deepEqual(payload(buildCallDependencySummaries(model(), { referenceSchedule })), payload(initial), 'undo is deterministic');
  const limited = buildCallDependencySummaries(model(), { referenceSchedule, maxIterations: 1 });
  assert.equal(limited.converged, false); assert.equal(limited.budgetIncomplete, true);
  assert.ok(limited.functions.get(key(ref(0))).converged === false, 'information SCC consumes the existing shared round allowance');
}
assert.deepEqual(payload(buildCallDependencySummaries(model())), payload(buildCallDependencySummaries(model(), { referenceSchedule: true })));
let charged = 0;
const bounded = indexSummaryInformationDependencies({ functions: new Map(), calls: [{ ownerId: null }], reverse: new Map(), graph: new Map(),
  key, spend: () => ++charged < 1 });
assert.equal(bounded.complete, false); assert.equal(charged, 1);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-information-scc-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'information.ts': `export {};
    function leaf(value: number) { return value; }
    function enclosing(input: number) {
      function captured() { return shared; }
      const shared = leaf(input);
      return captured();
    }
    const result = enclosing(101);
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const declarationRef = node => {
    const anchor = node?.name || node;
    return anchor ? doc.item.declarations.get(anchor.getStart(doc.sourceFile) + ':' + anchor.end)
      || (doc.ts.isFunctionLike(node) ? doc.expressionFor(node) : null) : null;
  };
  flow.calls = doc.nodes.filter(doc.ts.isCallExpression).map(node => ({ occurrence: doc.expressionFor(node), result: doc.expressionFor(node),
    span: [node.getStart(doc.sourceFile), node.end], targets: [doc.checker.getResolvedSignature(node)?.declaration].map(declarationRef).filter(Boolean),
    invocationKind: 'call', incompleteTargets: false, arguments: node.arguments.map(doc.expressionFor), receiver: null, hasSpread: false }));
  const actual = buildCallDependencySummaries([flow]), reference = buildCallDependencySummaries([flow], { referenceSchedule: true });
  assert.deepEqual(payload(actual), payload(reference), 'real compiler CFG and checker route use the same finite transfers');
  assert.ok(actual.stats.informationDependencyVisits > 0);
  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added];
  await validateSemanticPartitions({ store: fixture.storeFor(partitions), partitions });
  const descriptor = fixture.state.semanticEvidenceArtifacts[0];
  const manifest = JSON.parse(await fs.readFile(path.join(fixture.stagingRoot, descriptor.path), 'utf8'));
  const admitted = await readPersistedCompilerSummaryManifest({ root: fixture.stagingRoot, descriptor,
    registeredInventory: fixture.state.semanticEvidenceArtifacts, expectedIdentity: manifest.identity });
  assert.equal(admitted.admission.status, 'shadow-compatible'); assert.equal(admitted.admission.qualifiesReuse, false);
  assert.ok(manifest.summaries.some(summary => summary.schedulingDependencies.length > 0),
    'actual retained sidecar carries the conservative scheduling dependencies');
  for (const summary of manifest.summaries) for (const dependency of summary.schedulingDependencies) {
    assert.ok(manifest.summaries.some(value => value.declaration === dependency));
  }
  const tampered = structuredClone(manifest); tampered.summaries[0].schedulingDependencies.push(key(ref(9999)));
  assert.equal(admitCompilerSummaryManifest({ manifest: tampered, expectedIdentity: manifest.identity }).status, 'rebuild-required',
    'caller-supplied scheduling dependency tampering cannot pass persisted admission');
  console.log('Existing-channel information SCC scheduling, fresh retraction and retained compiler admission test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
