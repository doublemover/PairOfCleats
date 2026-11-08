const references = new WeakMap();

/** Sessions remain under their existing cache/disposal owners. A run retains
 * references only while its admitted callbacks can use them; host cache access
 * never becomes an individual build's disposal authority.
 */
export const retainRunSession = (session, owner, dispose) => {
  let reference = references.get(session);
  if (!reference) {
    reference = { owners: new Set(), hosted: false };
    references.set(session, reference);
  }
  if (!owner) { reference.hosted = true; return; }
  if (reference.owners.has(owner)) return;
  let released = false, detached = false;
  owner.adopt(session, { isSettled: () => released || detached && session.disposed === true,
    release: async () => {
      reference.owners.delete(owner);
      detached = true;
      if (!reference.owners.size && !reference.hosted && !session.disposed) await dispose();
      released = true;
    } });
  reference.owners.add(owner);
};
