import os from 'node:os';

const keys = new Set(['scope', 'hostname', 'resourceId', 'pid', 'lockId', 'startedAt']);

/** Existing reader/exclusion payload only. Extra retention, reference, child or
 * future fields are unknown evidence until their actual owner settles them.
 */
export const isKnownRepoAccessOwner = owner => Boolean(owner && typeof owner === 'object' && !Array.isArray(owner)
  && Object.keys(owner).every(key => keys.has(key)) && owner.hostname === os.hostname()
  && Number.isSafeInteger(owner.pid) && owner.pid > 0
  && typeof owner.lockId === 'string' && owner.lockId.length > 0 && owner.lockId.length <= 256
  && typeof owner.scope === 'string' && owner.scope.length > 0 && owner.scope.length <= 128
  && typeof owner.startedAt === 'string' && Number.isFinite(Date.parse(owner.startedAt))
  && (owner.resourceId === undefined || (typeof owner.resourceId === 'string' && owner.resourceId.length > 0 && owner.resourceId.length <= 256)));

/** Resource leases use the same exclusion namespace, but a dead initiating
 * process is not settlement evidence for resources/children it may leave behind.
 * Keep the ordinary reader schema strict and independently recognize this owner.
 */
export const isKnownRepoResourceOwner = owner => {
  if (!owner || !Object.hasOwn(owner, 'resourceSettlementVersion') || owner.resourceSettlementVersion !== 1) return false;
  const reader = { ...owner };
  delete reader.resourceSettlementVersion;
  return typeof reader.resourceId === 'string' && isKnownRepoAccessOwner(reader);
};
