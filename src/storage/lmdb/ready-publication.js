import path from 'node:path';
import { createHash } from 'node:crypto';
import { readIndexStateForPublication, withIndexStatePublicationLock, publishIndexStateMutation } from '../../shared/index-state-publication.js';
import { stableStringify } from '../../shared/stable-json.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import { LMDB_SCHEMA_VERSION } from './schema.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const conflict = () => Object.assign(new Error('LMDB readiness conflicts with its original pending source/publication.'), {
  code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT'
});
// SQLite has an independent namespace. The shared state owner generates the
// root updatedAt on every invocation; all other source/LMDB fields stay bound.
const witness = state => {
  const { sqlite, updatedAt, ...source } = state;
  void sqlite; void updatedAt;
  return createHash('sha256').update(stableStringify(source)).digest('hex');
};
const snapshot = value => {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_JSON_BYTES) throw conflict();
  const result = JSON.parse(json), pending = [result];
  while (pending.length) {
    const current = pending.pop(); Object.freeze(current);
    for (const child of Object.values(current)) if (child && typeof child === 'object') pending.push(child);
  }
  return result;
};

/** Prepare an immutable backend snapshot without publishing filesystem ready.
 * The actual producer writes it and awaits original native close outside this
 * mutex, then commits against its original source/LMDB witness. No session,
 * generation string or snapshot grants cleanup authority. */
export const prepareLmdbReadyPublication = async (indexDir, pendingState, patch) => {
  if (typeof indexDir !== 'string' || !path.isAbsolute(indexDir) || !object(pendingState) || !object(pendingState.lmdb) || !object(patch)
    || pendingState.lmdb?.pending !== true || pendingState.lmdb?.ready !== false
    || patch.enabled !== true || patch.ready !== true || patch.pending !== false || patch.schemaVersion !== LMDB_SCHEMA_VERSION
    || !['code', 'prose', 'all'].includes(patch.buildMode) || typeof patch.path !== 'string' || !path.isAbsolute(patch.path)) throw conflict();
  const prerequisites = [];
  for (const [value, phase] of [[pendingState, 'lmdb-ready-pending-source'], [patch, 'lmdb-ready-producer-request']]) {
    const original = observeStorageResource(value, { phase });
    if (original.hasResourceObservation) prerequisites.push(observeStorageResource(original.retain(), { phase }));
    original.requireSettled();
  }
  const requireOriginals = () => { for (const original of prerequisites) original.requireSettled(); };
  const observations = prerequisites.length ? { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => prerequisites.every(original => original.isSettled()) } : {};
  const requested = snapshot(patch), expected = witness(pendingState), root = path.resolve(indexDir);
  return withIndexStatePublicationLock(root, () => {
    requireOriginals();
    const current = readIndexStateForPublication(path.join(root, 'index_state.json'));
    if (witness(current) !== expected) throw conflict();
    const now = new Date().toISOString();
    const state = snapshot({ ...current, updatedAt: now, lmdb: { ...current.lmdb, ...requested, updatedAt: now } });
    let commitment = null;
    return Object.freeze({ state, ...observations,
      commit() {
        if (!commitment) {
          commitment = publishIndexStateMutation(root, latest => {
            requireOriginals();
            if (witness(latest) !== expected) throw conflict();
            latest.lmdb = state.lmdb;
            if (prerequisites.length) Object.defineProperties(latest, {
              cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: observations.cacheOwnershipReleased }
            });
            return latest;
          });
          commitment.catch(() => {});
        }
        return commitment;
      }
    });
  });
};
