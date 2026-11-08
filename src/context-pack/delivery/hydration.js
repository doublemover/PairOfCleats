import PQueue from 'p-queue';
import { getRepoRoot, getRepoCacheRoot } from '../../shared/repo-paths.js';
import { getApplicationHome } from '../../shared/cache-roots.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { throwIfAborted, raceAbort } from '../../shared/abort.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { semanticReaderFailure } from '../../semantic/reader-lifetime.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { captureDelivery, deliveryJson, deliveryError } from './manifest.js';
import { createSourceHydrationReader } from './source-hydration-reader.js';
import { confirmDeliveryPermission } from './permission.js';

const equal = (a, b) => deliveryJson(a) === deliveryJson(b);
const authority = ({ windowRevision: _revision, ...context }) => context;

/** Experimental explicit host facility. Default public delivery keeps independent
 * reads. Coalescing is in-flight only, under identical immutable input and scope;
 * every waiter independently authenticates and rechecks before byte release.
 */
export const createRetainedSourceHydrationPool = ({ boundary, readSource = createSourceHydrationReader(),
  resolveIndexDir = resolveSemanticGenerationIndexDir, loadConfig = loadUserConfig } = {}) => {
  if (typeof boundary?.bind !== 'function' || typeof readSource !== 'function') throw deliveryError('UnsupportedAdapter', 'Shared source hydration requires installed authentication and read owners.');
  const queue = new PQueue({ concurrency: 2 }), pending = new Map(), live = new Set(), calls = new Set(), shutdown = new AbortController();
  let activeRequests = 0, reservedBytes = 0, closed = false, createdReads = 0, coalescedWaiters = 0;
  const retire = entry => {
    if (!entry.done || !entry.isSettled()) return;
    entry.resourceGate.resolve();
    if (entry.waiters) return;
    if (pending.get(entry.key) === entry) pending.delete(entry.key);
    if (live.delete(entry)) reservedBytes -= entry.reservation;
  };
  const reap = () => { for (const entry of live) retire(entry); };
  const bind = async (transport, request, signal) => {
    throwIfAborted(signal);
    const bound = await boundary.bind(transport, 'source-hydration');
    const observation = observeStorageResource(bound, { phase: 'source-hydration-binding' }); observation.requireSettled();
    if (typeof bound?.recheck !== 'function' || typeof bound?.authorizeSource !== 'function') {
      throw deliveryError('ScopeDenied', 'Source hydration consumer/source is not admitted.');
    }
    await confirmDeliveryPermission(bound.recheck(), 'Source hydration consumer is not admitted.');
    await confirmDeliveryPermission(bound.authorizeSource(request, { phase: 'admit', source: null }), 'Source identity is not admitted for this consumer.');
    const context = captureDelivery('context', bound.contextRef);
    if (!equal(context.worldRef, request.worldRef)) throw deliveryError('SourceStale', 'Hydration request belongs to another host world.');
    observation.requireSettled(); throwIfAborted(signal); return { bound, context };
  };
  const drain = async () => {
    const observed = await Promise.all([...live].map(async entry => {
      try { await entry.work; return { status: 'fulfilled' }; }
      catch {
        if (!entry.isSettled()) throw entry.error;
        return { status: 'rejected' };
      }
    }));
    reap();
    const pendingErrors = [...live].filter(entry => entry.done && !entry.isSettled()).map(entry => entry.error);
    if (pendingErrors.length) throw semanticReaderFailure(pendingErrors);
    return { settled: live.size === 0 && activeRequests === 0, retainedEntries: live.size,
      failedReads: observed.filter(result => result.status === 'rejected').length };
  };
  const read = async (input, transport, { signal: callerSignal = null } = {}) => {
    const signal = callerSignal ? AbortSignal.any([callerSignal, shutdown.signal]) : shutdown.signal;
    const request = captureDelivery('sourceRequest', input); throwIfAborted(signal);
    if (closed) throw deliveryError('HydrationUnavailable', 'Source hydration pool is closed.');
    if (activeRequests >= 16) throw deliveryError('MandatoryOverflow', 'Source hydration waiter allowance exceeded.');
    activeRequests++;
    let entry = null;
    try {
      const admitted = await bind(transport, request, signal), repoRoot = getRepoRoot(request.worldRef.repositoryNamespace);
      if (repoRoot !== request.worldRef.repositoryNamespace) throw deliveryError('ScopeDenied', 'Hydration requires its canonical authorized repository namespace.');
      const env = { ...process.env }, userConfig = loadConfig(repoRoot), cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
      const indexDir = await resolveIndexDir({ repoRoot, generation: request.worldRef.generation, userConfig, signal });
      throwIfAborted(signal); reap();
      if (closed) throw deliveryError('HydrationUnavailable', 'Source hydration pool closed during admission.');
      const key = deliveryJson({ request, indexDir, cacheRoot, home: getApplicationHome({ env }),
        scopeDigest: admitted.context.scopeDigest, policyDigest: admitted.context.policyDigest });
      entry = pending.get(key);
      if (entry?.done) {
        if (!entry.isSettled()) throw entry.error;
        if (pending.get(key) === entry) pending.delete(key);
        entry = null;
      }
      if (!entry) {
        const reservation = 16 * request.maxBytes + 32768;
        if (live.size >= 4 || reservedBytes + reservation > 64 * 1024 * 1024 + 4 * 32768) throw deliveryError('MandatoryOverflow', 'Source hydration work/encoded-retention allowance exceeded.');
        const controller = new AbortController(), queued = new AbortController(), result = Promise.withResolvers();
        entry = { key, controller, reservation, waiters: 0, done: false, started: false, error: null,
          resourceGate: Promise.withResolvers(), work: result.promise, isSettled: () => false };
        live.add(entry); reservedBytes += reservation; pending.set(key, entry); createdReads++;
        const observed = entry;
        const failed = error => {
          observed.done = true; observed.error = error;
          const observation = observeStorageResource(error, { phase: 'shared-hydration-worker' });
          observed.isSettled = () => {
            try { return observation.isSettled() === true; }
            catch (inspection) { observed.error = observation.retain(inspection, { inspectionPresent: true }); return false; }
          };
          result.reject(error); retire(observed);
        };
        // Queue cancellation applies only before admission. Once the actual
        // read starts, its slot lasts until the original resource settles.
        const cancelQueued = () => { if (!observed.started) queued.abort(); };
        controller.signal.addEventListener('abort', cancelQueued, { once: true });
        entry.lifetime = queue.add(async () => {
          observed.started = true; controller.signal.removeEventListener('abort', cancelQueued);
          try {
            throwIfAborted(controller.signal);
            const value = await readSource({ request, repoRoot, cacheRoot, indexDir, userConfig, env,
              onResourceSettled: () => retire(observed) }, controller.signal);
            observeStorageResource(value, { phase: 'shared-hydration-result' }).requireSettled();
            if (!Object.isFrozen(value) || !Object.isFrozen(value?.source) || typeof value.text !== 'string'
                || value.source.sourceUnitId !== request.sourceUnitId || value.source.byteHash !== request.sourceHash) {
              throw deliveryError('SourceStale', 'Source read owner did not return its immutable requested snapshot.');
            }
            observed.done = true; observed.isSettled = () => true; result.resolve(value); retire(observed);
          } catch (error) { failed(error); }
          await observed.resourceGate.promise;
        }, { signal: queued.signal });
        entry.lifetime.then(() => retire(observed), error => {
          controller.signal.removeEventListener('abort', cancelQueued);
          if (!observed.done) failed(error);
        });
      } else coalescedWaiters++;
      entry.waiters++;
      let primary, failed = false;
      try {
        const value = await raceAbort(signal, entry.work);
        throwIfAborted(signal);
        await confirmDeliveryPermission(admitted.bound.recheck(), 'Source hydration permission was revoked before release.');
        const current = await bind(transport, request, signal);
        if (!equal(authority(admitted.context), authority(current.context))) throw deliveryError('ScopeDenied', 'Consumer epoch, task or scope changed before source release.');
        await confirmDeliveryPermission(admitted.bound.authorizeSource(request, { phase: 'release', source: value.source }), 'Consumer source permission changed before verified byte release.');
        await confirmDeliveryPermission(current.bound.authorizeSource(request, { phase: 'release', source: value.source }), 'Fresh consumer scope does not authorize these verified source bytes.');
        throwIfAborted(signal); return value;
      } catch (error) { primary = error; failed = true; throw error; }
      finally {
        entry.waiters--;
        if (!entry.waiters && !entry.done) {
          entry.controller.abort();
          try { await entry.work; }
          catch (cleanup) { if (cleanup !== primary) throw failed ? semanticReaderFailure([primary, cleanup]) : cleanup; }
        }
        retire(entry);
      }
    } finally { activeRequests--; if (entry) retire(entry); }
  };
  return Object.freeze({
    read: (...args) => {
      const work = read(...args); calls.add(work);
      work.then(() => calls.delete(work), () => calls.delete(work)); return work;
    },
    snapshot: () => { reap(); return { createdReads, coalescedWaiters, activeRequests, activeEntries: live.size, reservedBytes,
      occupiedReadSlots: queue.pending, queuedReads: queue.size }; },
    drain,
    dispose: async () => {
      closed = true; shutdown.abort(); for (const entry of live) if (!entry.done) entry.controller.abort();
      await Promise.allSettled([...calls]); return drain();
    }
  });
};
