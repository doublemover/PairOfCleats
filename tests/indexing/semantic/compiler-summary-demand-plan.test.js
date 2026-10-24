import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { planSemanticSummaryDemand } from '../../../src/index/semantic/build-frontier.js';
import { createSemanticTaskId, canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';

// UNVALIDATED. The plan consumes actual retained compiler evidence; source
// functions, external calls, schedulers, leases and publishers never execute.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-summary-demand-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'demand.ts': `export {};
    declare function external(value: number): number;
    function leaf(value: number) { return value; }
    function forward(value: number) { return leaf(value); }
    function incomplete(value: number) { return external(value); }
    function recursive(value: number): number { return value ? recursive(value - 1) : value; }
    const result = forward(101);
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
  const added = await collectCompilerCrossFileFlow(fixture), store = fixture.storeFor([...fixture.syntaxPartitions, ...added]);
  const descriptor = fixture.state.semanticEvidenceArtifacts[0];
  const manifest = JSON.parse(await fs.readFile(path.join(fixture.stagingRoot, descriptor.path), 'utf8'));
  const summary = name => manifest.summaries.find(summary => summary.locator.sourceIdentity?.locator?.lexical.at(-1)?.name === name);
  assert.ok(summary('forward')); assert.ok(summary('leaf')); assert.ok(summary('incomplete')); assert.ok(summary('recursive'));
  const request = { schemaVersion: 1, mode: 'plan', generation: store.generation, inventoryHash: store.cursorScope,
    seed: JSON.parse(summary('forward').declaration), sourceUnitId: doc.item.source.sourceUnitId, sourceHash: doc.item.source.byteHash,
    policyHash: semanticHash('semantic.call-flow-policy.v1', flow.policy.enrichment),
    summaryIdentityHash: fixture.state.semanticCompilerSummaryAdmissions.get(descriptor.path).identityHash,
    need: { kind: 'return-value-inputs' }, limits: { maxWork: 4096, maxSummaries: 128, maxRetainedBytes: 1048576, maxIterations: 12, maxMs: 30000 } };
  const targetSetHash = '7'.repeat(64), policyHash = '8'.repeat(64), inputHashes = [flow.partition.canonicalHash];
  const task = { schemaVersion: 1, kind: 'crossFileFlow', baseBuildId: store.generation.baseBuildId,
    sourceUnits: [doc.item.source.sourceUnitId], inputHashes, policyHash, targetSetHash,
    targetsRef: 'semantic-frontier-targets/' + targetSetHash + '.json', dependencies: [], priority: 1,
    reason: 'fixture-existing-compiler-task', coverageToProduce: ['crossFileFlow'] };
  task.taskId = createSemanticTaskId({ kind: task.kind, inputHashes, policyHash, targetSetHash });
  const context = { descriptor, registeredInventory: fixture.state.semanticEvidenceArtifacts, expectedIdentity: manifest.identity, tasks: [task] };
  const plan = changes => planSemanticSummaryDemand({ store, request, context, ...changes });
  const originalFacts = fixture.state.semanticFactsByFile.get('demand.ts');
  const beforeFiles = await fs.readdir(path.join(fixture.stagingRoot, 'semantic-evidence'));
  const result = await plan();
  assert.equal(result.status, 'blocked'); assert.equal(result.mode, 'plan'); assert.equal(result.analysisExecuted, false);
  assert.equal(result.executionAllowed, false); assert.equal(result.enqueueAllowed, false); assert.equal(result.summaryReuseQualified, false);
  assert.deepEqual(result.plannedSummaries.map(row => canonicalSemanticJson(row.declaration)).sort(),
    [summary('forward').declaration, summary('leaf').declaration].sort());
  assert.equal(result.candidateTasks.length, 1); assert.equal(result.candidateTasks[0].taskId, task.taskId);
  assert.equal(result.candidateTasks[0].enqueueAllowed, false);
  assert.ok(result.blockers.includes('information_dependency_completeness_unqualified'));
  assert.equal(result.budgets.consumed.iterations, 0); assert.equal(result.budgets.remaining.iterations, 12);
  assert.ok(result.budgets.consumed.retainedBytes <= request.limits.maxRetainedBytes);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.candidateTasks));
  assert.equal((await plan()).planId, result.planId, 'duplicate demand has stable immutable planning identity');
  const mutable = structuredClone({ request, context });
  const captured = plan(mutable);
  mutable.request.sourceHash = '0'.repeat(64); mutable.context.tasks.length = 0; mutable.context.expectedIdentity.compilerContext.contextKey = 'changed';
  assert.equal((await captured).planId, result.planId, 'caller mutation during I/O cannot retarget the plan');
  for (const key of Object.keys(request.limits)) {
    const limited = await plan({ request: { ...request, limits: { ...request.limits, [key]: 0 } } });
    assert.equal(limited.status, 'partial', key); assert.equal(limited.analysisExecuted, false);
    assert.ok(limited.frontier.length > 0, key + ' retains an unknown frontier instead of no-flow');
  }
  const noTask = await plan({ context: { ...context, tasks: [] } });
  assert.ok(noTask.blockers.includes('summary_demand_existing_frontier_task_unavailable'));
  const missing = await plan({ request: { ...request, seed: JSON.parse(summary('incomplete').declaration) } });
  assert.ok(missing.frontier.some(row => row.reason === 'summary_demand_unknown_callee'));
  const recursive = await plan({ request: { ...request, seed: JSON.parse(summary('recursive').declaration) } });
  assert.equal(recursive.plannedSummaries.length, 1, 'recursive source demand visits a declaration once');
  const bounded = await plan({ request: { ...request, limits: { ...request.limits, maxSummaries: 1 } } });
  assert.equal(bounded.status, 'partial'); assert.ok(bounded.frontier.some(row => row.reason === 'summary_demand_summary_budget'));
  for (const changes of [{ generation: { baseBuildId: 'changed', semanticRevision: 0 } }, { inventoryHash: '0'.repeat(64) },
    { sourceHash: '0'.repeat(64) }, { policyHash: '0'.repeat(64) }, { summaryIdentityHash: '0'.repeat(64) }]) {
    const stale = await plan({ request: { ...request, ...changes } });
    assert.ok(['unsupported', 'blocked'].includes(stale.status)); assert.equal(stale.candidateTasks.length, 0);
  }
  for (const changes of [{ mode: 'enqueue' }, { need: { kind: 'execute' } }, { query: { maxDepth: 10000 } }]) {
    await assert.rejects(plan({ request: { ...request, ...changes } }), { code: 'ERR_SEMANTIC_SUMMARY_DEMAND' });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(plan({ signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.strictEqual(fixture.state.semanticFactsByFile.get('demand.ts'), originalFacts);
  assert.deepEqual(await fs.readdir(path.join(fixture.stagingRoot, 'semantic-evidence')), beforeFiles);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 1, 'planning registers no artifacts or tasks');
  console.log('Plan-only immutable summary demands retain budgets, explicit blockers and existing frontier proposals.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
