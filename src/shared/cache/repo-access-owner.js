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
