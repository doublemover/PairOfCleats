import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCacheIdentity, resolveCacheDir, readCacheIndex, readCacheEntries, writeCacheEntries } from '../../../tools/build/embeddings/cache.js';
import { createCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { acquireEmbeddingProfileSession, resolveEmbeddingProfileAccess } from '../../../tools/build/embeddings/cache/profile-access.js';
import { EMBEDDING_PROFILE_LIMITS, inspectEmbeddingCacheProfiles, reconcileEmbeddingProfileBudget } from '../../../tools/build/embeddings/cache/profile-retention.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('embedding-profile-history-quota');
const identities = Array.from({ length: 10 }, (_, index) => buildCacheIdentity({ provider: 'onnx', modelId: 'history/model',
  dims: 2, stub: true, inputFormatting: { queryPrefix: `profile-${index}: ` } }));
const directories = identities.map(value => resolveCacheDir(dir, value.identity, 'code'));
const write = index => {
  const identity = identities[index];
  const payload = { key: 'row', hash: 'source', cacheMeta: { identityKey: identity.key }, codeVectors: [[index, 1]], docVectors: [[]], mergedVectors: [[1, index]] };
  return writeCacheEntries(directories[index], createCacheIndex(identity.key), [{ cacheKey: payload.key, payload }]);
};
for (let index = 0; index < EMBEDDING_PROFILE_LIMITS.maxProfiles; index++) {
  assert.equal((await write(index)).length, 1);
  const descriptor = resolveEmbeddingProfileAccess(directories[index]);
  const marker = JSON.parse(await fs.readFile(descriptor.marker, 'utf8'));
  await fs.writeFile(descriptor.marker, JSON.stringify({ ...marker, lastUse: new Date(Date.now() - 600000 + index * 1000).toISOString() }));
}
await fs.writeFile(path.join(path.dirname(directories[1]), 'cache.meta.json'), JSON.stringify({ identityKey: identities[9].key }));
await reconcileEmbeddingProfileBudget(directories[0]);
const held = acquireEmbeddingProfileSession(directories[0]);
try {
  assert.equal((await write(8)).length, 1);
  const inventory = await inspectEmbeddingCacheProfiles(dir);
  assert.equal(inventory.complete, true); assert.equal(inventory.profiles.length, 8);
  assert.ok(inventory.profiles.some(value => value.key === identities[0].key), 'a live original profile lease blocks retirement');
  assert.ok(inventory.profiles.some(value => value.key === identities[1].key), 'foreign metadata never grants retirement authority');
  assert.ok(!inventory.profiles.some(value => value.key === identities[2].key), 'the oldest fully qualified unleased profile retires as one reference unit');
  for (const index of [0, 8, 0]) {
    const cacheIndex = await readCacheIndex(directories[index], identities[index].key);
    assert.equal((await readCacheEntries(directories[index], ['row'], cacheIndex))[0].entry.codeVectors[0][0], index);
  }
  const denied = await writeCacheEntries(directories[9], createCacheIndex(identities[9].key), [{ cacheKey: 'denied',
    payload: { key: 'denied', codeVectors: [[1, 2]] } }], { maxBytes: 1 });
  assert.equal(denied, null);
  await assert.rejects(fs.stat(resolveEmbeddingProfileAccess(directories[9]).profile), { code: 'ENOENT' });
} finally { held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true, pending: false }); }

const foreignRoot = path.join(dir, 'foreign-root');
const foreign = resolveCacheDir(foreignRoot, identities[0].identity, 'code');
const descriptor = resolveEmbeddingProfileAccess(foreign);
await fs.mkdir(foreign, { recursive: true });
await fs.writeFile(descriptor.marker, '{"owner":"human"}');
await fs.writeFile(path.join(foreign, 'saved.txt'), 'retained evidence');
assert.equal(await writeCacheEntries(foreign, createCacheIndex(identities[0].key), [{ cacheKey: 'row', payload: { key: 'row' } }]), null);
assert.equal(await fs.readFile(descriptor.marker, 'utf8'), '{"owner":"human"}', 'unknown producer metadata never gains deletion/write authority');
assert.equal(await fs.readFile(path.join(foreign, 'saved.txt'), 'utf8'), 'retained evidence');
console.log('Managed profile history and byte admission retain active, unknown and compatible cache inputs.');
