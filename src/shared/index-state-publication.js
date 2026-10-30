import path from 'node:path';
import os from 'node:os';
import { withFileLock } from './locks/file-lock.js';
import { removeLockFileSyncIfOwned, isLocalProcessDefinitelyDead } from './locks/file-lock-info.js';
import { isKnownRepoAccessOwner } from './cache/repo-access-owner.js';
import { readVerifiedContainedFileSync, assertNoSymlinkPath } from './contained-file.js';
import { MAX_JSON_BYTES } from './artifact-io/constants.js';
import { writeJsonObjectFile } from './json-stream/json-writers.js';
import { withGeneratedArtifactMetadata } from './generated-artifact-core.js';
import { updateIndexStateManifest } from './index-state-utils.js';
import { observeStorageResource } from './storage/failure-observation.js';
import { addStorageFailureContext } from './storage/operation-error.js';
import { throwIfAborted, raceAbort } from './abort.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pendingPublications = new Map();
const invalid = () => Object.assign(new Error('Index-state publication requires a valid state object and namespace.'), {
  code: 'ERR_INDEX_STATE_INVALID'
});

export const readIndexStateForPublication = (statePath, { signal = null } = {}) => {
  let state;
  try {
    const read = readVerifiedContainedFileSync(path.dirname(statePath), statePath, { maxBytes: MAX_JSON_BYTES, signal });
    state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
  } catch (error) {
    observeStorageResource(error, { phase: 'index-state-publication-read' }).requireSettled();
    if (error?.code !== 'ENOENT') throw error;
    state = {};
  }
  if (!object(state)) throw invalid();
  return state;
};

/** Use one owner for cooperating state and embedding-manifest writers. The
 * callback must not recursively acquire this lock. This grants no root cleanup. */
export const withIndexStatePublicationLock = async (indexDir, action, { signal = null } = {}) => {
  if (typeof indexDir !== 'string' || !indexDir || typeof action !== 'function') throw new TypeError('Index-state publication requires its directory and action.');
  throwIfAborted(signal);
  const root = path.resolve(indexDir);
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const previous = pendingPublications.get(key) || Promise.resolve();
  let release;
  const slot = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => slot);
  pendingPublications.set(key, tail);
  try {
    // Cooperating writers in this process serialize before contending for the
    // same physical owner. Cancellation releases only this queued slot; the
    // existing five-second cross-process lock admission remains unchanged.
    await raceAbort(signal, previous);
    return await runIndexStatePublicationLock(root, action, { signal });
  } finally {
    void previous.then(() => {
      release();
      if (pendingPublications.get(key) === tail) pendingPublications.delete(key);
    });
  }
};

const runIndexStatePublicationLock = async (root, action, { signal }) => {
  throwIfAborted(signal);
  const lockPath = path.join(root, '.index_state.write.lock');
  assertNoSymlinkPath(root, lockPath, { allowMissing: true });
  let result, primary, failed = false, entered = false;
  try { result = await withFileLock({ lockPath, waitMs: 5000, staleMs: Number.MAX_SAFE_INTEGER, signal,
    metadata: { scope: 'index-state-publication', hostname: os.hostname() },
    staleRemovalImpl: async ({ lockPath: candidate, info }) => ({ removed: Boolean(isKnownRepoAccessOwner(info)
      && info.scope === 'index-state-publication' && isLocalProcessDefinitelyDead(info.pid)
      && removeLockFileSyncIfOwned(candidate, info)), removalMode: 'owner' }) }, async () => {
    try {
      entered = true;
      throwIfAborted(signal);
      assertNoSymlinkPath(root, lockPath);
      return await action(root);
    } catch (error) { primary = error; failed = true; throw error; }
  }); } catch (error) {
    throw failed && error !== primary ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
  }
  if (!entered) throw Object.assign(new Error('Index-state publication is owned by another or unsettled writer.'), {
    code: 'ERR_INDEX_STATE_PUBLICATION_BUSY'
  });
  return result;
};

/** Serialize the actual read/mutation/state/manifest interval. Individual files
 * remain atomic; the pair is not a crash-atomic transaction. */
export const publishIndexStateMutation = async (indexDir, mutate, { signal = null, refreshPublication = true } = {}) => {
  if (typeof mutate !== 'function') throw new TypeError('Index-state publication requires a mutation.');
  const result = await withIndexStatePublicationLock(indexDir, async root => {
    const prerequisites = [];
    const capture = (value, phase) => {
      const original = observeStorageResource(value, { phase });
      if (!original.hasResourceObservation) return;
      const captured = observeStorageResource(original.retain(), { phase });
      prerequisites.push(captured); captured.requireSettled();
    };
    const requireOriginals = () => { for (const prerequisite of prerequisites) prerequisite.requireSettled(); };
    const statePath = path.join(root, 'index_state.json');
    const state = readIndexStateForPublication(statePath, { signal });
    const publication = refreshPublication ? await import('../index/build/publication-state-refresh.js') : null;
    const refresh = publication ? await publication.capturePublishedStateRefresh(root, state.mode) : null;
    const value = await mutate(state);
    capture(value, 'index-state-publication-mutation');
    const next = value === undefined ? state : value;
    if (!object(next)) throw invalid();
    const now = new Date().toISOString();
    const prepared = withGeneratedArtifactMetadata({ ...next, generatedAt: next.generatedAt || now, updatedAt: now }, 'index-state');
    throwIfAborted(signal);
    requireOriginals();
    await writeJsonObjectFile(statePath, { fields: prepared, atomic: true });
    // Complete an already started state/manifest pair even if cancellation was
    // requested during the state write; the caller still observes cancellation.
    await updateIndexStateManifest(root);
    if (refresh) await publication.refreshArtifactPublication(refresh);
    throwIfAborted(signal);
    requireOriginals();
    return { state: prepared, ...(prerequisites.length ? { cacheOwnershipPending: true,
      cacheOwnershipReleased: () => prerequisites.every(prerequisite => prerequisite.isSettled()) } : {}) };
  }, { signal });
  return result.state;
};

export const updateIndexStateNamespace = (indexDir, namespace, patch) => {
  if (!['sqlite', 'lmdb'].includes(namespace) || patch != null && !object(patch)) throw invalid();
  observeStorageResource(patch, { phase: 'index-state-publication-patch' }).requireSettled();
  // Capture producer-owned JSON data before waiting for another writer.
  const requested = structuredClone(patch || {});
  return publishIndexStateMutation(indexDir, state => {
    if (state[namespace] != null && !object(state[namespace])) throw invalid();
    state[namespace] = { ...(state[namespace] || {}), ...requested, updatedAt: new Date().toISOString() };
  });
};
