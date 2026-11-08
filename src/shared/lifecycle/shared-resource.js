import { addStorageFailureContext } from '../storage/operation-error.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { withIndependentRunResource } from './run-scope.js';
import { runWithIndependentSchedulerOwner } from '../concurrency/scheduler-task-scope.js';
import { randomUUID } from 'node:crypto';
import { withTrackedSubprocessSignalScope } from '../subprocess/tracking-scope.js';

/** Shared immutable-configuration resources retain their actual component close
 * owner. A run releases only its lease; the last lease closes the resource.
 */
export const createRunSharedResources = ({ create, dispose, isDisposed = () => false }) => {
  const records = new Map();
  let shutdown = null;
  const withinResource = (record, action) => withIndependentRunResource(() =>
    runWithIndependentSchedulerOwner(() => withTrackedSubprocessSignalScope(null, record.scope, action)));
  const settled = record => {
    if (!record.closed) {
      try {
        record.closed = Boolean(record.closing && record.resource && isDisposed(record.resource)
          || record.creationFailure?.isSettled());
      } catch { return false; }
      if (record.closed && records.get(record.key) === record) records.delete(record.key);
    }
    return record.closed;
  };
  const close = record => {
    if (settled(record)) return Promise.resolve();
    if (!record.closing) record.closing = (async () => {
      let resource;
      try { resource = await record.creating; }
      catch (error) {
        observeStorageResource(error, { phase: 'shared-resource-create' }).requireSettled();
      }
      if (resource) await withinResource(record, () => dispose(resource, record.input));
      record.closed = true;
      if (records.get(record.key) === record) records.delete(record.key);
    })().catch(error => {
      record.failure = addStorageFailureContext(error, { cacheOwnershipPending: true,
        cacheOwnershipReleased: () => settled(record) }, undefined, { forceAggregate: true });
      throw record.failure;
    });
    record.closing.catch(() => {});
    return record.closing;
  };
  const acquire = async (owner, key, input) => {
    owner.assertAccepting();
    if (shutdown) { await shutdown; owner.assertAccepting(); }
    let record = records.get(key);
    if (record?.closing) {
      try { await record.closing; }
      catch (error) { if (!settled(record)) throw error; }
      owner.assertAccepting();
      record = records.get(key);
    }
    if (!record) {
      record = { key, input, owners: new Set(), creating: null, ready: false, resource: null,
        view: null, scope: `shared-resource:${randomUUID()}:`, closing: null, closed: false, failure: null };
      records.set(key, record);
    }
    if (!record.owners.has(owner)) {
      let released = false, detached = false;
      owner.adopt(record, { isSettled: () => released || detached && settled(record),
        release: async () => {
          record.owners.delete(owner);
          detached = true;
          if (!record.owners.size) await close(record);
          released = true;
        } });
      record.owners.add(owner);
    }
    if (!record.creating) record.creating = Promise.resolve().then(() => withinResource(record, () => create(input, {
      isNeeded: () => [...record.owners].some(candidate => candidate.isAccepting())
    }))).then(resource => { record.resource = resource; record.ready = true; return resource; }, error => {
      record.creationFailure = observeStorageResource(error, { phase: 'shared-resource-create' });
      throw error;
    });
    const resource = record.ready ? record.resource : await owner.track(() => record.creating);
    owner.assertAccepting();
    if (!resource) return null;
    record.view ||= Object.freeze({ value: resource, run: action => withinResource(record, () => action(resource)) });
    return record.view;
  };
  const shutdownAll = () => {
    if (!shutdown) {
      const selected = [...records.values()];
      for (const record of selected) for (const owner of record.owners) owner.stopAdmission();
      shutdown = Promise.allSettled(selected.map(close)).then(results => {
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw failures.slice(1).reduce((error, secondary) => addStorageFailureContext(error,
          {}, secondary, { secondaryPresent: true }), failures[0]);
      }).finally(() => { shutdown = null; });
      shutdown.catch(() => {});
    }
    return shutdown;
  };
  return Object.freeze({ acquire, shutdownAll });
};
