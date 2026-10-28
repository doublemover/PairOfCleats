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
import { throwIfAborted } from './abort.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => Object.assign(new Error('Index-state publication requires a valid state object and namespace.'), {
  code: 'ERR_INDEX_STATE_INVALID'
});

/** Cooperative writers serialize the actual read/mutation/state/manifest
 * interval. This does not make two files crash-atomic or grant root cleanup. */
export const publishIndexStateMutation = async (indexDir, mutate, { signal = null } = {}) => {
  if (typeof indexDir !== 'string' || !indexDir || typeof mutate !== 'function') throw new TypeError('Index-state publication requires its directory and mutation.');
  throwIfAborted(signal);
  const root = path.resolve(indexDir), statePath = path.join(root, 'index_state.json');
  const lockPath = path.join(root, '.index_state.write.lock');
  assertNoSymlinkPath(root, lockPath, { allowMissing: true });
  let result, primary, failed = false;
  try { result = await withFileLock({ lockPath, waitMs: 5000, staleMs: Number.MAX_SAFE_INTEGER, signal,
    metadata: { scope: 'index-state-publication', hostname: os.hostname() },
    staleRemovalImpl: async ({ lockPath: candidate, info }) => ({ removed: Boolean(isKnownRepoAccessOwner(info)
      && info.scope === 'index-state-publication' && isLocalProcessDefinitelyDead(info.pid)
      && removeLockFileSyncIfOwned(candidate, info)), removalMode: 'owner' }) }, async () => {
    try {
      throwIfAborted(signal);
      assertNoSymlinkPath(root, lockPath);
      let state;
      try {
        const read = readVerifiedContainedFileSync(root, statePath, { maxBytes: MAX_JSON_BYTES });
        state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
      } catch (error) {
        observeStorageResource(error, { phase: 'index-state-publication-read' }).requireSettled();
        if (error?.code !== 'ENOENT') throw error;
        state = {};
      }
      if (!object(state)) throw invalid();
      const value = await mutate(state);
      observeStorageResource(value, { phase: 'index-state-publication-mutation' }).requireSettled();
      const next = value === undefined ? state : value;
      if (!object(next)) throw invalid();
      const now = new Date().toISOString();
      const prepared = withGeneratedArtifactMetadata({ ...next, generatedAt: next.generatedAt || now, updatedAt: now }, 'index-state');
      throwIfAborted(signal);
      await writeJsonObjectFile(statePath, { fields: prepared, atomic: true });
      // Complete an already started state/manifest pair even if cancellation was
      // requested during the state write; the caller still observes cancellation.
      await updateIndexStateManifest(root);
      throwIfAborted(signal);
      return { state: prepared };
    } catch (error) { primary = error; failed = true; throw error; }
  }); } catch (error) {
    throw failed && error !== primary ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
  }
  if (result === null) throw Object.assign(new Error('Index-state publication is owned by another or unsettled writer.'), {
    code: 'ERR_INDEX_STATE_PUBLICATION_BUSY'
  });
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
