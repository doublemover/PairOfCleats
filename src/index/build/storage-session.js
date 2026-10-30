import { acquireRepoStorageSession } from '../../shared/storage/repository-session.js';
export const acquireIndexStorageSession = acquireRepoStorageSession;

const selectionError = message => Object.assign(new Error(message), { code: 'ERR_INDEX_STORAGE_SELECTION' });

export const retainIndexStorageFailure = (error, session, owner = null, released = () => false) => {
  const primary = error && typeof error === 'object' ? error : new Error(String(error), { cause: error });
  let original = null;
  try {
    const observe = primary.cacheOwnershipReleased;
    if (primary.cacheOwnershipPending === true || typeof observe === 'function') {
      original = () => { try { return typeof observe === 'function' && observe.call(primary) === true; } catch { return false; } };
    }
  } catch { original = () => false; }
  return Object.assign(new AggregateError([primary], primary.message || 'Index storage ownership remains unsettled.', { cause: primary }), {
    code: primary.code || 'ERR_INDEX_STORAGE_PENDING', name: primary.name || 'AggregateError', cacheOwnershipPending: true,
    cacheOwnershipReleased: () => { try { return released() === true && (!original || original()); } catch { return false; } }, storageSession: session,
    ...(owner ? { indexStorageOwner: owner } : {})
  });
};

/** The existing writer owner still decides when its work is drained. Its exact
 * successful release must precede the category leases, including on retry.
 */
export const attachIndexStorageSession = (lock, { session, revalidate }) => {
  const releaseIndex = lock.release.bind(lock);
  let indexReleased = false, released = false, releasing = null;
  const owner = Object.create(Object.getPrototypeOf(lock), Object.getOwnPropertyDescriptors(lock));
  Object.defineProperties(owner, {
    storageSession: { value: session },
    revalidateStorageSelection: { value: revalidate },
    release: { value: () => {
      if (released) return Promise.resolve(true);
      if (releasing) return releasing;
      releasing = Promise.resolve().then(async () => {
        try {
          if (!indexReleased) {
            if (await releaseIndex() !== true) throw selectionError('Index writer release did not confirm its exact owner.');
            indexReleased = true;
          }
          if (session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }) !== true) {
            throw selectionError('Index category lease release did not confirm its exact owner.');
          }
          released = true;
          return true;
        } catch (error) { throw retainIndexStorageFailure(error, session, owner, () => released); }
      }).finally(() => { releasing = null; });
      return releasing;
    } }
  });
  return owner;
};
