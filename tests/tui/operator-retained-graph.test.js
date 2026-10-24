import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../src/integrations/core/build-index/index.js';
import { createSemanticEnrichmentGrant } from '../../src/index/semantic/enrichment-context.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { inspectRepoCacheAccess } from '../../src/shared/cache/repo-access.js';
import { createTuiIndexWorkflows } from '../../tools/tui/operator/index-workflows.js';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { createTuiRetainedGraphs } from '../../tools/tui/operator/retained-graph.js';
import { buildIndexWorkflowArgv, describeIndexWorkflows } from '../../tools/tui/operator/index-catalog.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { createFastIndexingTestConfig } from '../helpers/fast-indexing-config.js';
import { applyTestEnv } from '../helpers/test-env.js';

// Actual retained producer, native plan owner, canonical report child and graph
// reader leases. This source fixture is authored; execution is deferred.
const { dir } = await prepareIsolatedTestCacheDir('tui-retained-graph');
const repo = path.join(dir, 'repo'), toolRoot = process.cwd();
await fs.mkdir(repo); await fs.writeFile(path.join(repo, 'tiny.js'), 'export function retained() { return 1; }\n');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', syncProcess: true,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
  testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
    indexing: { workerPool: { enabled: false }, embeddings: { enabled: false, mode: 'off' } } }) });
let retainedRoot;
const grant = createSemanticEnrichmentGrant({ attach: async runtime => {
  retainedRoot = runtime.buildRoot;
  return { beforePublish: async () => { throw Object.assign(new Error('fixture optional backend failure'), { code: 'ERR_FIXTURE_BACKEND' }); } };
} });
await assert.rejects(buildIndex(repo, { mode: 'code', stage: 'stage2', sqlite: false,
  progress: 'off', semanticEnrichmentDrain: grant }), { code: 'ERR_FIXTURE_BACKEND' });
const statePath = path.join(retainedRoot, 'build_state.json'), pointerPath = path.join(getRepoCacheRoot(repo), 'builds/current.json');
const before = await fs.readFile(statePath, 'utf8');
await assert.rejects(fs.access(pointerPath), { code: 'ENOENT' });
const scopes = createTuiSettingsSession({ toolRoot, env }), launches = [];
const actor = createTuiIndexWorkflows({ scopes, toolRoot, env, startJob: async (...args) => { launches.push(args); } });
const scope = await scopes.selectScope({ kind: 'repo', target: repo });
const values = { 'index-root': retainedRoot, mode: 'code', format: 'json', out: path.join(repo, 'retained-map.json'), 'max-files': 2 };
try {
  const prepared = await actor.preview({ scopeId: scope.id, commandId: 'report.map', values });
  assert.equal(prepared.launchable, true, JSON.stringify(prepared));
  assert.equal(prepared.canonicalArgv, null);
  assert.equal(prepared.graphReview.canonicalPlan.operation, 'graph');
  assert.equal(prepared.graphReview.canonicalPlan.work.parseFiles, 0);
  assert.equal(prepared.graphReview.canonicalPlan.work.publishCurrentPointer, false);
  assert.equal(prepared.observations[0].publication.observed, false);
  assert.equal(await fs.readFile(statePath, 'utf8'), before, 'preview is metadata-only and performs no recovery');
  assert.equal(launches.length, 0);
  prepared.graphReview.canonicalPlan.buildRoot = dir;
  prepared.graphReview.canonicalPlan.modes = ['prose'];
  const launch = await actor.launch({ scopeId: scope.id, previewId: prepared.previewId, confirmed: true });
  assert.equal(launch.executionOwner, 'canonical-retained-graph-capability');
  const [request, hooks] = launches[0];
  assert.equal(request.jobId, prepared.plannedJobId);
  await hooks.beforeRun({ signal: new AbortController().signal });
  const result = await hooks.execute({ signal: new AbortController().signal, env, jobId: request.jobId });
  assert.equal(result.exitCode, 0);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true); assert.equal(receipt.retainedGraph.sourceBuildRoot, retainedRoot);
  assert.notEqual(receipt.retainedGraph.indexRoot, retainedRoot);
  assert.equal(receipt.identity.selectedIndex.indexDir, receipt.retainedGraph.indexDir);
  assert.equal(receipt.identity.selectedIndex.graphCapability.capabilityId, receipt.retainedGraph.capabilityId);
  assert.equal(receipt.retainedGraph.searchReadiness, 'not-established');
  assert.equal(receipt.retainedGraph.publication, 'not-requested');
  const model = JSON.parse(await fs.readFile(values.out, 'utf8'));
  assert.ok(model.nodes.some(node => node.path === 'tiny.js'), 'the actual map consumer read the retained snapshot');
  const afterRun = await hooks.afterRun({ payload: { status: 'done' }, signal: new AbortController().signal });
  assert.equal(afterRun.workflow.graphOnly, true); assert.deepEqual(afterRun.workflow.publications, []);
  await assert.rejects(fs.access(pointerPath), { code: 'ENOENT' });
  const state = JSON.parse(await fs.readFile(statePath));
  assert.ok(state.runtime.attempts.some(attempt => attempt.lifecycle === 'failed'), 'graph success cannot rewrite the failed original attempt');
  for (const selection of [{ ...values, 'index-root': path.join(retainedRoot, 'missing') },
    { ...values, 'index-root': '' }, { ...values, mode: 'prose' }, { ...values, 'graph-capability': 'caller-forged' }]) {
    const invalid = await actor.preview({ scopeId: scope.id, commandId: 'report.map', values: selection });
    assert.equal(invalid.launchable, false); assert.equal(invalid.previewId, undefined);
  }

  const command = describeIndexWorkflows().find(row => row.id === 'report.map');
  const argv = buildIndexWorkflowArgv(command, values, scope);
  let childSettled = false, ownedFailure;
  const original = Object.assign(new Error('original map child cleanup pending'), { cacheOwnershipPending: true,
    cacheOwnershipReleased() { assert.equal(this, original); return childSettled; } });
  const retained = createTuiRetainedGraphs({ toolRoot, requireScope: id => scopes.captureScope(id),
    spawn: async () => { throw original; } });
  const recovery = await retained.prepare({ scope, values, argv });
  await assert.rejects(recovery.execute({ signal: new AbortController().signal, env }), error => {
    ownedFailure = error; return typeof error.releaseGraphReader === 'function';
  });
  assert.equal(retained.status(scope.id)[0].closurePending, true);
  original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
  await assert.rejects(retained.reconcile(), 'replacing the advisory observer cannot retire the original graph reader');
  assert.ok(inspectRepoCacheAccess(getRepoCacheRoot(repo)).some(owner => owner.reason === 'resource-settlement-unconfirmed'));
  childSettled = true;
  await retained.reconcile(); await retained.dispose();
  assert.deepEqual(retained.status(scope.id), []);
  assert.equal(ownedFailure.cacheOwnershipReleased(), true);

  const stale = await actor.preview({ scopeId: scope.id, commandId: 'report.map', values });
  assert.equal(stale.launchable, true);
  await fs.writeFile(statePath, JSON.stringify({ ...JSON.parse(await fs.readFile(statePath)), fixtureRevision: 'changed-after-native-review' }));
  await actor.launch({ scopeId: scope.id, previewId: stale.previewId, confirmed: true });
  await assert.rejects(launches[1][1].execute({ signal: new AbortController().signal, env }), { code: 'ERR_RECOVERY_PLAN_STALE' });
  await assert.rejects(fs.access(pointerPath), { code: 'ENOENT' });
} finally { await actor.dispose(); scopes.dispose(); }
console.log('Native exact retained graph review, actual report consumer and original reader recovery controls authored.');
