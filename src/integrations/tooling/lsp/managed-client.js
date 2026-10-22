import { createLspClient } from './client.js';
import { retainManagedCommandInstallation, retainPendingManagedCommand } from '../../../index/tooling/managed-command-lifetime.js';

/** Runtime lease spans idle pool retention and every transport generation.
 * Teardown must be confirmed by the exact client that spawned the children. */
export const createRetainedLspClient = async options => {
  const installation = await retainManagedCommandInstallation({
    toolingRoot: options.toolingRoot || options.env?.PAIROFCLEATS_TOOLING_DIR || null, command: options.cmd
  });
  let client;
  try {
    client = createLspClient({ ...options,
      beforeSpawn: () => installation?.assertHeld() });
  } catch (error) {
    try { installation?.releaseAfterSettlement({ settled: true, pending: false }); }
    catch (cleanupError) { throw retainPendingManagedCommand(installation, error, { cleanupError }); }
    throw error;
  }
  let releaseRequested = false, installationReleased = false;
  const releaseIfSettled = () => {
    if (!installation || installationReleased || !releaseRequested || client.getTerminationEvidence().settled !== true) return false;
    installationReleased = installation.releaseAfterSettlement({ settled: true, pending: false });
    if (installationReleased) unsubscribe();
    return installationReleased;
  };
  let releaseFailure = null;
  const unsubscribe = client.onResourcesSettled(() => {
    try { releaseIfSettled(); }
    catch (error) { releaseFailure = retainPendingManagedCommand(installation, error); }
  });
  return { ...client,
    managedInstallation: installation ? { toolId: installation.toolId,
      descriptorId: installation.descriptorId, installId: installation.installId } : null,
    async releaseManagedInstallation() {
      if (!installation) return true;
      if (installationReleased) return true;
      releaseRequested = true;
      const evidence = await client.waitForResourceSettlement();
      if (evidence.settled !== true) {
        const error = Object.assign(new Error('Managed LSP installation remains owned until all child resources settle.'), {
          code: 'ERR_LSP_DISPOSAL_UNCONFIRMED', termination: evidence, cacheOwnershipPending: true
        });
        Object.defineProperty(error, 'cacheOwnershipReleased', { value: () => installationReleased });
        throw retainPendingManagedCommand(installation, error);
      }
      if (releaseFailure) {
        const error = releaseFailure;
        releaseFailure = null;
        throw error;
      }
      try { return releaseIfSettled() || installationReleased; }
      catch (error) { throw retainPendingManagedCommand(installation, error,
        { ...(releaseFailure ? { cleanupError: releaseFailure } : {}) }); }
    }
  };
};
