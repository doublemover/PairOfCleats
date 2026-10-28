import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { publishIndexStateMutation, readIndexStateForPublication } from '../../../src/shared/index-state-publication.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

// Baselines belong to the actual loaded object and exact path. A copied object
// cannot authorize replacing a present generation. Retain hashes, not its data.
const baselines = new WeakMap();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identities = ['repoId', 'buildId', 'mode', 'artifactSurfaceVersion', 'compatibilityKey', 'cohortKey', 'profile'];
const fingerprint = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fields = (value, excluded = []) => new Map(Object.keys(value).filter(key => !excluded.includes(key))
  .map(key => [key, fingerprint(value[key])]));
const snapshot = state => ({ fields: fields(state, ['extensions', 'updatedAt']),
  extensions: fields(object(state.extensions) ? state.extensions : {}, ['__poc_generated']) });
const generation = values => new Map(identities.filter(key => values.has(key)).map(key => [key, values.get(key)]));
const conflict = field => Object.assign(new Error(`Embedding index-state publication conflicts with newer ${field}.`), {
  code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT', field
});
const assign = (target, key, requested) => {
  if (Object.hasOwn(requested, key)) Object.defineProperty(target, key, {
    value: requested[key], enumerable: true, configurable: true, writable: true
  });
  else delete target[key];
};
const merge = (current, requested, base, next, prefix = '') => {
  const actual = fields(current);
  for (const key of new Set([...base.keys(), ...next.keys()])) {
    if (base.get(key) === next.get(key)) continue;
    if (actual.get(key) !== base.get(key) && actual.get(key) !== next.get(key)) throw conflict(`${prefix}${key}`);
    assign(current, key, requested);
  }
};

/** Only actual absence starts empty. Present corruption and outstanding reads
 * retain their original failure; no existence probe or backup guesses. */
export const loadIndexState = (statePath, { publicationSource = null } = {}) => {
  const exactPath = path.resolve(statePath), state = readIndexStateForPublication(exactPath);
  const next = snapshot(state), source = publicationSource === null ? null : baselines.get(publicationSource);
  if (publicationSource !== null && (!source || source.path !== exactPath)) throw conflict('publication source');
  baselines.set(state, { path: exactPath, ...next, generation: source?.generation || generation(next.fields),
    attemptId: source?.attemptId ?? null });
  return state;
};

/** Called while holding the shared publication lock, before manifest or
 * validation work. Authority comes from this invocation's original state. */
export const assertIndexStatePublicationSource = (statePath, source) => {
  const exactPath = path.resolve(statePath), base = baselines.get(source);
  if (!base || base.path !== exactPath) throw conflict('publication source');
  const current = readIndexStateForPublication(exactPath), actual = snapshot(current);
  for (const key of identities) if (actual.fields.get(key) !== base.generation.get(key)) throw conflict(`generation ${key}`);
  if ((current.extensions?.runtimeAttemptId ?? null) !== base.attemptId) throw conflict('runtime attempt');
};

/** Publish only the caller's changes against its original loaded state. An
 * explicit initial claim uses compare-and-set; subsequent writes require that
 * same invocation. Terminal writers pass their original attempt, never a fresh
 * on-disk attempt discovered while reporting an earlier failure. */
export const writeIndexState = async (statePath, state, { attemptId, claimAttempt = false, signal = null } = {}) => {
  observeStorageResource(state, { phase: 'embedding-index-state-input' }).requireSettled();
  if (!object(state)) throw new TypeError('Embedding publication requires a state object.');
  const exactPath = path.resolve(statePath), loaded = baselines.get(state);
  if (loaded && loaded.path !== exactPath) throw conflict('state path');
  const base = loaded || { path: exactPath, fields: new Map(), extensions: new Map(), generation: new Map(), attemptId: null };
  // Capture JSON intent before lock admission; later caller mutation is a later
  // request. JSON normalization matches the actual writer's persisted meaning.
  const requested = JSON.parse(stableStringify(state)), next = snapshot(requested);
  if (Object.hasOwn(requested, 'extensions') && !object(requested.extensions)) throw new TypeError('Embedding publication requires an extensions object.');
  const expected = attemptId === undefined ? base.attemptId : attemptId;
  if (expected != null && (typeof expected !== 'string' || !expected)) throw new TypeError('Embedding publication requires a nonempty attempt ID.');
  if (claimAttempt && !expected) throw new TypeError('Embedding publication requires its initial attempt ID.');
  await publishIndexStateMutation(path.dirname(exactPath), current => {
    if (!loaded && Object.keys(current).length) throw conflict('unloaded state');
    const actual = snapshot(current);
    for (const key of identities) {
      if (actual.fields.get(key) !== base.generation.get(key)
        || base.generation.has(key) && next.fields.get(key) !== base.generation.get(key)) throw conflict(`generation ${key}`);
    }
    const active = current.extensions?.runtimeAttemptId ?? null;
    const original = base.extensions.get('runtimeAttemptId');
    if (claimAttempt ? actual.extensions.get('runtimeAttemptId') !== original
      : active !== null && active !== expected || base.attemptId !== null && active !== base.attemptId) throw conflict('runtime attempt');
    if (expected && requested.extensions?.runtimeAttemptId !== expected) throw conflict('requested runtime attempt');
    merge(current, requested, base.fields, next.fields);
    if (current.extensions != null && !object(current.extensions)) throw conflict('extensions');
    current.extensions ||= {};
    merge(current.extensions, requested.extensions || {}, base.extensions, next.extensions, 'extensions.');
  }, { signal });
  // Remember the submitted intent, not unrelated fresh namespaces. Do not
  // mutate the caller or discard changes it made while this write was waiting.
  baselines.set(state, { path: exactPath, ...next, generation: generation(next.fields), attemptId: expected ?? null });
};
