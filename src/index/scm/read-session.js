import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { getScmRuntimeConfig } from './runtime.js';

const sessions = new WeakMap();
const rootKey = root => process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
const closed = () => Object.assign(new Error('SCM read session is closed.'), { name: 'AbortError', code: 'ABORT_ERR' });

/** One admitted repository view, independent of mutable global configuration
 * epochs. The run owner drains its readers before releasing this capability. */
export const createScmReadSession = ({ repoRoot, signal = null, owner = null, operationId = null } = {}) => {
  const root = rootKey(repoRoot), active = new Set(), observations = [];
  if (operationId !== null && !/^[a-f0-9]{16,128}$/i.test(operationId)) throw new TypeError('Immutable SCM operation ID required.');
  let accepting = true, released = false, closing = null, acquisition = null, overflow = false;
  const assertAccepting = () => { if (!accepting) throw closed(); throwIfAborted(signal); };
  const track = action => {
    try { assertAccepting(); } catch (error) { return Promise.reject(error); }
    const pending = Promise.resolve().then(action);
    active.add(pending);
    pending.then(() => active.delete(pending), error => {
      active.delete(pending);
      const observation = observeStorageResource(error, { phase: 'scm-read-session' });
      let settled = false;
      try { settled = observation.isSettled(); } catch {}
      if (!settled) {
        if (observations.length < 128) observations.push(observation); else overflow = true;
      }
    });
    return pending;
  };
  const session = Object.freeze({ id: randomUUID(), root, signal,
    run: action => owner ? owner.track(() => track(action)) : track(action),
    isSettled: () => released,
    close() {
      accepting = false;
      if (!closing) closing = (async () => {
        await Promise.allSettled([...active]);
        for (const observation of observations) observation.requireSettled();
        if (overflow) throw Object.assign(new Error('SCM unsettled observation bound exceeded.'), { cacheOwnershipPending: true });
        released = true; acquisition = null; observations.length = 0;
      })().finally(() => { closing = null; });
      return closing;
    }
  });
  sessions.set(session, { root, config: getScmRuntimeConfig(), assertAccepting, acquire(factory) {
    assertAccepting();
    if (!acquisition) acquisition = track(async () => {
      const result = operationId || await factory(signal);
      assertAccepting();
      if (!/^[a-f0-9]{16,128}$/i.test(result || '')) throw Object.assign(new Error('SCM acquisition did not return an immutable operation.'), { code: 'ERR_SCM_OPERATION_UNAVAILABLE' });
      return result;
    });
    return acquisition;
  } });
  owner?.adopt(session, { release: session.close, isSettled: session.isSettled });
  return session;
};

export const getScmReadSessionConfig = session => sessions.get(session)?.config || getScmRuntimeConfig();

export const acquireScmReadOperation = (session, repoRoot, factory) => {
  const state = sessions.get(session);
  if (!state || state.root !== rootKey(repoRoot)) throw new TypeError('SCM operation requires its admitted repository read session.');
  return state.acquire(factory);
};

/** Bind the capability explicitly into every production provider invocation;
 * discovery and metadata callers share this view without root-global pins. */
export const bindScmReadSession = (provider, session) => {
  const bound = { ...provider };
  for (const name of ['getRepoProvenance', 'listTrackedFiles', 'iterateTrackedFiles', 'getChangedFiles', 'getHistoryAffectedFiles', 'getFileMeta', 'getFileMetaBatch', 'annotate']) {
    if (typeof provider[name] !== 'function') continue;
    bound[name] = input => session.run(() => {
      if (rootKey(input.repoRoot) !== session.root) throw new TypeError('SCM read session repository differs.');
      return provider[name]({ ...input, signal: input.signal || session.signal, scmReadSession: session });
    });
  }
  return Object.freeze(bound);
};
