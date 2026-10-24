import { createLspClient } from './client.js';
import { normalizeManagedRuntimeCommands, retainManagedCommandInstallation, retainPendingManagedCommand } from '../../../index/tooling/managed-command-lifetime.js';

/** Runtime lease spans idle pool retention and every transport generation.
 * Teardown must be confirmed by the exact client that spawned the children. */
export const createRetainedLspClient = async options => {
  const toolingRoot = options.toolingRoot || options.env?.PAIROFCLEATS_TOOLING_DIR || null;
  const runtimeCommands = normalizeManagedRuntimeCommands(options.managedRuntimeCommands);
  const installations = [], runtimeInstallations = [];
  let client, installation = null;
  try {
    installation = await retainManagedCommandInstallation({ toolingRoot, command: options.cmd });
    if (installation) installations.push(installation);
    for (const selection of runtimeCommands) {
      const runtime = await retainManagedCommandInstallation({ toolingRoot, command: selection.command, expectedSelection: selection });
      installations.push(runtime);
      runtimeInstallations.push(runtime);
    }
    client = createLspClient({ ...options,
      beforeSpawn: () => { for (const held of installations) held.assertHeld(); } });
  } catch (error) {
    // No transport exists yet. Release every acquired owner independently,
    // including when a later SDK/server generation failed admission.
    let failure = error;
    for (const held of installations.toReversed()) {
      try { held.releaseAfterSettlement({ settled: true, pending: false }); }
      catch (cleanupError) { failure = retainPendingManagedCommand(held, failure, { cleanupError }); }
    }
    throw failure;
  }
  let releaseRequested = false;
  const allReleased = () => installations.every(held => held.released);
  const retainAllPending = error => {
    for (const held of installations) if (!held.released) error = retainPendingManagedCommand(held, error);
    return error;
  };
  const releaseIfSettled = () => {
    if (!releaseRequested || client.getTerminationEvidence().settled !== true) return false;
    let failure = null;
    for (const held of installations) {
      if (held.released) continue;
      try { held.releaseAfterSettlement({ settled: true, pending: false }); }
      catch (error) { failure = retainPendingManagedCommand(held, failure || error, failure ? { cleanupError: error } : {}); }
    }
    if (allReleased()) unsubscribe();
    if (failure) throw retainAllPending(failure);
    return allReleased();
  };
  let releaseFailure = null;
  const unsubscribe = client.onResourcesSettled(() => {
    try { releaseIfSettled(); }
    catch (error) { releaseFailure = error; }
  });
  return { ...client,
    managedInstallation: installation ? { toolId: installation.toolId,
      descriptorId: installation.descriptorId, installId: installation.installId } : null,
    managedRuntimeInstallations: runtimeInstallations.map(held => ({ toolId: held.toolId,
      descriptorId: held.descriptorId, installId: held.installId })),
    async releaseManagedInstallation() {
      if (allReleased() && !releaseFailure) return true;
      releaseRequested = true;
      const evidence = await client.waitForResourceSettlement();
      if (evidence.settled !== true) {
        const error = Object.assign(new Error('Managed LSP installation remains owned until all child resources settle.'), {
          code: 'ERR_LSP_DISPOSAL_UNCONFIRMED', termination: evidence, cacheOwnershipPending: true
        });
        Object.defineProperty(error, 'cacheOwnershipReleased', { value: allReleased });
        throw retainAllPending(error);
      }
      if (releaseFailure) {
        const error = releaseFailure;
        releaseFailure = null;
        throw error;
      }
      return releaseIfSettled() || allReleased();
    }
  };
};
