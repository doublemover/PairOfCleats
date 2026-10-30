import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createLifecycleRegistry } from './registry.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { addStorageFailureContext } from '../storage/operation-error.js';

const context = new AsyncLocalStorage();
export const currentRunResourceScope = () => context.getStore() || null;
export const withIndependentRunResource = action => context.run(null, action);

/** The existing lifecycle owns accepted promises and resource release hooks.
 * Async context carries a capability, never authority reconstructed from a path.
 */
export const createRunResourceScope = () => {
  const id = randomUUID(), lifecycle = createLifecycleRegistry({ name: `run-resources:${id}` });
  const resources = new Map(), observations = [];
  let accepting = true, closing = null, drained = false, overflow = false;
  const assertAccepting = () => {
    if (!accepting) throw Object.assign(new Error('Run resource admission is closed.'), { name: 'AbortError', code: 'ABORT_ERR' });
  };
  const settled = () => drained && !overflow && [...resources.values()].every(record => record.settled())
    && observations.every(observation => {
      try { return observation.isSettled(); } catch { return false; }
    });
  const track = action => {
    try { assertAccepting(); } catch (error) { return Promise.reject(error); }
    const work = Promise.resolve().then(() => context.run(owner, action));
    lifecycle.registerPromise(work.then(() => {}, error => {
      const observation = observeStorageResource(error, { phase: 'run-resource-work' });
      let released = false;
      try { released = observation.isSettled(); } catch {}
      if (!released) {
        if (observations.length < 128) observations.push(observation); else overflow = true;
      }
    }), { label: 'run-resource-work' });
    return work;
  };
  const owner = Object.freeze({ id, run: action => context.run(owner, action), assertAccepting,
    isAccepting: () => accepting, stopAdmission: () => { accepting = false; }, track, isSettled: settled,
    adopt: (key, { release, isSettled }) => {
      // An already admitted async creation may finish during drain. Retain that
      // actual resource before it can fail, but never adopt after acknowledged close.
      if (lifecycle.isClosed()) assertAccepting();
      if (resources.has(key)) return;
      const record = { settled: isSettled };
      resources.set(key, record);
      lifecycle.registerCleanup(release, { label: 'run-shared-resource-release' });
    },
    close: () => {
      accepting = false;
      if (!closing) closing = (async () => {
        try {
          await lifecycle.drain();
          drained = true;
          await lifecycle.close();
          if (!settled()) throw new Error('Original run resource settlement remains unconfirmed.');
          resources.clear();
          observations.length = 0;
        } catch (error) {
          if (observations.length < 128) observations.push(observeStorageResource(error, { phase: 'run-resource-release' }));
          else overflow = true;
          throw addStorageFailureContext(error, { runResourceScope: owner,
            cacheOwnershipPending: true, cacheOwnershipReleased: settled }, undefined,
          { forceAggregate: true, nonEnumerable: ['runResourceScope'] });
        }
      })();
      closing.catch(() => {});
      return closing;
    }
  });
  return owner;
};
