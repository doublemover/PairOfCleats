// Source UNVALIDATED: actual shared subprocess closure governs installation release.
import { getToolingConfig } from '../../shared/dict-utils.js';
import { retainManagedToolInstallation } from '../../shared/managed-installation.js';
import { spawnResolvedSubprocess } from '../../shared/subprocess/command-invocation.js';
import { locateToolExecutable, resolveToolsById } from '../../../tools/tooling/utils.js';
import { identifyProvisioningExecutable } from '../../../tools/tooling/provisioning-plan.js';
import { verifyStructuralBinaryIdentity } from './binaries.js';

const missing = engine => Object.assign(new Error(`${engine} has no identified structural engine executable. Select it in tooling setup.`), { code: 'ENOENT' });

/** Hold exact selected generation through identity probe and every rule child.
 * Injection is for source fixtures, not a user supplied execution/authority knob.
 */
export const withStructuralBinary = async (engine, { repoRoot, signal = null } = {}, execute, dependencies = {}) => {
  const config = (dependencies.getConfig || getToolingConfig)(repoRoot);
  const tool = (dependencies.resolveTools || resolveToolsById)([engine], config.dir, repoRoot, config)[0];
  if (!tool) throw missing(engine);
  const located = (dependencies.locate || locateToolExecutable)(tool);
  if (!located.found || !located.path) throw missing(engine);
  let held = null;
  let pendingError = null;
  let primaryError = null;
  const release = () => {
    if (held && !held.release()) throw new Error('Structural managed installation lease changed before release.');
    held = null;
    return true;
  };
  try {
    signal?.throwIfAborted();
    if (tool.managedInstallation) {
      held = await (dependencies.retain || retainManagedToolInstallation)({ toolingRoot: config.dir, toolId: engine,
        descriptorId: tool.managedInstallation.descriptorId, installId: tool.managedInstallation.installId });
      if (held.receipt.installId !== tool.managedInstallation.installId) throw new Error('Structural physical installation changed before execution.');
    }
    const command = held?.command || located.path;
    const prefix = held?.args || tool.managedInstallation?.args || [];
    const identify = dependencies.identify || identifyProvisioningExecutable;
    const selectedBytes = identify(command).sha256;
    const spawn = dependencies.spawn || spawnResolvedSubprocess;
    const run = async (args, options = {}) => {
      signal?.throwIfAborted();
      if (pendingError) throw pendingError;
      if (identify(command).sha256 !== selectedBytes) throw new Error('Structural executable bytes changed after admission.');
      let spawned = false;
      let closeObserved = false;
      try {
        const result = await spawn(command, [...prefix, ...args], {
          cwd: repoRoot, outputEncoding: 'utf8', maxOutputBytes: 16 * 1024 * 1024,
          rejectOnNonZeroExit: false, signal, ...options,
          onSpawn: () => { spawned = true; }
        });
        closeObserved = true;
        if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated) {
          throw Object.assign(new Error('Structural engine output exceeded its capture bound; partial results were rejected.'), { code: 'ERR_STRUCTURAL_OUTPUT_LIMIT' });
        }
        return { ...result, status: result.exitCode, error: null };
      } catch (error) {
        const termination = error.result?.termination;
        const settled = closeObserved || !spawned || error.cacheOwnershipReleased?.() === true
          || (termination?.closeObserved === true && termination.treeCleanupSettled === true && termination.treeCleanupFailed === false);
        if (!settled || error.cacheOwnershipPending === true) {
          pendingError = error;
          error.cacheOwnershipPending = true;
          Object.defineProperty(error, 'structuralInstallationSession', { configurable: true, value: {
            installId: held?.receipt.installId || null,
            root: held?.root || null,
            releaseAfterClosure: () => {
              if (error.cacheOwnershipReleased?.() !== true) throw new Error('Actual structural child/tree closure remains pending.');
              const released = release();
              pendingError = null;
              return released;
            }
          } });
        }
        throw error;
      }
    };
    const version = await run([engine === 'comby' ? '-version' : '--version'], { timeoutMs: 5000, maxOutputBytes: 65536 });
    if (!verifyStructuralBinaryIdentity(engine, version)) throw Object.assign(new Error(`${engine} returned an unrecognized executable identity.`), { code: 'ERR_STRUCTURAL_IDENTITY' });
    return await execute({ command, run, installId: held?.receipt.installId || null });
  } catch (error) { primaryError = error; throw error; }
  finally {
    if (!pendingError) {
      try { release(); }
      catch (error) { if (primaryError) primaryError.structuralReleaseError = error; else throw error; }
    }
  }
};
