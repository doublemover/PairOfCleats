import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getToolingConfig, resolveToolRoot } from '../shared/dict-utils.js';
import { locateToolExecutable, resolveToolsById } from './utils.js';
import { bindProvisioningCommand, createToolProvisioningPlan, identifyProvisioningExecutable, probeProvisioningCommand, verifyToolProvisioningPlan } from './provisioning-plan.js';
import { verifyOperationalCapability, OPERATIONAL_TOOL_IDS } from './operational-probes.js';
import { retainManagedToolInstallation } from '../../src/shared/managed-installation.js';
import { retainManagedResourceFailure, verifyRetainedManagedInstallation } from './managed-verification.js';
import { runOperationalChildWithStorage } from './operational-storage.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { observeProvisioningResource } from './provisioning-failure.js';
import { isApplicationOwnedCommand, isRepoTrusted } from '../../src/shared/config-authority.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';

const unavailable = (id, reason) => Object.assign(new Error(`Selected ${id} capability is unavailable: ${reason}. Run tooling install --tools ${id} --scope cache to inspect its supported setup.`),
  { code: 'ERR_OPERATIONAL_TOOL_UNAVAILABLE', toolId: id });
const same = (left, right) => left.path === right.path && left.sha256 === right.sha256 && left.size === right.size;
const withSettlement = (value, settlement) => {
  const error = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
  try { Object.defineProperty(error, 'settlement', { value: settlement, configurable: true }); return error; }
  catch { return Object.assign(new AggregateError([error], error.message, { cause: error }), { settlement }); }
};

/** Canonical selected workflow execution. It never installs, changes PATH on
 * the host, adopts external bytes, or falls back after an explicit selection.
 * Both buffered and streaming children keep one exact generation lease until
 * their actual execution owner confirms child/tree/resource settlement.
 */
export const withOperationalTool = async (id, { repoRoot, commandOverride = null, signal = null, env = process.env } = {}, execute, dependencies = {}) => {
  if (!OPERATIONAL_TOOL_IDS.has(id) || typeof execute !== 'function') throw new Error('Operational execution needs a registered capability and callback.');
  signal?.throwIfAborted();
  const config = (dependencies.getConfig || getToolingConfig)(repoRoot);
  let tool = (dependencies.resolveTools || resolveToolsById)([id], config.dir, repoRoot, config)[0];
  if (!tool) throw unavailable(id, 'unknown or disabled selection');
  if (commandOverride && commandOverride !== tool.detect.cmd) {
    const selected = /[\\/]/.test(commandOverride) && !path.isAbsolute(commandOverride) ? path.resolve(repoRoot, commandOverride) : commandOverride;
    tool = { ...tool, detect: { ...tool.detect, cmd: selected, binDirs: [] }, managedInstallation: null };
  }
  const located = (dependencies.locate || locateToolExecutable)(tool);
  if (!located.found || !located.path) throw unavailable(id, located.source === 'blocked' ? 'the selected command is not trusted for this repository' : tool.provisioningBlocker || 'no executable was located');
  const held = tool.managedInstallation ? await (dependencies.retain || retainManagedToolInstallation)({ toolingRoot: config.dir, toolId: id,
    descriptorId: tool.managedInstallation.descriptorId, installId: tool.managedInstallation.installId }) : { release: () => true };
  const resourceId = randomUUID();
  const storageRecoveries = new Set();
  let verified;
  try { verified = await verifyRetainedManagedInstallation(held, async () => {
    const settlement = { resourceId, settled: true, pending: false };
    const operations = new Set(), observations = [];
    let open = true;
    const remember = value => {
      const observation = observeProvisioningResource(value, { phase: 'operational-tool-execution' });
      observations.push(observation);
      observation.requireSettled();
      return value;
    };
    try {
      const command = held.command || located.path;
      const prefix = held.args || tool.consumerArgsPrefix || [];
      const identify = dependencies.identify || identifyProvisioningExecutable;
      const identity = identify(command, { signal });
      const isAllowed = candidate => {
        if (isRepoTrusted(repoRoot)) return true;
        const selected = identify(candidate, { signal }).path;
        return !isPathWithinRoot(selected, repoRoot) || isApplicationOwnedCommand({ commandPath: selected, repoRoot, toolRoot: resolveToolRoot() });
      };
      const provisioning = await verifyToolProvisioningPlan(createToolProvisioningPlan({ tool, selection: { scope: 'cache', plan: null }, env, signal, isAllowed }),
        { env, signal, cwd: resolveToolRoot(), probe: (selected, args, options) => runOperationalChildWithStorage({ id,
          toolingRoot: config.dir, repoRoot, command: selected, identity: identify(selected, { signal }), env: options.env, cwd: options.cwd,
          registerRecovery: recovery => storageRecoveries.add(recovery) }, ({ env: routed }) =>
          (dependencies.probe || probeProvisioningCommand)(selected, args, { ...options, env: routed })) });
      if (provisioning.state !== 'requirements-verified') throw unavailable(id, provisioning.steps.filter(step => step.state !== 'verified')
        .map(step => `${step.id}: ${step.reason || step.state}`).join('; '));
      const selectedEnv = resolveNoProvisionToolingEnvironment(bindProvisioningCommand({ cmd: identity.path, args: [] }, provisioning, env).env,
        { command: identity.path, providerId: id, toolingRoot: config.dir, cwd: repoRoot });
      const check = () => {
        signal?.throwIfAborted();
        if (!open) throw new Error('Operational execution scope is closed.');
        if (!same(identify(identity.path, { signal }), identity)) throw Object.assign(new Error('Selected operational executable bytes changed; resolve a new scope.'), { code: 'ERR_OPERATIONAL_TOOL_CHANGED' });
      };
      const track = operation => {
        check();
        const promise = Promise.resolve().then(operation);
        operations.add(promise);
        promise.then(() => operations.delete(promise), () => operations.delete(promise));
        return promise;
      };
      const run = (args, options = {}) => track(async () => {
        check();
        try {
          const launch = {
            cwd: repoRoot, outputEncoding: 'utf8', maxOutputBytes: 16 * 1024 * 1024, timeoutMs: 30000,
            rejectOnNonZeroExit: false, ...options, env: selectedEnv, signal
          };
          const result = remember(await runOperationalChildWithStorage({ id, toolingRoot: config.dir, repoRoot,
            command: identity.path, identity, env: selectedEnv, cwd: launch.cwd,
            registerRecovery: recovery => storageRecoveries.add(recovery) }, ({ env: routed }) => {
            check();
            return (dependencies.spawn || spawnResolvedSubprocess)(identity.path, [...prefix, ...args], { ...launch, env: routed });
          }));
          check();
          if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated) throw Object.assign(new Error('Selected operational tool exceeded its output limit.'), { code: 'ERR_OPERATIONAL_OUTPUT_LIMIT' });
          return result;
        } catch (error) { remember(error); throw error; }
      });
      const stream = (runner, args, options = {}) => track(async () => {
        check();
        let closed = false, spawned = false, treeSettled = false;
        let observeClosure = () => !spawned;
        const retainStreamFailure = error => {
          const observation = observeProvisioningResource(error, { phase: 'operational-streaming-child' });
          return Object.assign(new Error('Operational streaming child closure remains pending.', { cause: error }), {
            cacheOwnershipPending: true, cacheOwnershipReleased: () => {
              try { observation.requireSettled(); return observeClosure() === true; } catch { return false; }
            }
          });
        };
        try {
          const launch = { ...options, command: identity.path, args: [...prefix, ...args], env: selectedEnv,
            onSpawn: () => { spawned = true; }, onSettlement: outcome => {
              closed = outcome.closeObserved; treeSettled = outcome.treeCleanupSettled && !outcome.treeCleanupFailed;
              const original = outcome.isSettled;
              observeClosure = typeof original === 'function' ? () => original.call(outcome) === true : () => closed && treeSettled;
            } };
          const result = await runOperationalChildWithStorage({ id, toolingRoot: config.dir, repoRoot,
            command: identity.path, identity, env: selectedEnv, cwd: launch.cwd || repoRoot,
            registerRecovery: recovery => storageRecoveries.add(recovery) }, async ({ env: routed }) => {
            try {
              check();
              const value = await runner({ ...launch, env: routed });
              if (spawned && (!closed || !treeSettled)) throw retainStreamFailure(new Error('Streaming child returned before exact closure.'));
              return value;
            } catch (error) { throw spawned && !observeClosure() ? retainStreamFailure(error) : error; }
          });
          remember(result); check(); return result;
        } catch (error) {
          remember(error); throw error;
        }
      });
      const capability = await verifyOperationalCapability({ id, command: identity.path, argsPrefix: prefix, cwd: resolveToolRoot(), env: selectedEnv, signal }, {
        probe: async (_command, args, options) => {
          const result = await run(args.slice(prefix.length), options);
          return { ok: result.exitCode === 0, status: result.exitCode, stdout: result.stdout || '', stderr: result.stderr || '' };
        }
      });
      if (!capability.ok) throw unavailable(id, capability.level);
      const value = await execute({ command: identity.path, argsPrefix: prefix, env: selectedEnv, identity, capability,
        installId: held.receipt?.installId || null, run, stream });
      if (operations.size) throw Object.assign(new Error('Operational callback returned with unawaited children.'), { cacheOwnershipPending: true,
        cacheOwnershipReleased: () => operations.size === 0 && observations.every(observation => { try { observation.requireSettled(); return true; } catch { return false; } }) });
      return { ok: true, value, settlement };
    } catch (error) {
      // A closed failed command remains a failure; only exact settlement is
      // attached. Pending native work keeps the retained verifier's recovery.
      remember(error);
      if (operations.size) throw error;
      throw withSettlement(error, settlement);
    } finally { open = false; }
  }, {}, resourceId); }
  catch (value) {
    const primary = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
    const original = primary.managedInstallSession;
    if (!original) throw primary;
    const originalObservation = observeProvisioningResource(primary, { phase: 'operational-installation-and-storage' });
    const released = () => { try { originalObservation.requireSettled(); return [...storageRecoveries].every(recovery => recovery.isReleased()); } catch { return false; } };
    const retain = cleanupError => retainManagedResourceFailure(primary, { session: recovery, released, cleanupError });
    const recovery = Object.freeze({ resourceId: original.resourceId, releaseAfterSettlement: receipt => {
      try {
        if (!receipt || Object.keys(receipt).sort().join(',') !== 'pending,resourceId,settled'
          || receipt.resourceId !== original.resourceId || receipt.settled !== true || receipt.pending !== false) throw new Error('Operational installation requires its exact settlement receipt.');
        for (const storage of storageRecoveries) storage.releaseAfterClosure();
        return original.releaseAfterSettlement(receipt);
      } catch (cleanupError) { throw retain(cleanupError); }
    } });
    throw retain();
  }
  return verified.value;
};

export const runOperationalCommand = ({ id, repoRoot, commandOverride = null, args = [], options = {}, signal = null, env = process.env }, dependencies = {}) =>
  withOperationalTool(id, { repoRoot, commandOverride, signal, env }, tool => tool.run(args, options), dependencies);
