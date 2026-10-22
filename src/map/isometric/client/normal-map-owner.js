import { captureSceneResource, observeSceneOwnership, preserveSceneCleanupFailures } from './scene-retirement.js';

const owners = new WeakMap(), legacyTextures = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Own actual returned loader textures before any completion callback. A failed
 * callback retains only this loader's objects and original cleanup methods. */
export const createNormalMapOwner = ({ isCurrent, configure, publish = () => {} }) => {
  const entries = new Map(), composedFailures = new WeakMap();
  let retired = false, texture = null, lastFailure = null, loadFailure, hasLoadFailure = false;
  const combine = (primary, errors, options = {}) => {
    const failure = preserveSceneCleanupFailures(primary, errors, options);
    if (objectLike(failure) && failure !== primary && !errors.includes(failure)) {
      const hasPrimary = options.hasPrimary ?? (primary !== null && primary !== undefined);
      composedFailures.set(failure, hasPrimary ? [primary, ...errors] : [...errors]);
    }
    return failure;
  };
  const adopt = value => {
    if (!objectLike(value)) throw new TypeError('Normal-map loader returned no owned texture.');
    if (entries.has(value)) return entries.get(value);
    const primitive = captureSceneResource(value, 'shared scene normal map', 'dispose', [], { required: true });
    const blockers = new Map();
    const guarded = captureSceneResource({ texture: value, dispose() {
      for (const [error, observe] of blockers) if (!observe()) throw error;
      return primitive.retire();
    } }, 'normal-map original texture work');
    const entry = Object.freeze({ texture: value, owner: guarded,
      get blocked() { return [...blockers.values()].some(observe => !observe()); },
      retain(error) {
        const pending = [error], visited = new Set();
        while (pending.length) {
          const original = pending.pop();
          if (visited.has(original)) continue; visited.add(original);
          const composition = objectLike(original) && composedFailures.get(original);
          if (composition) { pending.push(...composition); continue; }
          // Only exact original failures of these captured capabilities may
          // delegate closure to them. Copied owner/cause fields prove nothing.
          if (original === guarded.lastError || original === primitive.lastError || blockers.has(original)) continue;
          const observe = observeSceneOwnership(original);
          if (observe) blockers.set(original, observe);
        }
      } });
    entries.set(value, entry);
    if (hasLoadFailure) entry.retain(loadFailure);
    return entry;
  };
  const remember = (failure, primaryPreserved = false) => {
    lastFailure = hasLoadFailure && !primaryPreserved
      ? combine(loadFailure, [failure], { hasPrimary: true, forceAggregate: true }) : failure;
    return lastFailure;
  };
  const retireEntry = (entry, errors) => {
    try { entry.owner.retire(); } catch (error) { errors.push(error); }
  };
  const retireAll = () => {
    retired = true; texture = null;
    const errors = [];
    for (const entry of entries.values()) retireEntry(entry, errors);
    const failure = combine(null, errors);
    if (failure) throw remember(failure);
  };
  const owner = Object.freeze({
    get texture() { return texture; },
    get failure() { return lastFailure; },
    get pendingOwners() { return Object.freeze([...entries.values()].filter(entry => entry.owner.pending).map(entry => entry.owner)); },
    track(value) {
      const entry = adopt(value);
      if (retired || !isCurrent()) {
        const errors = []; retireEntry(entry, errors);
        const failure = combine(null, errors); if (failure) throw remember(failure);
      }
      return value;
    },
    accept(value) {
      const entry = adopt(value), errors = [];
      if (retired || !isCurrent() || !entry.owner.pending) {
        retireEntry(entry, errors);
        const failure = combine(null, errors); if (failure) throw remember(failure);
        return false;
      }
      let primary, hasPrimary = false, published = false;
      try {
        configure(value);
        if (retired || !isCurrent()) {
          retireEntry(entry, errors);
          const failure = combine(null, errors); if (failure) throw failure;
          return false;
        }
        const previous = texture && entries.get(texture);
        texture = value; published = true;
        try { publish(value); } finally { if (previous && previous !== entry) retireEntry(previous, errors); }
      } catch (error) { hasPrimary = true; primary = error; entry.retain(error); }
      if (!published) retireEntry(entry, errors);
      // If publication itself observed unknown native work, retain its exact
      // guard without closing the now-live texture while that work is pending.
      if (published && hasPrimary) {
        if (entry.blocked) retireEntry(entry, errors);
      }
      const failure = combine(primary, errors, { hasPrimary, forceAggregate: hasPrimary });
      if (failure) throw remember(failure);
      return true;
    },
    fail(primary) {
      retired = true; texture = null;
      const errors = hasLoadFailure && !Object.is(primary, loadFailure) ? [primary] : [];
      if (!hasLoadFailure) { loadFailure = primary; hasLoadFailure = true; }
      for (const entry of entries.values()) { entry.retain(loadFailure); entry.retain(primary); }
      for (const entry of entries.values()) retireEntry(entry, errors);
      throw remember(combine(loadFailure, errors, { hasPrimary: true, forceAggregate: true }), true);
    },
    dispose: retireAll
  });
  owners.set(owner, retireAll);
  return owner;
};

/** Factory proof chooses the original owner, not a copied public disposer.
 * Legacy plain source fixtures retain their original exact texture capability. */
export const retireNormalMapState = value => {
  if (!objectLike(value)) return;
  const dispose = owners.get(value);
  if (dispose) { dispose(); return; }
  const texture = value.texture;
  if (!objectLike(texture)) return;
  let owner = legacyTextures.get(texture);
  if (!owner) { owner = captureSceneResource(texture, 'shared scene normal map', 'dispose', [], { required: true }); legacyTextures.set(texture, owner); }
  try { owner.retire(); } finally { if (value.texture === texture) value.texture = null; }
};
