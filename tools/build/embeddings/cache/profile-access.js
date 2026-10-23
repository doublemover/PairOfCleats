import path from 'node:path';
import { acquireStorageSession, runWithStorageSession } from '../../../../src/shared/storage/session.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../../src/shared/contained-file.js';
import { atomicWriteText } from '../../../../src/shared/io/atomic-write.js';

export const EMBEDDING_PROFILE_MARKER = 'profile.meta.json';
export const EMBEDDING_PROFILE_OWNER = 'pairofcleats-embedding-profile-v1';
const KEY = /^[a-f0-9]{40}$/;

/** Only the existing canonical layout is adopted. Legacy tuples remain read-only
 * compatibility storage and never gain deletion authority through this helper. */
export const resolveEmbeddingProfileAccess = directory => {
  if (typeof directory !== 'string' || !directory) return null;
  let current = path.resolve(directory);
  for (let depth = 0; depth < 8 && path.dirname(current) !== current; depth++, current = path.dirname(current)) {
    const layout = path.basename(path.dirname(current));
    if (!KEY.test(path.basename(current)) || !['profiles-v2', 'profiles-v3'].includes(layout)) continue;
    let root = path.dirname(current);
    for (let ancestor = 0; ancestor < 4; ancestor++) root = path.dirname(root);
    return Object.freeze({ root, profile: current, key: path.basename(current), layoutVersion: layout === 'profiles-v3' ? 3 : 2,
      coordinationRoot: path.join(root, '.profile-access'), marker: path.join(current, EMBEDDING_PROFILE_MARKER) });
  }
  return null;
};

export const embeddingProfileSessionInput = descriptor => ({ roots: [descriptor.profile],
  coordinationRoot: descriptor.coordinationRoot, authorizedRoots: [descriptor.root], scope: 'embedding-profile-cache' });

export const acquireEmbeddingProfileSession = directory => {
  const descriptor = resolveEmbeddingProfileAccess(directory);
  return descriptor ? acquireStorageSession(embeddingProfileSessionInput(descriptor)) : null;
};

/** Access timestamps are advisory and fixed-size. The active profile lease
 * fences the collector while a bounded touch replaces existing metadata. */
const touchProfile = async descriptor => {
  try {
    const { buffer } = await readVerifiedContainedFile(descriptor.profile, descriptor.marker, { maxBytes: 64 * 1024 });
    const marker = JSON.parse(buffer.toString('utf8'));
    if (marker.owner !== EMBEDDING_PROFILE_OWNER || marker.version !== 1 || marker.identityKey !== descriptor.key) return;
    const lastUse = Date.parse(marker.lastUse || '');
    if (Number.isFinite(lastUse) && Date.now() - lastUse < 60000) return;
    await atomicWriteText(descriptor.marker, JSON.stringify({ ...marker, lastUse: new Date().toISOString() }));
  } catch (error) {
    if (error.cacheOwnershipPending || error instanceof AggregateError) throw error;
    // A lost advisory touch never supplies cache or cleanup authority.
  }
};

export const withEmbeddingProfileAccess = async (directory, action) => {
  const descriptor = resolveEmbeddingProfileAccess(directory);
  if (!descriptor) return action();
  const result = await runWithStorageSession(embeddingProfileSessionInput(descriptor), async () => {
    assertNoSymlinkPath(path.parse(descriptor.profile).root, path.resolve(directory), { allowMissing: true });
    const value = await action();
    await touchProfile(descriptor);
    return value;
  }, { settlement: ({ resourceId }) => ({ resourceId, settled: true, pending: false }) });
  return result.value;
};

export const withEmbeddingProfileRootAccess = async (directory, action) => {
  const descriptor = resolveEmbeddingProfileAccess(directory);
  if (!descriptor) return action();
  const result = await runWithStorageSession({ ...embeddingProfileSessionInput(descriptor), roots: [descriptor.root] }, action,
    { settlement: ({ resourceId }) => ({ resourceId, settled: true, pending: false }) });
  return result.value;
};
