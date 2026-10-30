import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { COMPILER_SUMMARY_MANIFEST_VERSION, COMPILER_SUMMARY_MANIFEST_MAX_BYTES,
  joinMayDependencies } from '../../../src/index/semantic/compiler-summary-manifest.js';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';

// UNVALIDATED: finite-domain laws, existing fresh solver, actual CFG/retained consumer.
const sorted = set => [...set].sort((a, b) => a - b);
const join = (left, right) => { const result = new Set(left); joinMayDependencies(result, right); return result; };
const values = Array.from({ length: 8 }, (_, bits) => new Set([0, 1, 2].filter(value => bits & (1 << value))));
for (const a of values) for (const b of values) {
  assert.deepEqual(sorted(join(a, b)), sorted(join(b, a)), 'join is commutative');
  assert.deepEqual(sorted(join(a, a)), sorted(a), 'join is idempotent');
  assert.ok([...a].every(value => join(a, b).has(value)), 'join is inflationary');
  for (const c of values) assert.deepEqual(sorted(join(join(a, b), c)), sorted(join(a, join(b, c))), 'join is associative');
}
const ref = localId => ({ partitionId: 'sy1:' + 'a'.repeat(64), localId });
const key = canonicalSemanticJson, identity = { producer: 'fixture', contextKey: 'b'.repeat(64), broadInputs: ['c'.repeat(64)] };
const channel = (from, to) => ({ kind: 'flowsTo', from: ref(from), to: ref(to) });
const make = (seed = true, unknown = false) => {
  const summaries = [0, 10].map(base => ({ declaration: ref(base), parameters: [ref(base + 1)],
    returns: [ref(base + 2)], exceptions: [], effects: [], span: [base * 10, base * 10 + 90], complete: true }));
  const calls = [0, 10].map(base => ({ occurrence: ref(base + 4), result: ref(base + 3),
    targets: [ref(base === 0 ? 10 : 0)], arguments: [ref(base + 1)],
    span: [base * 10 + 10, base * 10 + 20], invocationKind: 'call', hasSpread: false }));
  if (unknown) calls.push({ ...calls[0], occurrence: ref(24), result: ref(25), targets: [ref(99)], span: [30, 40] });
  const flowEdges = [channel(3, 2), channel(13, 12), ...(seed ? [channel(1, 2)] : [])];
  return [{ summaries, calls, flowEdges, item: { source: { sourceUnitId: 'su1:' + 'd'.repeat(64),
    byteHash: 'e'.repeat(64), path: 'cycle.ts' } }, partition: { partitionId: 'sa1:' + 'f'.repeat(64),
    canonicalHash: semanticHash('fixture.flow.v1', flowEdges) }, policy: { enrichment: { maxSccIterations: 12, fieldPathDepth: 2 } } }];
};
const payloads = result => [...result.functions].map(([id, summary]) => ({ id, dependencies: sorted(summary.dependencies),
  exceptionDependencies: sorted(summary.exceptionDependencies), complete: summary.complete, converged: summary.converged }));
const baseline = buildCallDependencySummaries(make());
const captured = buildCallDependencySummaries(make(), { manifestIdentity: identity });
assert.deepEqual(payloads(captured), payloads(baseline));
const manifest = captured.shadowManifest;
assert.equal(manifest.schemaVersion, COMPILER_SUMMARY_MANIFEST_VERSION); assert.equal(manifest.status, 'recorded');
assert.equal(manifest.qualifiesReuse, false); assert.equal(manifest.reuseGuard, 'full-group-rebuild-required');
assert.ok(Object.isFrozen(manifest)); assert.ok(Object.isFrozen(manifest.summaries[0].reads));
assert.ok(manifest.summaries.some(summary => summary.reads.some(read => read.predecessors.length === 0)),
  'leaf/negative node lookups remain explicit read observations');
assert.ok(manifest.summaries.some(summary => summary.contributions.length > 0), 'generated channels retain their individual call owner');
for (const summary of manifest.summaries) {
  assert.ok(summary.callees.every(callee => callee.status === 'available'));
  assert.ok(summary.contributions.every(row => row.callSite !== summary.declaration));
  assert.ok(!Object.hasOwn(summary.payload, 'callSite'), 'callee payload is separate from caller instantiation');
}
const missing = buildCallDependencySummaries(make(true, true), { manifestIdentity: identity });
assert.ok(missing.shadowManifest.summaries.some(summary => summary.callees.some(callee => callee.ref === key(ref(99)) && callee.status === 'missing')));
assert.ok([...missing.functions.values()].every(summary => summary.complete === false));
const removed = buildCallDependencySummaries(make(false), { manifestIdentity: identity });
assert.equal(removed.converged, true);
assert.ok([...removed.functions.values()].every(summary => summary.dependencies.size === 0), 'fresh SCC recomputation retracts the sole seed instead of retaining cyclic reinforcement');
assert.notEqual(canonicalSemanticJson(removed.shadowManifest), canonicalSemanticJson(manifest));
assert.deepEqual(buildCallDependencySummaries(make(), { manifestIdentity: identity }).shadowManifest, manifest, 'undo restores the same shadow product');
for (const manifestLimits of [{ maxEntries: 1 }, { maxBytes: 1024 }]) {
  const bounded = buildCallDependencySummaries(make(), { manifestIdentity: identity, manifestLimits });
  assert.equal(bounded.shadowManifest.status, 'unavailable'); assert.equal(bounded.shadowManifest.qualifiesReuse, false);
  assert.deepEqual(bounded.shadowManifest.summaries, []); assert.deepEqual(payloads(bounded), payloads(baseline));
}
const zero = buildCallDependencySummaries(make(), { maxIterations: 0, manifestIdentity: identity });
assert.equal(zero.converged, false); assert.equal(zero.shadowManifest.converged, false);
assert.ok(zero.shadowManifest.summaries.every(summary => !summary.payload.converged));

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-summary-shadow-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'summary.ts': `export {};
    function leaf(value: number) { return value; }
    function forward(value: number) { return leaf(value); }
    const first = forward(101), second = forward(202);
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const { ts, checker, sourceFile, nodes, expressionFor } = doc;
  const declarationRef = node => {
    const anchor = node?.name || node;
    return anchor ? doc.item.declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end)
      || (ts.isFunctionLike(node) ? expressionFor(node) : null) : null;
  };
  flow.calls = nodes.filter(ts.isCallExpression).map(node => ({ occurrence: expressionFor(node), result: expressionFor(node),
    span: [node.getStart(sourceFile), node.end], targets: [checker.getResolvedSignature(node)?.declaration].map(declarationRef).filter(Boolean),
    incompleteTargets: false, invocationKind: 'call', receiver: null, arguments: node.arguments.map(expressionFor), hasSpread: false }));
  assert.ok(flow.calls.every(call => call.targets.length === 1));
  const expected = buildCallDependencySummaries([flow]);
  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 1);
  const descriptor = fixture.state.semanticEvidenceArtifacts[0], filename = path.join(fixture.stagingRoot, descriptor.path);
  const bytes = await fs.readFile(filename), report = JSON.parse(bytes.toString('utf8'));
  assert.equal(bytes.length, descriptor.bytes); assert.ok(bytes.length <= COMPILER_SUMMARY_MANIFEST_MAX_BYTES);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.hash);
  assert.equal(report.status, 'recorded'); assert.equal(report.mode, 'shadow'); assert.equal(report.qualifiesReuse, false);
  assert.equal(report.identity.producer.callFlow, SEMANTIC_ANALYSIS_VERSIONS.callFlow);
  assert.deepEqual(report.identity.inputPartitionHashes, [flow.partition.canonicalHash]);
  assert.equal(report.identity.compilerContext.contextKey, fixture.group.context.contextKey);
  for (const summary of report.summaries) {
    assert.equal(summary.localInputs.sourceUnitId, doc.item.source.sourceUnitId);
    assert.equal(summary.localInputs.sourceHash, doc.item.source.byteHash);
    assert.equal(summary.localInputs.flowHash, flow.partition.canonicalHash);
    assert.deepEqual(summary.payload.dependencies, sorted(expected.functions.get(summary.declaration).dependencies));
    assert.equal(summary.payload.complete, expected.functions.get(summary.declaration).complete);
  }
  const evidence = [];
  for (const partition of added) for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) if (row.kind === 'evidence') evidence.push(row);
  assert.ok(evidence.some(row => row.data.artifactRef === descriptor.path), 'actual canonical evidence points to the registered manifest');
  await collectCompilerCrossFileFlow(fixture);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 1, 'same input registers no duplicate immutable sidecar');
  const originalContext = fixture.group.context;
  fixture.group.context = { ...originalContext, contextKey: '9'.repeat(64) };
  const changed = await collectCompilerCrossFileFlow(fixture);
  assert.notEqual(changed[0].partitionId, added[0].partitionId, 'broad compiler context still invalidates the whole-group analysis');
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 2);
  fixture.group.context = originalContext;
  const controller = new AbortController(); controller.abort();
  const current = fixture.state.semanticFactsByFile.get('summary.ts');
  await assert.rejects(collectCompilerCrossFileFlow({ ...fixture, signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.strictEqual(fixture.state.semanticFactsByFile.get('summary.ts'), current);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 2);
  console.log('Bounded shadow summary manifests retain broad identity, negative reads and separate call contributions.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
