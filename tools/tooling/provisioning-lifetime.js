import { randomUUID } from 'node:crypto';
import { retainManagedToolInstallation } from '../../src/shared/managed-installation.js';
import { getManagedVerificationStorageRecovery, retainManagedResourceFailure, verifyRetainedManagedInstallation } from './managed-verification.js';
import { observeProvisioningResource } from './provisioning-failure.js';

const recoveries = new WeakMap();
export const getManagedProvisioningRecovery = error => error && typeof error === 'object' ? recoveries.get(error) || null : null;
const exactSettlement = (receipt, resourceId) => receipt && !Array.isArray(receipt)
  && Object.keys(receipt).sort().join(',') === 'pending,resourceId,settled' && receipt.resourceId === resourceId
  && receipt.settled === true && receipt.pending === false;
const failedSettlement = (error, settlement) => {
  try { Object.defineProperty(error, 'settlement', { value: settlement, configurable: true }); return error; }
  catch { return Object.assign(new AggregateError([error], 'Managed prerequisite consumer failed.', { cause: error }), { settlement }); }
};

/** Keep the exact selected prerequisite generations through actual children.
 * Recovery is an in-process capability, never serialized plan authority. The
 * retained owner still requires every original child/metadata observer.
 */
export const withManagedProvisioningRequirements = async (plan, execute, { signal = null, registerRecovery = () => {} } = {}) => {
  const selections = new Map();
  for (const step of plan.steps || []) {
    const selected = step.managedInstallation;
    if (!selected) continue;
    selections.set(`${selected.toolingRoot}:${selected.toolId}:${selected.installId}`, selected);
  }
  if (selections.size > 32) throw new Error('Managed prerequisite generation count exceeds its bound.');
  const required = [...selections.values()];
  const retain = async index => {
    signal?.throwIfAborted();
    if (index === required.length) return execute();
    const held = await retainManagedToolInstallation(required[index]);
    const resourceId = randomUUID();
    let childFailure = null;
    const storageRecoveries = new Set();
    try {
      const result = await verifyRetainedManagedInstallation(held, async () => {
        const settlement = { resourceId, settled: true, pending: false };
        try {
          const value = await retain(index + 1);
          observeProvisioningResource(value, { phase: 'managed-prerequisite-consumer' }).requireSettled();
          return { ok: true, value, settlement };
        } catch (value) {
          const error = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
          childFailure = error;
          const storage = getManagedVerificationStorageRecovery(error);
          if (storage) storageRecoveries.add(storage);
          observeProvisioningResource(error, { phase: 'managed-prerequisite-consumer-failure' }).requireSettled();
          throw failedSettlement(error, settlement);
        }
      }, { signal }, resourceId);
      return result.value;
    } catch (error) {
      const outer = Object.getOwnPropertyDescriptor(error, 'managedInstallSession')?.value;
      if (!outer) throw error;
      const childRecovery = getManagedProvisioningRecovery(childFailure);
      const inner = childFailure && Object.getOwnPropertyDescriptor(childFailure, 'managedInstallSession')?.value;
      const probe = childFailure && Object.getOwnPropertyDescriptor(childFailure, 'managedProbeSession')?.value;
      const observation = observeProvisioningResource(error, { phase: 'managed-prerequisite-recovery' });
      let released = false;
      const isReleased = () => { try { observation.requireSettled(); return released; } catch { return false; } };
      const describe = cleanupError => {
        const failure = retainManagedResourceFailure(error, { session: recovery, released: isReleased, cleanupError });
        recoveries.set(failure, recovery);
        return failure;
      };
      const releaseAfterClosure = async () => {
        try {
          if (released) return true;
          for (const storage of storageRecoveries) storage.releaseAfterClosure();
          if (childRecovery) await childRecovery.releaseAfterClosure();
          else if (inner && inner !== outer && await inner.releaseAfterSettlement({ resourceId: inner.resourceId, settled: true, pending: false }) !== true) {
            throw new Error('Dependent managed owner did not confirm settlement.');
          }
          else if (probe && await probe.releaseAfterClosure() !== true) throw new Error('Dependent probe owner did not confirm settlement.');
          if (await outer.releaseAfterSettlement({ resourceId: outer.resourceId, settled: true, pending: false }) !== true) {
            throw new Error('Managed prerequisite owner did not confirm settlement.');
          }
          released = true;
          return true;
        } catch (cleanupError) { throw describe(cleanupError); }
      };
      const recovery = Object.freeze({ resourceId: outer.resourceId, isReleased, releaseAfterClosure,
        releaseAfterSettlement: async receipt => {
          if (!exactSettlement(receipt, outer.resourceId)) throw describe(new Error('Managed prerequisite recovery requires its exact settlement receipt.'));
          return releaseAfterClosure();
        } });
      registerRecovery(recovery);
      throw describe();
    }
  };
  return retain(0);
};
