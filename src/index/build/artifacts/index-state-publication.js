import path from 'node:path';
import { createHash } from 'node:crypto';
import { readIndexStateForPublication, withIndexStatePublicationLock } from '../../../shared/index-state-publication.js';
import { stableStringify } from '../../../shared/stable-json.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

const sessions = new WeakMap();
const fingerprint = state => createHash('sha256').update(stableStringify(state)).digest('hex');
const conflict = () => Object.assign(new Error('Initial index-state publication conflicts with a newer writer.'), {
  code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT'
});

/** Initial writers may intentionally replace a previous staged state. Bind that
 * authority to its actual original contents, not a caller-supplied build ID. */
export const captureInitialIndexStatePublication = indexDir => {
  const root = path.resolve(indexDir), statePath = path.join(root, 'index_state.json');
  const session = Object.freeze({});
  sessions.set(session, { root, statePath, expected: fingerprint(readIndexStateForPublication(statePath)) });
  return session;
};

/** State/compact metadata and later manifest writes each hold the shared owner.
 * A different state between those intervals fails rather than being discarded.
 * This is not a crash-atomic pair or permission to remove the generation. */
export const runInitialIndexStatePublication = async (session, indexDir, action, { signal = null } = {}) => {
  const original = sessions.get(session);
  if (!original || original.root !== path.resolve(indexDir) || typeof action !== 'function') throw conflict();
  const result = await withIndexStatePublicationLock(original.root, async () => {
    if (fingerprint(readIndexStateForPublication(original.statePath, { signal })) !== original.expected) throw conflict();
    let observation;
    try {
      const value = await action();
      observation = observeStorageResource(value, { phase: 'initial-index-state-publication-result' });
      observation.requireSettled();
      const next = fingerprint(readIndexStateForPublication(original.statePath));
      observation.requireSettled(); original.expected = next;
      return observation.hasResourceObservation ? addStorageFailureContext(new Error('Initial publication prerequisites.'),
        { value }, observation.retain(), { secondaryPresent: true }) : { value };
    } catch (error) {
      throw observation?.hasResourceObservation ? addStorageFailureContext(error, {}, observation.retain(), { secondaryPresent: true }) : error;
    }
  }, { signal });
  return result.value;
};
