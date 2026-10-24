import path from 'node:path';
import { buildIndex, withBuildGraphCapability } from '../../../src/integrations/core/build-index/index.js';
import { sameIdentityPath } from '../../../src/shared/indexing/build-pointer-roots.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { captureOwnedCleanup, combineOwnedErrors, settleOwnedActions } from './settle-owned.js';

const MAX_BYTES = 768 * 1024;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const exactArgv = (argv, indexRoot, capabilityId) => [...argv.filter(token =>
  !token.startsWith('--index-root=') && !token.startsWith('--graph-capability=') && !token.startsWith('--mode=')),
`--index-root=${indexRoot}`, `--graph-capability=${capabilityId}`, '--mode=code'];

/** One explicit retained-generation selection. Recovery authority remains in
 * the build owner, and the original child must settle before its reader pin.
 */
export const createTuiRetainedGraphs = ({ toolRoot, requireScope, runBuild = buildIndex,
  consumeGraph = withBuildGraphCapability, spawn = spawnSubprocess } = {}) => {
  const retained = new Set();
  const remember = (error, scopeId) => {
    const observation = captureOwnedCleanup(error);
    if (!observation.present || observation.released()) return;
    let release = null, inspection, inspected = false;
    try { release = error.releaseGraphReader; } catch (failure) { inspected = true; inspection = failure; captureOwnedCleanup(failure); }
    retained.add({ scopeId, error: inspected ? combineOwnedErrors(error, [inspection]) : error,
      observation, releaseFailure: null, release: typeof release === 'function' ? () => Reflect.apply(release, error, []) : null });
  };
  const reconcileEntry = entry => {
    if (entry.releaseFailure && !entry.releaseFailure.observation.released()) {
      throw combineOwnedErrors(entry.error, [entry.releaseFailure.error]);
    }
    entry.releaseFailure = null;
    let releaseFailed = false, releaseError;
    if (entry.release) {
      // This private original callback rechecks the original consumer proof.
      // Neither a terminal job nor a new native session can substitute for it.
      try {
        if (entry.release() !== true) throw Object.assign(new Error('Original graph reader release returned no settlement confirmation.'),
          { code: 'ERR_TUI_GRAPH_RELEASE', cacheOwnershipPending: true });
      }
      catch (error) {
        releaseFailed = true; releaseError = error;
        const observation = captureOwnedCleanup(error);
        if (observation.present && !observation.released()) entry.releaseFailure = { error, observation };
      }
    }
    if (releaseFailed || !captureOwnedCleanup(entry.error).released() || !entry.observation.released()) {
      throw releaseFailed ? combineOwnedErrors(entry.error, [releaseError]) : entry.error;
    }
    retained.delete(entry);
  };
  const reconcile = async () => {
    await settleOwnedActions(Object.fromEntries([...retained].map((entry, index) => [index, () => reconcileEntry(entry)])));
  };
  const status = scopeId => [...retained].filter(entry => entry.scopeId === scopeId).map(() => ({
    service: 'retained-graph', phase: 'cleanup-pending', closurePending: true,
    note: 'The original retained graph reader or consumer has not confirmed resource settlement.' }));
  const prepare = async ({ scope, values, argv, signal }) => {
    requireScope(scope.id); throwIfAborted(signal); await reconcile();
    if (scope.kind !== 'repo' || typeof values['index-root'] !== 'string' || !values['index-root'].trim()) {
      fail('ERR_TUI_GRAPH_SELECTOR', 'Select an exact retained build root for this repository. Current/latest fallback is disabled.');
    }
    if (values.mode && values.mode !== 'code') fail('ERR_TUI_GRAPH_MODE', 'Retained graph recovery supports exactly code mode.');
    const indexRoot = path.resolve(scope.configRoot, values['index-root']);
    let plan;
    try {
      plan = await runBuild(scope.configRoot, { recovery: { action: 'inspect', operation: 'graph', indexRoot,
        modes: ['code'] }, abortSignal: signal });
    } catch (error) { remember(error, scope.id); throw error; }
    requireScope(scope.id); throwIfAborted(signal);
    if (Buffer.byteLength(JSON.stringify(plan)) > MAX_BYTES) fail('ERR_TUI_GRAPH_REVIEW_LIMIT', 'The complete retained graph review exceeds the native byte bound.');
    const review = { repoRoot: scope.configRoot, indexRoot, canonicalPlan: structuredClone(plan),
      operation: 'Validate only this retained generation and seal its independent immutable graph capability after confirmation.',
      effect: 'No parse, embeddings, missing-stage resume or current-pointer publication. The original failed build outcome remains recorded.',
      consumption: 'The canonical map child reads the exact capability under the original graph reader lease until actual child settlement.',
      launchable: plan.blocked === null, errors: plan.blocked ? ['The canonical recovery owner reports a repository writer lease. Wait for its actual completion and preview again.'] : [] };
    const execute = async context => {
      requireScope(scope.id); throwIfAborted(context.signal); await reconcile();
      try {
        context.onActivity?.({ stage: 'retained-graph-validation', state: 'running',
          message: 'Validating selected retained graph bytes; no source parse, embeddings or publication is requested.' });
        const recovered = await runBuild(scope.configRoot, { recovery: { action: 'execute', plan },
          abortSignal: context.signal, log: message => context.onStderr?.(`${message}\n`) });
        const capabilityId = recovered.graph?.capabilityId;
        if (typeof capabilityId !== 'string' || !capabilityId) fail('ERR_TUI_GRAPH_CAPABILITY', 'Recovery returned no exact graph capability; no map child was started.');
        return await consumeGraph(scope.configRoot, { indexRoot, capabilityId, abortSignal: context.signal }, async capability => {
          requireScope(scope.id); throwIfAborted(context.signal);
          context.onActivity?.({ stage: 'retained-graph-map', state: 'running',
            message: 'Reading the exact immutable graph snapshot. Normal search readiness and the failed build outcome are unchanged.' });
          const result = await spawn(process.execPath, [path.join(toolRoot, 'bin/pairofcleats.js'),
            ...exactArgv(argv, indexRoot, capabilityId)], { cwd: scope.configRoot, env: context.env,
            signal: context.signal, stdio: ['ignore', 'pipe', 'pipe'], maxOutputBytes: MAX_BYTES,
            rejectOnNonZeroExit: false, onSpawn: context.onSpawn, onStdout: context.onStdout, onStderr: context.onStderr });
          if (result.exitCode !== 0 || result.signal) return result;
          if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stdout?.encodingLoss) {
            fail('ERR_TUI_GRAPH_OUTPUT', 'The map child receipt was incomplete; retained graph consumption is unverified.');
          }
          let receipt;
          try { receipt = JSON.parse(result.stdout); }
          catch { fail('ERR_TUI_GRAPH_OUTPUT', 'The map child returned no complete canonical receipt.'); }
          if (receipt?.ok !== true || typeof receipt.identity?.selectedIndex?.indexDir !== 'string'
            || !sameIdentityPath(receipt.identity.selectedIndex.indexDir, capability.indexDir)
            || receipt.identity.selectedIndex.graphCapability?.capabilityId !== capabilityId) {
            fail('ERR_TUI_GRAPH_IDENTITY', 'The canonical map receipt did not name the exact admitted immutable graph snapshot.');
          }
          const stdout = JSON.stringify({ ...receipt, retainedGraph: { capabilityId, buildId: capability.buildId,
            sourceBuildRoot: indexRoot, indexRoot: capability.indexRoot, indexDir: capability.indexDir,
            coverage: capability.coverage, sourceScope: 'retained-historical-snapshot',
            sourceFreshness: 'not-checked-against-working-tree', originalFailurePreserved: true,
            publication: 'not-requested', searchReadiness: 'not-established' } });
          if (Buffer.byteLength(stdout) > MAX_BYTES) fail('ERR_TUI_GRAPH_OUTPUT', 'The complete retained map receipt exceeds the native byte bound.');
          return { ...result, stdout, outputCapture: { ...result.outputCapture, stdout: {
            bytes: Buffer.byteLength(stdout), truncated: false, encodingLoss: false } } };
        });
      } catch (error) { remember(error, scope.id); throw error; }
    };
    return { review, execute };
  };
  return { prepare, status, reconcile, dispose: reconcile };
};
